import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeRestock } from "@/lib/restock";
import { clamp, roundTo } from "@/lib/numbers";
import { loadSessionItems } from "@/lib/sessions";

export const runtime = "nodejs";

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await ctx.params;
  if (!z.string().uuid().safeParse(sessionId).success) return fail(400, "Invalid session ID.");

  const supabase = await createClient();
  const auth = await requireActiveUser(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  const { data: session } = await supabase
    .from("inventory_sessions")
    .select("id, zone_id, status, ai_meta, created_at, completed_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return fail(404, "Stocktake session not found.");
  const items = await loadSessionItems(supabase, sessionId);
  return NextResponse.json({ session, items });
}

const patchSchema = z.object({
  complete: z.boolean().optional(),
  items: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        closed_units: z.number().min(0).max(10_000),
        open_fraction: z.number().min(0).max(1),
        hidden_back_units: z.number().min(0).max(10_000),
        reviewed: z.boolean().optional(),
      }),
    )
    .default([]),
});

/**
 * PATCH /api/sessions/[id]
 * Saves human review counts (always recomputing suggested_order_qty on the
 * server via computeRestock) and optionally marks the session completed.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await ctx.params;
  if (!z.string().uuid().safeParse(sessionId).success) return fail(400, "Invalid session ID.");

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
  if (!parsed.success) return fail(400, "Invalid stocktake update.");

  const { data: session } = await supabase
    .from("inventory_sessions")
    .select("id, status, zone_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return fail(404, "Stocktake session not found.");
  if (session.status !== "draft") return fail(409, "This stocktake is already completed.");

  const { data: existingItems, error: readErr } = await supabase
    .from("inventory_items")
    .select(
      "id, product_id, products(target_stock, safety_margin, min_stock, conversion_factor, round_up_order, unit_cost_gbp, allow_open_fraction)",
    )
    .eq("session_id", sessionId);

  if (readErr || !existingItems) return fail(500, "Could not load stocktake items.");

  type ProductRestock = {
    target_stock: number;
    safety_margin: number;
    min_stock: number;
    conversion_factor: number;
    round_up_order: boolean;
    unit_cost_gbp: number;
    allow_open_fraction: boolean;
  };

  const byItemId = new Map<string, ProductRestock>();
  for (const row of existingItems) {
    const p = Array.isArray(row.products) ? row.products[0] : row.products;
    if (p) byItemId.set(row.id as string, p as ProductRestock);
  }

  for (const patch of parsed.data.items) {
    const prod = byItemId.get(patch.item_id);
    if (!prod) continue;

    const closed = roundTo(clamp(patch.closed_units, 0, 10_000), 3);
    const hidden = roundTo(clamp(patch.hidden_back_units, 0, 10_000), 3);
    const open = prod.allow_open_fraction ? roundTo(clamp(patch.open_fraction, 0, 1), 3) : 0;
    const total = roundTo(closed + open + hidden, 3);
    const restock = computeRestock(prod, total);

    const { error: upErr } = await supabase
      .from("inventory_items")
      .update({
        final_closed_units: closed,
        final_open_fraction: open,
        hidden_back_units: hidden,
        reviewed: patch.reviewed ?? true,
        suggested_order_qty: restock.order_qty,
      })
      .eq("id", patch.item_id)
      .eq("session_id", sessionId);

    if (upErr) {
      console.error("[sessions PATCH] item update failed", upErr.message);
      return fail(500, "Could not save item changes.");
    }
  }

  if (parsed.data.complete) {
    const { error: compErr } = await supabase
      .from("inventory_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", sessionId);

    if (compErr) {
      console.error("[sessions PATCH] complete failed", compErr.message);
      return fail(500, "Could not complete the stocktake.");
    }
  }

  return NextResponse.json({ ok: true, session_id: sessionId, status: parsed.data.complete ? "completed" : "draft" });
}
