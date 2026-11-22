import { describe, expect, it } from "vitest";
import { formatGBP, normaliseFraction, parseDecimal } from "./numbers";
import { computeRestock } from "./restock";

describe("parseDecimal", () => {
  it.each([
    ["0,7", 0.7],
    ["0.7", 0.7],
    [" 0,25 ", 0.25],
    [".5", 0.5],
    ["3", 3],
    ["1,234.5", 1234.5],
  ])("parses %s", (input, expected) => expect(parseDecimal(input)).toBe(expected));

  it.each(["", "abc", "1..2", "0,7,1x", null, undefined])("rejects %s", (input) =>
    expect(parseDecimal(input as string)).toBeNull(),
  );

  it("normaliseFraction clamps to 0..1", () => {
    expect(normaliseFraction("0,8")).toBe(0.8);
    expect(normaliseFraction("2")).toBe(1);
    expect(normaliseFraction("-1")).toBe(0);
    expect(normaliseFraction("nope")).toBe(0);
  });

  it("formats GBP", () => expect(formatGBP(1234.5)).toBe("£1,234.50"));
});

const base = {
  target_stock: 18,
  safety_margin: 2,
  min_stock: 6,
  conversion_factor: 6,
  round_up_order: true,
  unit_cost_gbp: 14.4,
};

describe("computeRestock", () => {
  it("orders the shortfall rounded UP to whole cases", () => {
    // need 20 - 7 = 13 cartons -> 13/6 = 2.17 -> 3 cases
    const r = computeRestock(base, 7);
    expect(r.needed_count_units).toBe(13);
    expect(r.order_qty).toBe(3);
    expect(r.estimated_cost_gbp).toBe(43.2);
  });

  it("orders exactly one case when the shortfall is an exact multiple", () => {
    expect(computeRestock(base, 14).order_qty).toBe(1); // need 6 -> 1 case
  });

  it("orders nothing when at or above target + safety", () => {
    expect(computeRestock(base, 20).order_qty).toBe(0);
    expect(computeRestock(base, 35).order_qty).toBe(0);
  });

  it("counts open-box fractions in the total", () => {
    // 3 closed + 0.7 open + 1 hidden = 4.7 -> need 15.3 -> 2.55 -> 3 cases
    expect(computeRestock(base, 4.7).order_qty).toBe(3);
  });

  it("does not round up when the supplier sells loose units", () => {
    const r = computeRestock({ ...base, round_up_order: false, conversion_factor: 1, unit_cost_gbp: 2 }, 17.5);
    expect(r.order_qty).toBe(2.5);
    expect(r.estimated_cost_gbp).toBe(5);
  });

  it("is float-safe (no phantom extra case)", () => {
    const r = computeRestock({ ...base, target_stock: 0.6, safety_margin: 0, conversion_factor: 0.2 }, 0);
    expect(r.order_qty).toBe(3);
  });

  it("flags below-minimum stock", () => {
    expect(computeRestock(base, 5).below_min).toBe(true);
    expect(computeRestock(base, 6).below_min).toBe(false);
  });
});

