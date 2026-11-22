import { clamp, roundTo } from "@/lib/numbers";
import type { ShelfResult } from "./schema";

/** Review thresholds from the product spec. */
export const CONFIDENT_THRESHOLD = 0.9; // >= and no alerts -> shown green
export const LOW_THRESHOLD = 0.85; //      <  -> flagged "low confidence"; 0.85-0.90 is "moderate" (also reviewed)

export type ReviewReason =
  | "low_confidence"
  | "moderate_confidence"
  | "occlusion"
  | "open_box"
  | "no_code_read"
  | "duplicate_reading";

export type ReadingStatus = "confirmed" | "needs_review" | "unseen";

export interface ReconcileProduct {
  id: string;
  code_tag: string;
  has_handwritten_tag: boolean;
  allow_open_fraction: boolean;
}

export interface AiReading {
  closed_units: number;
  open_fraction: number;
  hidden_units_estimate: number;
  confidence: number;
  occlusion_warning: boolean;
  open_box_detected: boolean;
  evidence: string;
  status: Exclude<ReadingStatus, "unseen">;
  reasons: ReviewReason[];
}

export interface ReconcileOutput {
  /** keyed by product id; products absent from the map were "unseen". */
  readings: Map<string, AiReading>;
  /** codes the model returned that are not in the catalogue (should be impossible with the enum) */
  unknownCodes: string[];
}

/**
 * Turns raw (untrusted) model output into sane per-product readings:
 * validates ranges, maps codes to products, merges duplicates and applies the
 * human-in-the-loop thresholds.
 */
export function reconcile(result: ShelfResult, products: ReconcileProduct[]): ReconcileOutput {
  const byCode = new Map(products.map((p) => [p.code_tag.toUpperCase(), p]));
  const readings = new Map<string, AiReading>();
  const dupes = new Set<string>();
  const unknownCodes: string[] = [];

  for (const raw of result.items) {
    const product = byCode.get(raw.code_tag.trim().toUpperCase());
    if (!product) {
      unknownCodes.push(raw.code_tag);
      continue;
    }

    const openAllowed = product.allow_open_fraction;
    const hidden = roundTo(clamp(raw.estimated_hidden_units, 0, 10_000), 3);

    const next: AiReading = {
      closed_units: roundTo(clamp(raw.visible_closed_units, 0, 10_000), 3),
      open_fraction: openAllowed && raw.open_box_detected ? roundTo(clamp(raw.open_fraction_estimate, 0, 1), 3) : 0,
      hidden_units_estimate: hidden,
      confidence: roundTo(clamp(raw.confidence, 0, 1), 3),
      occlusion_warning: raw.occlusion_suspected || hidden > 0,
      open_box_detected: openAllowed && raw.open_box_detected,
      evidence: raw.evidence,
      status: "needs_review",
      reasons: [],
    };

    // Expected a handwritten code but the model only matched by look-alike cues.
    if (product.has_handwritten_tag && raw.identification_basis === "shape_and_colour") {
      next.reasons.push("no_code_read");
    }

    const prev = readings.get(product.id);
    if (prev) {
      dupes.add(product.id);
      // Keep the more confident reading, but never lose a warning.
      const keep = next.confidence >= prev.confidence ? next : prev;
      keep.occlusion_warning ||= prev.occlusion_warning || next.occlusion_warning;
      keep.open_box_detected ||= prev.open_box_detected || next.open_box_detected;
      keep.reasons = [...new Set([...prev.reasons, ...next.reasons])];
      readings.set(product.id, keep);
    } else {
      readings.set(product.id, next);
    }
  }

  for (const [productId, r] of readings) {
    const reasons = new Set<ReviewReason>(r.reasons);
    if (r.confidence < LOW_THRESHOLD) reasons.add("low_confidence");
    else if (r.confidence < CONFIDENT_THRESHOLD) reasons.add("moderate_confidence");
    if (r.occlusion_warning) reasons.add("occlusion");
    if (r.open_box_detected) reasons.add("open_box");
    if (dupes.has(productId)) reasons.add("duplicate_reading");

    r.reasons = [...reasons];
    r.status = r.reasons.length === 0 ? "confirmed" : "needs_review";
  }

  return { readings, unknownCodes };
}

