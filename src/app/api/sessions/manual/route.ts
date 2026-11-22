import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeRestock } from "@/lib/restock";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";

const bodySchema = z.object({ zone_id: z.string().uuid() });
const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * POST /api/sessions/manual
 * Starts a draft stocktake for a zone without taking a photo (every active
 * product starts at 0 so staff can count directly on the Quick Review screen).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireActiveUser(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Invalid JSON payload.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail(400, "A valid zone is required.");

  const { zone_id } = parsed.data;
  const { data: zone } = await supabase.from("zones").select("id, name").eq("id", zone_id).maybeSingle();
  if (!zone) return fail(404, "Zone not found.");

  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id, target_stock, safety_margin, min_stock, conversion_factor, round_up_order, unit_cost_gbp")
    .eq("zone_id", zone_id)
    .eq("active", true);
  if (pErr) return fail(500, "Could not load products.");
  if (!products || products.length === 0) return fail(422, "This zone has no active products yet.");

  const { data: sess, error: sErr } = await supabase
    .from("inventory_sessions")
    .insert({ zone_id, counted_by: auth.user.id, ai_meta: { manual: true } })
    .select("id")
    .single();
  if (sErr || !sess) return fail(500, "Could not start stocktake session.");

  const rows = products.map((p) => ({
    session_id: sess.id as string,
    product_id: p.id as string,
    final_closed_units: 0,
    final_open_fraction: 0,
    hidden_back_units: 0,
    suggested_order_qty: computeRestock(p, 0).order_qty,
  }));

  const { error: iErr } = await supabase.from("inventory_items").insert(rows);
  if (iErr) return fail(500, "Could not create stocktake items.");

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "stocktake_started",
    entityType: "session",
    entityId: sess.id as string,
    summary: `Started manual count in ${zone.name}`,
    meta: { zone_id, manual: true },
  });

  return NextResponse.json({ session_id: sess.id });
}

