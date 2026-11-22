import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatGBP, parseDecimal, roundTo } from "@/lib/numbers";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";

const CATEGORIES = ["coffee", "dairy", "syrups", "packaging", "kitchen", "bakery", "drinks", "other"] as const;

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  brand: z.string().trim().max(80).optional().nullable(),
  category: z.enum(CATEGORIES).optional(),
  zone_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid().optional().nullable(),
  new_supplier_name: z.string().trim().max(100).optional().nullable(),
  visual_hints: z.string().trim().max(300).optional().nullable(),
  has_handwritten_tag: z.boolean().optional(),
  count_unit: z.string().trim().min(1).max(30).optional(),
  order_unit: z.string().trim().min(1).max(30).optional(),
  conversion_factor: z.union([z.number(), z.string()]).optional(),
  allow_open_fraction: z.boolean().optional(),
  min_stock: z.union([z.number(), z.string()]).optional(),
  target_stock: z.union([z.number(), z.string()]).optional(),
  safety_margin: z.union([z.number(), z.string()]).optional(),
  round_up_order: z.boolean().optional(),
  unit_cost_gbp: z.union([z.number(), z.string()]).optional(),
  active: z.boolean().optional(),
});

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

const toNonNeg = (v: number | string | undefined) => {
  if (v === undefined) return undefined;
  const n = parseDecimal(v);
  return n == null ? undefined : Math.max(0, n);
};

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail(400, "Invalid product ID.");

  const supabase = await createClient();
  const auth = await requireActiveUser(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return fail(400, "Invalid JSON payload.");
  }

  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) return fail(400, "Invalid product update.");
  const d = parsed.data;

  const { data: existing } = await supabase.from("products").select("id, code_tag, name, order_unit").eq("id", id).maybeSingle();
  if (!existing) return fail(404, "Product not found.");

  const update: Record<string, unknown> = {};
  if (d.name !== undefined) update.name = d.name;
  if (d.brand !== undefined) update.brand = d.brand || null;
  if (d.category !== undefined) update.category = d.category;
  if (d.zone_id !== undefined) update.zone_id = d.zone_id;
  if (d.visual_hints !== undefined) update.visual_hints = d.visual_hints || null;
  if (d.has_handwritten_tag !== undefined) update.has_handwritten_tag = d.has_handwritten_tag;
  if (d.count_unit !== undefined) update.count_unit = d.count_unit;
  if (d.order_unit !== undefined) update.order_unit = d.order_unit;
  if (d.allow_open_fraction !== undefined) update.allow_open_fraction = d.allow_open_fraction;
  if (d.round_up_order !== undefined) update.round_up_order = d.round_up_order;
  if (d.active !== undefined) update.active = d.active;

  let supplierName: string | null = null;
  if (d.new_supplier_name?.trim()) {
    const cleanName = d.new_supplier_name.trim();
    const { data: existingSup } = await supabase.from("suppliers").select("id, name").ilike("name", cleanName).maybeSingle();
    if (existingSup) {
      update.supplier_id = existingSup.id;
      supplierName = existingSup.name as string;
    } else {
      const { data: createdSup, error: supErr } = await supabase
        .from("suppliers")
        .insert({ name: cleanName, is_test_data: false })
        .select("id, name")
        .single();
      if (supErr || !createdSup) return fail(400, supErr?.message ?? "Could not create supplier.");
      update.supplier_id = createdSup.id;
      supplierName = createdSup.name as string;
    }
  } else if (d.supplier_id !== undefined) {
    update.supplier_id = d.supplier_id;
  }

  const factor = toNonNeg(d.conversion_factor);
  if (factor !== undefined) update.conversion_factor = Math.max(0.001, factor);
  const minS = toNonNeg(d.min_stock);
  if (minS !== undefined) update.min_stock = roundTo(minS, 3);
  const targetS = toNonNeg(d.target_stock);
  if (targetS !== undefined) update.target_stock = roundTo(targetS, 3);
  const safetyS = toNonNeg(d.safety_margin);
  if (safetyS !== undefined) update.safety_margin = roundTo(safetyS, 3);
  const cost = toNonNeg(d.unit_cost_gbp);
  if (cost !== undefined) update.unit_cost_gbp = roundTo(cost, 2);

  if (Object.keys(update).length === 0) return fail(400, "Nothing to update.");

  const { data: updated, error: upErr } = await supabase.from("products").update(update).eq("id", id).select("*").single();
  if (upErr || !updated) return fail(400, upErr?.message ?? "Could not update product.");

  const costNote = cost !== undefined ? ` · ${formatGBP(roundTo(cost, 2))} / ${updated.order_unit}` : "";
  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "product_updated",
    entityType: "product",
    entityId: id,
    summary: `Updated [${existing.code_tag}] ${updated.name}${costNote}`,
    meta: { code_tag: existing.code_tag, fields: Object.keys(update) },
  });

  return NextResponse.json({
    product: updated,
    supplier: supplierName ? { id: updated.supplier_id, name: supplierName } : null,
  });
}

