import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";

const patchSchema = z.object({
  user_id: z.string().uuid(),
  status: z.enum(["pending", "active", "suspended"]).optional(),
  role: z.enum(["admin", "staff"]).optional(),
});

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Invalid JSON payload.");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return fail(400, "Invalid user update.");

  const update: Record<string, string> = {};
  if (parsed.data.status) update.status = parsed.data.status;
  if (parsed.data.role) update.role = parsed.data.role;
  if (Object.keys(update).length === 0) return fail(400, "Nothing to update.");

  const { error } = await supabase.from("profiles").update(update).eq("id", parsed.data.user_id);
  if (error) {
    // Surface trigger guard message cleanly (e.g. "You cannot demote or suspend the last active admin")
    return fail(400, error.message);
  }

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "user_updated",
    entityType: "profile",
    entityId: parsed.data.user_id,
    summary: `Updated user access (${Object.entries(update).map(([k, v]) => `${k}: ${v}`).join(", ")})`,
  });

  return NextResponse.json({ ok: true });
}

