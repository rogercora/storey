import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";

const patchSchema = z.object({
  status: z.enum(["approved", "sent"]),
  notes: z.string().max(500).optional(),
});

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail(400, "Invalid purchase order ID.");

  const supabase = await createClient();
  const auth = await requireActiveUser(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Invalid JSON payload.");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return fail(400, "Invalid status update.");

  const { data: po } = await supabase.from("purchase_orders").select("id, status").eq("id", id).maybeSingle();
  if (!po) return fail(404, "Purchase order not found.");

  // Enforce forward-only lifecycle: draft -> approved -> sent (also allow draft -> sent directly if needed).
  if (po.status === "sent") return fail(409, "This purchase order has already been sent.");
  if (po.status === "approved" && parsed.data.status === "approved") return NextResponse.json({ ok: true, status: "approved" });

  const update: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;

  const { error } = await supabase.from("purchase_orders").update(update).eq("id", id);
  if (error) {
    console.error("[purchase-orders PATCH] failed", error.message);
    return fail(500, "Could not update purchase order.");
  }

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: parsed.data.status === "approved" ? "po_approved" : "po_sent",
    entityType: "purchase_order",
    entityId: id,
    summary: `Marked purchase order as ${parsed.data.status}`,
  });

  return NextResponse.json({ ok: true, status: parsed.data.status });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail(400, "Invalid purchase order ID.");

  const supabase = await createClient();
  const auth = await requireActiveUser(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  const { error } = await supabase.from("purchase_orders").delete().eq("id", id).eq("status", "draft");
  if (error) return fail(500, "Could not delete draft purchase order.");

  return NextResponse.json({ ok: true });
}

