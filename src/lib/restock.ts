import { roundTo } from "./numbers";

/**
 * Deterministic restock maths. The AI never decides what to order.
 *
 *   order_needed (count units) = max(0, (target_stock + safety_margin) - total_counted)
 *   order qty (order units)    = order_needed / conversion_factor
 *                                -> rounded UP to a whole case when round_up_order
 *
 * Stock levels are held in COUNT units; the supplier is ordered in ORDER units;
 * conversion_factor = count units per order unit.
 */
export interface RestockInput {
  target_stock: number;
  safety_margin: number;
  min_stock: number;
  conversion_factor: number;
  round_up_order: boolean;
  unit_cost_gbp: number; // per ORDER unit
}

export interface RestockResult {
  /** Shortfall in count units (>= 0). */
  needed_count_units: number;
  /** Quantity to buy in supplier order units (>= 0). */
  order_qty: number;
  estimated_cost_gbp: number;
  below_min: boolean;
}

export function computeRestock(p: RestockInput, totalCounted: number): RestockResult {
  const factor = p.conversion_factor > 0 ? p.conversion_factor : 1;
  const counted = Math.max(0, totalCounted);

  const needed = Math.max(0, roundTo(p.target_stock + p.safety_margin - counted, 4));

  let orderQty = 0;
  if (needed > 0) {
    const raw = needed / factor;
    orderQty = p.round_up_order
      ? Math.ceil(roundTo(raw, 6)) // 2.0000000001 must not become 3
      : Math.ceil(roundTo(raw * 100, 6)) / 100; // 2 dp, never rounds a real need down to 0
  }

  return {
    needed_count_units: needed,
    order_qty: orderQty,
    estimated_cost_gbp: roundTo(orderQty * p.unit_cost_gbp, 2),
    below_min: counted < p.min_stock,
  };
}

