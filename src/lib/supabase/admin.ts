import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client: BYPASSES RLS. Server-side only, and only AFTER the caller
 * has been verified as an active admin (see requireAdmin in lib/auth.ts).
 * Used by /api/admin/* (storage clean-up, bulk CSV import).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

