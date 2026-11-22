import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";
import { buildShelfJsonSchema, shelfResultSchema } from "./schema";

const products = [
  { id: "p1", code_tag: "CP12", has_handwritten_tag: true, allow_open_fraction: true },
  { id: "p2", code_tag: "SY01", has_handwritten_tag: false, allow_open_fraction: false },
  { id: "p3", code_tag: "DA01", has_handwritten_tag: false, allow_open_fraction: false },
];

const item = (over: Record<string, unknown>) => ({
  code_tag: "CP12",
  identification_basis: "handwritten_code",
  visible_closed_units: 2,
  open_box_detected: false,
  open_fraction_estimate: 0,
  occlusion_suspected: false,
  estimated_hidden_units: 0,
  confidence: 0.95,
  evidence: "ok",
  ...over,
});

const run = (items: unknown[]) =>
  reconcile(shelfResultSchema.parse({ items, unmatched_tags_seen: [], image_quality_issues: [] }), products);

describe("reconcile", () => {
  it("confirms confident, alert-free readings", () => {
    const r = run([item({})]).readings.get("p1")!;
    expect(r.status).toBe("confirmed");
    expect(r.reasons).toEqual([]);
  });

  it("flags low (<0.85) and moderate (0.85-0.90) confidence", () => {
    expect(run([item({ confidence: 0.8 })]).readings.get("p1")!.reasons).toContain("low_confidence");
    const mid = run([item({ confidence: 0.87 })]).readings.get("p1")!;
    expect(mid.reasons).toContain("moderate_confidence");
    expect(mid.status).toBe("needs_review");
  });

  it("flags occlusion and open boxes even at high confidence", () => {
    const r = run([item({ occlusion_suspected: true, open_box_detected: true, open_fraction_estimate: 0.7 })]).readings.get("p1")!;
    expect(r.status).toBe("needs_review");
    expect(r.reasons).toEqual(expect.arrayContaining(["occlusion", "open_box"]));
    expect(r.open_fraction).toBe(0.7);
  });

  it("treats estimated hidden units as occlusion", () => {
    expect(run([item({ estimated_hidden_units: 2 })]).readings.get("p1")!.occlusion_warning).toBe(true);
  });

  it("ignores open fractions for products that do not allow them", () => {
    const r = run([item({ code_tag: "SY01", open_box_detected: true, open_fraction_estimate: 0.5 })]).readings.get("p2")!;
    expect(r.open_fraction).toBe(0);
    expect(r.open_box_detected).toBe(false);
  });

  it("flags handwritten-code products identified only by look", () => {
    const r = run([item({ identification_basis: "shape_and_colour" })]).readings.get("p1")!;
    expect(r.reasons).toContain("no_code_read");
  });

  it("clamps garbage numbers and never trusts unknown codes", () => {
    const out = run([item({ visible_closed_units: -4, confidence: 7 }), item({ code_tag: "ZZ99" })]);
    const r = out.readings.get("p1")!;
    expect(r.closed_units).toBe(0);
    expect(r.confidence).toBe(1);
    expect(out.unknownCodes).toEqual(["ZZ99"]);
  });

  it("merges duplicate readings, keeps warnings and forces review", () => {
    const r = run([item({ confidence: 0.99 }), item({ confidence: 0.7, occlusion_suspected: true })]).readings.get("p1")!;
    expect(r.confidence).toBe(0.99);
    expect(r.occlusion_warning).toBe(true);
    expect(r.reasons).toContain("duplicate_reading");
  });

  it("omitted products are simply absent (unseen)", () => {
    expect(run([item({})]).readings.has("p3")).toBe(false);
  });
});

describe("buildShelfJsonSchema", () => {
  it("constrains code_tag to the zone's own codes and is strict-mode compatible", () => {
    const s = buildShelfJsonSchema(["CP12", "TP12"]) as any;
    expect(s.properties.items.items.properties.code_tag.enum).toEqual(["CP12", "TP12"]);
    // OpenAI strict mode: every property required, additionalProperties false.
    const it = s.properties.items.items;
    expect(it.additionalProperties).toBe(false);
    expect(it.required.sort()).toEqual(Object.keys(it.properties).sort());
    expect(s.required.sort()).toEqual(Object.keys(s.properties).sort());
  });
});

