import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildShelfJsonSchema, shelfResultSchema } from "@/lib/ai/schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";
import { runVision, VisionError, type VisionImage } from "@/lib/ai/vision";
import { reconcile, type ReadingStatus } from "@/lib/ai/reconcile";
import { computeRestock } from "@/lib/restock";
import { recordActivity } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PHOTOS = Number(process.env.AI_MAX_PHOTOS ?? 4);
const MAX_PHOTO_BYTES = Number(process.env.AI_MAX_PHOTO_MB ?? 6) * 1024 * 1024;

const fieldsSchema = z.object({
  zone_id: z.string().uuid(),
  session_id: z.string().uuid().optional(),
});

interface ProductRow {
  id: string;
  code_tag: string;
  name: string;
  brand: string | null;
  visual_hints: string | null;
  count_unit: string;
  order_unit: string;
  conversion_factor: number;
  default_shelf_depth: number;
  has_handwritten_tag: boolean;
  allow_open_fraction: boolean;
  min_stock: number;
  target_stock: number;
  safety_margin: number;
  round_up_order: boolean;
  unit_cost_gbp: number;
}

/** Detect the real image type from magic bytes (never trust the client's Content-Type). */
function sniffImageType(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * POST /api/analyze-shelf   (multipart/form-data)
 *   zone_id     uuid            required
 *   session_id  uuid            optional - add more photos to an existing DRAFT session
 *   photos      File[] 1..N     jpeg / png / webp
 *
 * 1. Auth + status = 'active'            4. Strict structured-output vision call
 * 2. Load the zone's closed catalogue    5. Reconcile + thresholds (human-in-the-loop)
 * 3. Validate photos                     6. Persist draft session + items, store photos
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireActiveUser(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);
  const { user } = auth;

  // ---- parse input -------------------------------------------------------
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Invalid form data.");
  }

  const fields = fieldsSchema.safeParse({
    zone_id: form.get("zone_id"),
    session_id: form.get("session_id") || undefined,
  });
  if (!fields.success) return fail(400, "A valid zone is required.");
  const { zone_id, session_id } = fields.data;

  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail(400, "Please add at least one photo.");
  if (files.length > MAX_PHOTOS) return fail(400, `You can analyse up to ${MAX_PHOTOS} photos at a time.`);

  const photos: { buffer: Buffer; mime: "image/jpeg" | "image/png" | "image/webp" }[] = [];
  for (const f of files) {
    if (f.size > MAX_PHOTO_BYTES) return fail(413, `Each photo must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
    const buffer = Buffer.from(await f.arrayBuffer());
    const mime = sniffImageType(buffer);
    if (!mime) return fail(415, "Only JPEG, PNG or WebP photos are supported.");
    photos.push({ buffer, mime });
  }

  // ---- zone + closed catalogue (RLS: only active users can read these) ----
  const { data: zone } = await supabase.from("zones").select("id, name").eq("id", zone_id).maybeSingle();
  if (!zone) return fail(404, "Zone not found.");

  const { data: productRows, error: prodErr } = await supabase
    .from("products")
    .select(
      "id, code_tag, name, brand, visual_hints, count_unit, order_unit, conversion_factor, default_shelf_depth, has_handwritten_tag, allow_open_fraction, min_stock, target_stock, safety_margin, round_up_order, unit_cost_gbp",
    )
    .eq("zone_id", zone_id)
    .eq("active", true)
    .order("code_tag");
  if (prodErr) return fail(500, "Could not load the product list.");
  const products = (productRows ?? []) as ProductRow[];
  if (products.length === 0) return fail(422, "This zone has no active products yet. Ask your manager to add some.");

  // ---- existing draft session (optional) ----------------------------------
  let existingPhotos: string[] = [];
  let reviewedProductIds = new Set<string>();
  if (session_id) {
    const { data: s } = await supabase
      .from("inventory_sessions")
      .select("id, zone_id, status, photo_urls")
      .eq("id", session_id)
      .maybeSingle();
    if (!s || s.zone_id !== zone_id) return fail(404, "Stocktake session not found.");
    if (s.status !== "draft") return fail(409, "This stocktake is already completed.");
    existingPhotos = Array.isArray(s.photo_urls) ? (s.photo_urls as string[]) : [];

    const { data: prior } = await supabase.from("inventory_items").select("product_id, reviewed").eq("session_id", session_id);
    reviewedProductIds = new Set((prior ?? []).filter((r) => r.reviewed).map((r) => r.product_id as string));
  }

  // ---- vision call (AI first: if it fails nothing is persisted; client keeps the photos) ----
  const images: VisionImage[] = photos.map((p) => ({ mimeType: p.mime, base64: p.buffer.toString("base64") }));
  let vision;
  try {
    vision = await runVision({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(zone.name, products, photos.length),
      images,
      jsonSchema: buildShelfJsonSchema(products.map((p) => p.code_tag)),
    });
  } catch (e) {
    if (e instanceof VisionError) return fail(e.status, e.message);
    console.error("[analyze-shelf] unexpected vision failure", e);
    return fail(502, "AI analysis failed.");
  }

  const parsed = shelfResultSchema.safeParse(vision.json);
  if (!parsed.success) {
    console.error("[analyze-shelf] schema mismatch", parsed.error.flatten());
    return fail(502, "AI returned an unexpected response. Please retry.");
  }
  const { readings, unknownCodes } = reconcile(parsed.data, products);

  // ---- persist: session ----------------------------------------------------
  let sessionId = session_id;
  if (!sessionId) {
    const { data: created, error } = await supabase
      .from("inventory_sessions")
      .insert({ zone_id, counted_by: user.id })
      .select("id")
      .single();
    if (error || !created) return fail(500, "Could not start the stocktake session.");
    sessionId = created.id as string;
  }

  // ---- persist: photos (private bucket, path = <user>/<session>/<ts>-<n>.<ext>) ----
  const stamp = Date.now();
  const uploaded: string[] = [];
  for (const [i, p] of photos.entries()) {
    const path = `${user.id}/${sessionId}/${stamp}-${i}.${EXT[p.mime]}`;
    const { error } = await supabase.storage.from("shelf-photos").upload(path, p.buffer, { contentType: p.mime, upsert: false });
    if (error) console.error("[analyze-shelf] photo upload failed", error.message);
    else uploaded.push(path);
  }

  const { error: sessErr } = await supabase
    .from("inventory_sessions")
    .update({
      photo_urls: [...existingPhotos, ...uploaded],
      ai_meta: {
        provider: vision.provider,
        model: vision.model,
        latency_ms: vision.latencyMs,
        unmatched_tags_seen: parsed.data.unmatched_tags_seen,
        unknown_codes: unknownCodes,
        image_quality_issues: parsed.data.image_quality_issues,
      },
    })
    .eq("id", sessionId);
  if (sessErr) console.error("[analyze-shelf] session update failed", sessErr.message);

  // ---- persist: one row per catalogue product (unseen products start at 0) ----
  const rows = products
    .filter((p) => !reviewedProductIds.has(p.id)) // never overwrite something a human already confirmed
    .map((p) => {
      const r = readings.get(p.id);
      const closed = r?.closed_units ?? 0;
      const fraction = r?.open_fraction ?? 0;
      const total = closed + fraction; // hidden units start at 0 until the human adds them
      return {
        session_id: sessionId,
        product_id: p.id,
        ai_closed_units: r ? r.closed_units : null,
        ai_open_fraction: r ? r.open_fraction : null,
        ai_hidden_units_estimate: r ? r.hidden_units_estimate : null,
        ai_confidence: r ? r.confidence : null,
        ai_occlusion_warning: r?.occlusion_warning ?? false,
        ai_open_box_detected: r?.open_box_detected ?? false,
        ai_evidence: r?.evidence ?? null,
        ai_review_reasons: r?.reasons ?? [],
        final_closed_units: closed,
        final_open_fraction: fraction,
        hidden_back_units: 0,
        suggested_order_qty: computeRestock(p, total).order_qty,
      };
    });

  if (rows.length > 0) {
    const { error } = await supabase.from("inventory_items").upsert(rows, { onConflict: "session_id,product_id" });
    if (error) {
      console.error("[analyze-shelf] item upsert failed", error.message);
      return fail(500, "Could not save the stocktake items.");
    }
  }

  const { data: saved, error: readErr } = await supabase
    .from("inventory_items")
    .select(
      "id, product_id, ai_confidence, ai_closed_units, ai_open_fraction, ai_hidden_units_estimate, ai_occlusion_warning, ai_open_box_detected, ai_evidence, ai_review_reasons, final_closed_units, final_open_fraction, hidden_back_units, total_counted, reviewed, suggested_order_qty",
    )
    .eq("session_id", sessionId);
  if (readErr || !saved) return fail(500, "Could not read back the stocktake items.");

  // ---- response -----------------------------------------------------------
  const byId = new Map(products.map((p) => [p.id, p]));
  const order: Record<ReadingStatus, number> = { needs_review: 0, confirmed: 1, unseen: 2 };

  const items = saved
    .map((row) => {
      const p = byId.get(row.product_id as string)!;
      const status: ReadingStatus = row.reviewed
        ? "confirmed"
        : row.ai_confidence == null
          ? "unseen"
          : (row.ai_review_reasons as string[]).length > 0
            ? "needs_review"
            : "confirmed";
      return {
        item_id: row.id as string,
        product_id: p.id,
        code_tag: p.code_tag,
        name: p.name,
        brand: p.brand,
        count_unit: p.count_unit,
        order_unit: p.order_unit,
        allow_open_fraction: p.allow_open_fraction,
        status,
        reasons: row.ai_review_reasons as string[],
        evidence: row.ai_evidence as string | null,
        ai: {
          confidence: row.ai_confidence as number | null,
          closed_units: row.ai_closed_units as number | null,
          open_fraction: row.ai_open_fraction as number | null,
          hidden_units_estimate: row.ai_hidden_units_estimate as number | null,
          occlusion_warning: row.ai_occlusion_warning as boolean,
          open_box_detected: row.ai_open_box_detected as boolean,
        },
        final: {
          closed_units: row.final_closed_units as number,
          open_fraction: row.final_open_fraction as number,
          hidden_back_units: row.hidden_back_units as number,
        },
        total_counted: row.total_counted as number,
        suggested_order_qty: row.suggested_order_qty as number,
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.code_tag.localeCompare(b.code_tag));

  await recordActivity(supabase, {
    actorId: user.id,
    action: "ai_shelf_analysed",
    entityType: "session",
    entityId: sessionId,
    summary: `Analysed ${photos.length} photo(s) in ${zone.name}`,
    meta: { zone_id, photos: photos.length, provider: vision.provider },
  });

  return NextResponse.json({
    session_id: sessionId,
    zone: { id: zone.id, name: zone.name },
    summary: {
      confirmed: items.filter((i) => i.status === "confirmed").length,
      needs_review: items.filter((i) => i.status === "needs_review").length,
      unseen: items.filter((i) => i.status === "unseen").length,
    },
    unmatched_tags_seen: parsed.data.unmatched_tags_seen,
    image_quality_issues: parsed.data.image_quality_issues,
    photos_stored: uploaded.length,
    meta: { provider: vision.provider, model: vision.model, latency_ms: vision.latencyMs },
    items,
  });
}

