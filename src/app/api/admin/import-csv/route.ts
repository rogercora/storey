import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsvRecords } from "@/lib/csv";
import { parseDecimal } from "@/lib/numbers";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * POST /api/admin/import-csv
 * Bulk imports (upserts by code_tag) real products, suppliers, and missing zones.
 * Admin only. Sets is_test_data = false and active = true.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  let csvText = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return fail(400, "Please choose a CSV file.");
    if (file.size > 4 * 1024 * 1024) return fail(413, "CSV file must be under 4 MB.");
    csvText = await file.text();
  } else {
    csvText = await request.text();
  }

  const rows = parseCsvRecords(csvText);
  if (rows.length === 0) return fail(400, "The CSV file appears empty or has no data rows.");
  if (rows.length > 2000) return fail(400, "Maximum 2,000 rows per import.");

  const admin = createAdminClient();

  const [{ data: existingZones }, { data: existingSuppliers }, { data: existingCategories }] = await Promise.all([
    admin.from("zones").select("id, name"),
    admin.from("suppliers").select("id, name"),
    admin.from("categories").select("slug, name"),
  ]);

  const zoneMap = new Map<string, string>((existingZones ?? []).map((z) => [z.name.toLowerCase(), z.id as string]));
  const supplierMap = new Map<string, string>((existingSuppliers ?? []).map((s) => [s.name.toLowerCase(), s.id as string]));
  const categorySlugs = new Set<string>((existingCategories ?? []).map((c) => c.slug as string));

  function parseBool(v: string | undefined, fallback: boolean): boolean {
    if (!v) return fallback;
    const s = v.trim().toLowerCase();
    if (["true", "yes", "1", "y"].includes(s)) return true;
    if (["false", "no", "0", "n"].includes(s)) return false;
    return fallback;
  }

  const errors: string[] = [];
  const productPayloads: Array<Record<string, unknown>> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 2; // 1-based header + data row

    const codeTag = (row.code_tag ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const name = (row.name ?? "").trim();
    const zoneName = (row.zone ?? row.zone_name ?? "").trim();
    const supplierName = (row.supplier ?? row.supplier_name ?? "").trim();

    if (!/^[A-Z0-9]{2,8}$/.test(codeTag)) {
      errors.push(`Row ${rowNum}: code_tag must be 2-8 letters/numbers (got "${row.code_tag ?? ""}").`);
      continue;
    }
    if (!name) {
      errors.push(`Row ${rowNum} (${codeTag}): product name is required.`);
      continue;
    }
    if (!zoneName) {
      errors.push(`Row ${rowNum} (${codeTag}): zone is required.`);
      continue;
    }

    // Create zone on the fly if missing
    let zoneId = zoneMap.get(zoneName.toLowerCase());
    if (!zoneId) {
      const { data: createdZone, error: zErr } = await admin
        .from("zones")
        .insert({ name: zoneName, sort_order: (zoneMap.size + 1) * 10 })
        .select("id")
        .single();
      if (zErr || !createdZone) {
        errors.push(`Row ${rowNum} (${codeTag}): could not create zone "${zoneName}".`);
        continue;
      }
      zoneId = createdZone.id as string;
      zoneMap.set(zoneName.toLowerCase(), zoneId);
    }

    // Create/reuse supplier if supplied
    let supplierId: string | null = null;
    if (supplierName) {
      supplierId = supplierMap.get(supplierName.toLowerCase()) ?? null;
      if (!supplierId) {
        const leadDays = Math.max(0, Math.round(parseDecimal(row.lead_time_days) ?? 1));
        const { data: createdSup, error: sErr } = await admin
          .from("suppliers")
          .insert({
            name: supplierName,
            contact_email: row.supplier_email || null,
            contact_phone: row.supplier_phone || null,
            lead_time_days: leadDays,
            is_test_data: false,
          })
          .select("id")
          .single();
        if (sErr || !createdSup) {
          errors.push(`Row ${rowNum} (${codeTag}): could not create supplier "${supplierName}".`);
          continue;
        }
        supplierId = createdSup.id as string;
        supplierMap.set(supplierName.toLowerCase(), supplierId);
      }
    }

    const rawCatName = (row.category ?? "other").trim();
    const rawSlug = rawCatName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "other";
    let category = "other";
    if (/^[a-z0-9_]{2,32}$/.test(rawSlug)) {
      if (!categorySlugs.has(rawSlug)) {
        const pretty = rawCatName.charAt(0).toUpperCase() + rawCatName.slice(1);
        const { error: catErr } = await admin.from("categories").insert({ slug: rawSlug, name: pretty, sort_order: (categorySlugs.size + 1) * 10 });
        if (!catErr) categorySlugs.add(rawSlug);
      }
      if (categorySlugs.has(rawSlug)) category = rawSlug;
    }
    const factor = parseDecimal(row.conversion_factor) ?? 1;
    const minStock = Math.max(0, parseDecimal(row.min_stock) ?? 0);
    const targetStock = Math.max(0, parseDecimal(row.target_stock) ?? 0);
    const safetyMargin = Math.max(0, parseDecimal(row.safety_margin) ?? 0);
    const unitCost = Math.max(0, parseDecimal(row.unit_cost_gbp) ?? 0);
    const depth = Math.max(1, Math.round(parseDecimal(row.default_shelf_depth) ?? 1));

    productPayloads.push({
      zone_id: zoneId,
      supplier_id: supplierId,
      code_tag: codeTag,
      has_handwritten_tag: parseBool(row.has_handwritten_tag, false),
      name,
      brand: row.brand || null,
      category,
      visual_hints: row.visual_hints || null,
      count_unit: (row.count_unit || "unit").trim(),
      order_unit: (row.order_unit || "case").trim(),
      conversion_factor: factor > 0 ? factor : 1,
      default_shelf_depth: depth,
      allow_open_fraction: parseBool(row.allow_open_fraction, true),
      min_stock: minStock,
      target_stock: targetStock,
      safety_margin: safetyMargin,
      round_up_order: parseBool(row.round_up_order, true),
      unit_cost_gbp: unitCost,
      is_test_data: false,
      active: true,
    });
  }

  let imported = 0;
  if (productPayloads.length > 0) {
    // Upsert one by one or in chunks against unique upper(code_tag).
    // Because products_code_tag_uidx is on upper(code_tag), match existing code_tag case-insensitively.
    const { data: existingProducts } = await admin.from("products").select("id, code_tag");
    const existingByCode = new Map<string, string>(
      (existingProducts ?? []).map((p) => [(p.code_tag as string).toUpperCase(), p.id as string]),
    );

    const toInsert: Array<Record<string, unknown>> = [];
    for (const payload of productPayloads) {
      const existingId = existingByCode.get(String(payload.code_tag).toUpperCase());
      if (existingId) {
        const { error: uErr } = await admin.from("products").update(payload).eq("id", existingId);
        if (uErr) errors.push(`${payload.code_tag}: ${uErr.message}`);
        else imported++;
      } else {
        toInsert.push(payload);
      }
    }

    if (toInsert.length > 0) {
      const { error: iErr, data: inserted } = await admin.from("products").insert(toInsert).select("id");
      if (iErr) errors.push(`Bulk insert error: ${iErr.message}`);
      else imported += inserted?.length ?? toInsert.length;
    }
  }

  await recordActivity(supabase, {
    actorId: auth.user.id,
    action: "csv_imported",
    entityType: "system",
    summary: `Imported ${imported} of ${rows.length} product(s) via CSV`,
  });

  return NextResponse.json({
    ok: errors.length === 0,
    imported,
    total_rows: rows.length,
    errors,
  });
}

