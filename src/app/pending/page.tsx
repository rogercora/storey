import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { Wordmark } from "@/components/Brand";

export default async function PendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("full_name, status").eq("id", user.id).maybeSingle();
  if (profile?.status === "active") redirect("/");
  const suspended = profile?.status === "suspended";

  return (
    <main className="flex min-h-dvh flex-col bg-plum text-white">
      <div className="px-5 py-4"><Wordmark /></div>
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        <h1 className="text-5xl text-volt">{suspended ? "Account Suspended" : "Account Pending Approval"}</h1>
        <p className="mt-4 text-lg font-semibold">
          {suspended ? "Your access has been suspended. Please speak to your manager." : "Please ask your manager to activate your access."}
        </p>
        {profile?.full_name && <p className="mt-6 text-sm text-white/70">Signed up as {profile.full_name}</p>}
        <div className="mt-8 flex gap-3">
          <a href="/pending" className="btn-accent">Check again</a>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
