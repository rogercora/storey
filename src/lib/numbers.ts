/**
 * Number helpers shared by the review UI and the API.
 * Staff may type "0,7" or "0.7" - both must end up as the number 0.7.
 */

/** Parse a user-typed decimal. Accepts "0,7", "0.7", ".7", " 1 ", "1,234.5". Returns null if invalid. */
export function parseDecimal(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (input == null) return null;

  let s = input.trim().replace(/\s+/g, "");
  if (s === "") return null;

  if (/^-?\d+,\d+$/.test(s)) {
    // Single comma, no dot: UK staff typing a decimal comma ("0,7").
    s = s.replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    // Thousands separators ("1,234.5").
    s = s.replace(/,/g, "");
  }

  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function roundTo(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Open-box fraction: clamp to [0, 1], keep 3 dp (matches numeric(4,3)). */
export function normaliseFraction(input: string | number | null | undefined): number {
  const n = parseDecimal(input);
  return n == null ? 0 : roundTo(clamp(n, 0, 1), 3);
}

/** Format money for the UI / exports: £1,234.50 */
export function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

