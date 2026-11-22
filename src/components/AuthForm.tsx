"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BrandHeader } from "@/components/Brand";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const msg = /not confirmed/i.test(error.message)
          ? "Please confirm your email address first (check your inbox)."
          : "Incorrect email or password.";
        setError(msg);
      } else {
        router.replace("/");
        router.refresh();
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() } },
      });
      if (error) setError(error.message);
      else if (data.session) {
        router.replace("/pending");
        router.refresh();
      } else {
        setNotice("Check your inbox to confirm your email address, then sign in.");
      }
    }
    setBusy(false);
  }

  return (
    <div className="min-h-dvh">
      <BrandHeader />
      <section className="bg-brand px-5 py-10 text-center text-white">
        <h1 className="text-5xl text-volt">Daily Stocktake</h1>
        <p className="mt-3 font-bold">{mode === "login" ? "Sign in to start counting." : "Create your team account."}</p>
      </section>

      <main className="mx-auto max-w-md px-5 py-8">
        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" && (
            <label className="block text-sm font-bold">
              Full name
              <input className="input mt-1 font-normal" required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
          )}
          <label className="block text-sm font-bold">
            Email
            <input className="input mt-1 font-normal" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm font-bold">
            Password
            <input
              className="input mt-1 font-normal"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "signup" && <span className="mt-1 block text-xs font-normal text-ink-soft">At least 8 characters.</span>}
          </label>

          {error && <p className="bg-accent-light px-3 py-2 text-sm font-semibold text-accent" role="alert">{error}</p>}
          {notice && <p className="bg-ok-light px-3 py-2 text-sm font-semibold text-ok">{notice}</p>}

          <button className="btn-accent w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          {mode === "login" ? (
            <>New to the team? <Link className="font-bold underline" href="/signup">Create an account</Link></>
          ) : (
            <>Already registered? <Link className="font-bold underline" href="/login">Sign in</Link></>
          )}
        </p>
      </main>
    </div>
  );
}
