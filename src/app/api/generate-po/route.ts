import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { londonDay } from "@/lib/dates";
import { computeRestock } from "@/lib/restock";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    session_ids: z.array(z.string().uuid()).optional(),
  })
  .optional();

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * POST /api/generate-po
 * Groups items needing restock (from today's latest completed session per zone,
 * or the specified session_ids) by supplier and creates draft purchase orders.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireActiveUser(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  let parsedBody: z.infer<typeof bodySchema> = undefined;
  try {
    const raw = await request.text();
    if (raw.trim()) parsedBody = bodySchema.parse(JSON.parse(raw));
  } catch {
    return fail(400, "Invalid JSON payload.");
  }

  let sessionIds = parsedBody?.session_ids ?? [];
  if (sessionIds.length === 0) {
    const { data: recent, error } = await supabase
      .from("inventory_sessions")
      .select("id, zone_id, created_at, completed_at")
      .eq("status", "completed")
      .gte("created_at", new Date(Date.now() - 36 * 3600_000).toISOString())
      .order("completed_at", { ascending: false });

    if (error) return fail(500, "Could not load completed stocktakes.");

    const today = londonDay();
    const seenZones = new Set<string>();
    for (const s of recent ?? []) {
      if (londonDay(new Date(s.created_at as string)) !== today) continue;
      if (seenZones.has(s.zone_id as string)) continue;
      seenZones.add(s.zone_id as string);
      sessionIds.push(s.id as string);
    }
  }

  if (sessionIds.length === 0) {
    return fail(422, "No completed stocktakes found for today. Finish at least one zone first.");
  }

  const { data: itemRows, error: itemErr } = await supabase
    .from("inventory_items")
    .select(
      "session_id, product_id, total_counted, products(id, supplier_id, order_unit, unit_cost_gbp, target_stock, safety_margin, min_stock, conversion_factor, round_up_order)",
    )
    .in("session_id", sessionIds);

  if (itemErr || !itemRows) return fail(500, "Could not read counted items.");

  type ProdInfo = {
    id: string;
    supplier_id: string | null;
    order_unit: string;
    unit_cost_gbp: number;
    target_stock: number;
    safety_margin: number;
    min_stock: number;
    conversion_factor: number;
    round_up_order: boolean;
  };

  // Recompute deterministically per product & group by supplier_id.
  const bySupplier = new Map<
    string,
    Map<string, { product_id: string; qty_order_units: number; order_unit: string; unit_cost_gbp: number }>
  >();
  let skippedNoSupplier = 0;

  for (const row of itemRows) {
    const p = (Array.isArray(row.products) ? row.products[0] : row.products) as ProdInfo | null;
    if (!p) continue;
    const totalCounted = Number(row.total_counted ?? 0);
    const restock = computeRestock(p, totalCounted);
    if (restock.order_qty <= 0) continue;

    if (!p.supplier_id) {
      skippedNoSupplier++;
      continue;
    }

    let supplierMap = bySupplier.get(p.supplier_id);
    if (!supplierMap) {
      supplierMap = new Map();
      bySupplier.set(p.supplier_id, supplierMap);
    }

    const prev = supplierMap.get(p.id);
    supplierMap.set(p.id, {
      product_id: p.id,
      qty_order_units: (prev?.qty_order_units ?? 0) + restock.order_qty,
      order_unit: p.order_unit,
      unit_cost_gbp: Number(p.unit_cost_gbp),
    });
  }

  if (bySupplier.size === 0) {
    return NextResponse.json({
      created_pos: [],
      skipped_no_supplier: skippedNoSupplier,
      message: skippedNoSupplier > 0 ? "Items need restock but have no supplier assigned." : "All counted items are at or above target stock.",
    });
  }

  const createdIds: string[] = [];
  for (const [supplierId, lineMap] of bySupplier) {
    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .insert({
        supplier_id: supplierId,
        status: "draft",
        created_by: auth.user.id,
        source_session_ids: sessionIds,
      })
      .select("id")
      .single();

    if (poErr || !po) {
      console.error("[generate-po] PO insert failed", poErr?.message);
      return fail(500, "Could not create purchase order draft.");
    }

    const lines = [...lineMap.values()].map((l) => ({
      purchase_order_id: po.id as string,
      product_id: l.product_id,
      qty_order_units: l.qty_order_units,
      order_unit: l.order_unit,
      unit_cost_gbp: l.unit_cost_gbp,
    }));

    const { error: linesErr } = await supabase.from("purchase_order_items").insert(lines);
    if (linesErr) {
      console.error("[generate-po] PO lines insert failed", linesErr.message);
      return fail(500, "Could not add items to purchase order.");
    }

    createdIds.push(po.id as string);
  }

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "po_created",
    entityType: "purchase_order",
    entityId: createdIds[0] ?? null,
    summary: `Generated ${createdIds.length} draft purchase order(s)`,
    meta: { created_pos: createdIds },
  });

  return NextResponse.json({ created_pos: createdIds, skipped_no_supplier: skippedNoSupplier });
}

