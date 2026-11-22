import type { SupabaseClient, User } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "staff";
  status: "pending" | "active" | "suspended";
}

export type AuthResult =
  | { ok: true; user: User; profile: Profile }
  | { ok: false; status: 401 | 403; error: string };

async function loadProfile(supabase: SupabaseClient): Promise<AuthResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser(); // validates the JWT with Supabase Auth
  if (!user) return { ok: false, status: 401, error: "Please sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, status")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return { ok: false, status: 403, error: "Account not found." };
  return { ok: true, user, profile: profile as Profile };
}

/** API guard: signed in AND status = 'active'. (RLS enforces the same rule in the database.) */
export async function requireActiveUser(supabase: SupabaseClient): Promise<AuthResult> {
  const res = await loadProfile(supabase);
  if (!res.ok) return res;
  if (res.profile.status !== "active") {
    return { ok: false, status: 403, error: "Your account is not active. Please ask your manager to approve your access." };
  }
  return res;
}

/** API guard: active AND role = 'admin'. */
export async function requireAdmin(supabase: SupabaseClient): Promise<AuthResult> {
  const res = await requireActiveUser(supabase);
  if (!res.ok) return res;
  if (res.profile.role !== "admin") return { ok: false, status: 403, error: "Admin access required." };
  return res;
}

