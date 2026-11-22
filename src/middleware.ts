import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const AUTH_PAGES = ["/login", "/signup"];

/**
 * 1. Refreshes the Supabase session cookie.
 * 2. Gatekeeper for pages: signed-out -> /login, pending/suspended -> /pending,
 *    non-admin -> kept out of /admin. (API routes enforce their own checks and
 *    RLS is the final authority in the database.)
 */
export async function middleware(request: NextRequest) {
  // Design preview with mock data only (no Supabase needed); never reachable in production.
  if (request.nextUrl.pathname === "/preview" && process.env.NODE_ENV !== "production") return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: CookieToSet[]) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/")) return response;

  const redirect = (to: string) => {
    const r = NextResponse.redirect(new URL(to, request.url));
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (!user) return AUTH_PAGES.includes(path) ? response : redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).maybeSingle();

  if (!profile || profile.status !== "active") {
    return path === "/pending" ? response : redirect("/pending");
  }
  if (AUTH_PAGES.includes(path) || path === "/pending") return redirect("/");
  if (path.startsWith("/admin") && profile.role !== "admin") return redirect("/");

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|sw.js).*)"],
};

