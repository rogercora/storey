"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ onDark = true }: { onDark?: boolean }) {
  const router = useRouter();
  return (
    <button
      className={`btn border-2 ${onDark ? "border-white text-white hover:bg-white hover:text-ink" : "border-ink text-ink hover:bg-ink hover:text-white"}`}
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
