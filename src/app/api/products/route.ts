import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeRestock } from "@/lib/restock";
import { formatGBP, parseDecimal, roundTo } from "@/lib/numbers";
import { recordActivity } from "@/lib/audit";
import type { StocktakeItemDTO } from "@/lib/sessions";

export const runtime = "nodejs";

const CATEGORIES = ["coffee", "dairy", "syrups", "packaging", "kitchen", "bakery", "drinks", "other"] as const;

const createSchema = z.object({
  zone_id: z.string().uuid(),
  session_id: z.string().uuid().optional().nullable(),
  code_tag: z.string().min(2).max(12),
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).optional().nullable(),
  category: z.enum(CATEGORIES).default("other"),
  supplier_id: z.string().uuid().optional().nullable(),
  new_supplier_name: z.string().trim().max(100).optional().nullable(),
  visual_hints: z.string().trim().max(300).optional().nullable(),
  has_handwritten_tag: z.boolean().default(false),
  count_unit: z.string().trim().min(1).max(30).default("unit"),
  order_unit: z.string().trim().min(1).max(30).default("case"),
  conversion_factor: z.union([z.number(), z.string()]).default(1),
  allow_open_fraction: z.boolean().default(true),
  min_stock: z.union([z.number(), z.string()]).default(0),
  target_stock: z.union([z.number(), z.string()]).default(0),
  safety_margin: z.union([z.number(), z.string()]).default(0),
  round_up_order: z.boolean().default(true),
  unit_cost_gbp: z.union([z.number(), z.string()]).default(0),
  initial_closed_units: z.union([z.number(), z.string()]).optional(),
  initial_open_fraction: z.union([z.number(), z.string()]).optional(),
  initial_hidden_units: z.union([z.number(), z.string()]).optional(),
});

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

const toNonNeg = (v: number | string | undefined, fallback = 0) => {
  const n = parseDecimal(v ?? null);
  return n == null ? fallback : Math.max(0, n);
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireActiveUser(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return fail(400, "Invalid JSON payload.");
  }

  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) return fail(400, "Please check the required product fields.");
  const d = parsed.data;

  const codeTag = d.code_tag.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{2,8}$/.test(codeTag)) {
    return fail(400, "Code tag must be 2–8 letters or numbers (e.g. CP12, FD02).");
  }

  const { data: zone } = await supabase.from("zones").select("id, name").eq("id", d.zone_id).maybeSingle();
  if (!zone) return fail(404, "Zone not found.");

  // Check duplicate code_tag nicely
  const { data: dup } = await supabase.from("products").select("id, name").ilike("code_tag", codeTag).maybeSingle();
  if (dup) return fail(409, `Code "${codeTag}" is already used by ${dup.name}.`);

  let supplierId = d.supplier_id ?? null;
  let supplierName = "";
  if (!supplierId && d.new_supplier_name?.trim()) {
    const cleanName = d.new_supplier_name.trim();
    const { data: existingSup } = await supabase.from("suppliers").select("id, name").ilike("name", cleanName).maybeSingle();
    if (existingSup) {
      supplierId = existingSup.id as string;
      supplierName = existingSup.name as string;
    } else {
      const { data: createdSup, error: supErr } = await supabase
        .from("suppliers")
        .insert({ name: cleanName, is_test_data: false })
        .select("id, name")
        .single();
      if (supErr || !createdSup) return fail(400, supErr?.message ?? "Could not create supplier.");
      supplierId = createdSup.id as string;
      supplierName = createdSup.name as string;
    }
  }

  const factor = Math.max(0.001, toNonNeg(d.conversion_factor, 1));
  const minStock = roundTo(toNonNeg(d.min_stock, 0), 3);
  const targetStock = roundTo(toNonNeg(d.target_stock, 0), 3);
  const safetyMargin = roundTo(toNonNeg(d.safety_margin, 0), 3);
  const unitCost = roundTo(toNonNeg(d.unit_cost_gbp, 0), 2);

  const { data: product, error: prodErr } = await supabase
    .from("products")
    .insert({
      zone_id: d.zone_id,
      supplier_id: supplierId,
      code_tag: codeTag,
      has_handwritten_tag: d.has_handwritten_tag,
      name: d.name,
      brand: d.brand || null,
      category: d.category,
      visual_hints: d.visual_hints || null,
      count_unit: d.count_unit,
      order_unit: d.order_unit,
      conversion_factor: factor,
      allow_open_fraction: d.allow_open_fraction,
      min_stock: minStock,
      target_stock: targetStock,
      safety_margin: safetyMargin,
      round_up_order: d.round_up_order,
      unit_cost_gbp: unitCost,
      is_test_data: false,
      active: true,
    })
    .select("*")
    .single();

  if (prodErr || !product) {
    console.error("[products POST] insert failed", prodErr?.message);
    return fail(400, prodErr?.message ?? "Could not add product.");
  }

  let sessionItem: StocktakeItemDTO | null = null;
  if (d.session_id) {
    const { data: sess } = await supabase
      .from("inventory_sessions")
      .select("id, status, zone_id")
      .eq("id", d.session_id)
      .maybeSingle();

    if (sess && sess.status === "draft" && sess.zone_id === d.zone_id) {
      const closed = roundTo(toNonNeg(d.initial_closed_units, 0), 3);
      const hidden = roundTo(toNonNeg(d.initial_hidden_units, 0), 3);
      const open = d.allow_open_fraction ? roundTo(Math.min(1, toNonNeg(d.initial_open_fraction, 0)), 3) : 0;
      const total = roundTo(closed + open + hidden, 3);
      const restockInput = {
        target_stock: targetStock,
        safety_margin: safetyMargin,
        min_stock: minStock,
        conversion_factor: factor,
        round_up_order: d.round_up_order,
        unit_cost_gbp: unitCost,
      };
      const orderQty = computeRestock(restockInput, total).order_qty;

      const { data: itemRow, error: itemErr } = await supabase
        .from("inventory_items")
        .insert({
          session_id: d.session_id,
          product_id: product.id as string,
          final_closed_units: closed,
          final_open_fraction: open,
          hidden_back_units: hidden,
          reviewed: true,
          suggested_order_qty: orderQty,
        })
        .select("id")
        .single();

      if (!itemErr && itemRow) {
        sessionItem = {
          item_id: itemRow.id as string,
          product_id: product.id as string,
          code_tag: codeTag,
          name: d.name,
          brand: d.brand || null,
          category: d.category,
          supplier_id: supplierId,
          visual_hints: d.visual_hints || null,
          has_handwritten_tag: d.has_handwritten_tag,
          count_unit: d.count_unit,
          order_unit: d.order_unit,
          allow_open_fraction: d.allow_open_fraction,
          status: "confirmed",
          reasons: [],
          evidence: "Added manually",
          confidence: null,
          reviewed: true,
          restock: restockInput,
          final: { closed_units: closed, open_fraction: open, hidden_back_units: hidden },
        };
      }
    }
  }

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "product_created",
    entityType: "product",
    entityId: product.id as string,
    summary: `Added [${codeTag}] ${d.name} in ${zone.name} (${formatGBP(unitCost)} / ${d.order_unit})`,
    meta: { zone_id: d.zone_id, code_tag: codeTag, unit_cost_gbp: unitCost },
  });

  return NextResponse.json({
    product,
    supplier: supplierId ? { id: supplierId, name: supplierName } : null,
    session_item: sessionItem,
  });
}

