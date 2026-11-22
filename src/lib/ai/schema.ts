import { z } from "zod";

/**
 * Strict JSON Schema sent to the vision model (OpenAI Structured Outputs /
 * Gemini responseJsonSchema). `code_tag` is an ENUM of the zone's own codes, so
 * the model physically cannot answer with a product outside the closed catalogue.
 *
 * Only keywords supported by BOTH providers' strict modes are used. Numeric
 * ranges are enforced afterwards by zod + clamping in reconcile.ts.
 */
export const IMAGE_QUALITY_ISSUES = [
  "low_light",
  "glare_reflection",
  "blurry",
  "too_far",
  "partially_cropped",
  "condensation_fog",
] as const;

export const IDENTIFICATION_BASIS = [
  "handwritten_code",
  "printed_label",
  "shape_and_colour",
  "mixed",
] as const;

export function buildShelfJsonSchema(codeTags: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items", "unmatched_tags_seen", "image_quality_issues"],
    properties: {
      items: {
        type: "array",
        description: "One entry per catalogue product that is visible in the photos. Omit products you cannot see.",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "code_tag",
            "identification_basis",
            "visible_closed_units",
            "open_box_detected",
            "open_fraction_estimate",
            "occlusion_suspected",
            "estimated_hidden_units",
            "confidence",
            "evidence",
          ],
          properties: {
            code_tag: { type: "string", enum: codeTags },
            identification_basis: { type: "string", enum: [...IDENTIFICATION_BASIS] },
            visible_closed_units: {
              type: "number",
              description: "Sealed, unopened units clearly visible, in the product's count unit. Never include open/partial units or hidden units.",
            },
            open_box_detected: { type: "boolean" },
            open_fraction_estimate: {
              type: "number",
              description: "0 if no open unit. Otherwise remaining content of the open unit as a fraction between 0 and 1.",
            },
            occlusion_suspected: { type: "boolean" },
            estimated_hidden_units: {
              type: "number",
              description: "Best guess of extra units hidden behind/under visible ones. 0 if none suspected.",
            },
            confidence: {
              type: "number",
              description: "0 to 1. Calibrated confidence in BOTH the identity and the count of this line.",
            },
            evidence: { type: "string", description: "Max 120 characters: what you saw (UK English)." },
          },
        },
      },
      unmatched_tags_seen: {
        type: "array",
        description: "Handwritten codes you can read that are NOT in the catalogue.",
        items: { type: "string" },
      },
      image_quality_issues: {
        type: "array",
        items: { type: "string", enum: [...IMAGE_QUALITY_ISSUES] },
      },
    },
  } as const;
}

/** Runtime validation of whatever the model returned (never trust the wire). */
export const shelfResultSchema = z.object({
  items: z
    .array(
      z.object({
        code_tag: z.string(),
        identification_basis: z.enum(IDENTIFICATION_BASIS).catch("shape_and_colour"),
        visible_closed_units: z.coerce.number().catch(0),
        open_box_detected: z.boolean().catch(false),
        open_fraction_estimate: z.coerce.number().catch(0),
        occlusion_suspected: z.boolean().catch(false),
        estimated_hidden_units: z.coerce.number().catch(0),
        confidence: z.coerce.number().catch(0),
        evidence: z.string().catch("").transform((s) => s.slice(0, 200)),
      }),
    )
    .default([]),
  unmatched_tags_seen: z.array(z.string()).default([]),
  image_quality_issues: z.array(z.string()).default([]),
});

export type ShelfResult = z.infer<typeof shelfResultSchema>;
export type ShelfResultItem = ShelfResult["items"][number];

