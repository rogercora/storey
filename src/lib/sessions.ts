import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadingStatus } from "@/lib/ai/reconcile";
import type { RestockInput } from "@/lib/restock";

export interface StocktakeItemDTO {
  item_id: string;
  product_id: string;
  code_tag: string;
  name: string;
  brand: string | null;
  count_unit: string;
  order_unit: string;
  allow_open_fraction: boolean;
  status: ReadingStatus;
  reasons: string[];
  evidence: string | null;
  confidence: number | null;
  reviewed: boolean;
  restock: RestockInput;
  final: {
    closed_units: number;
    open_fraction: number;
    hidden_back_units: number;
  };
}

export async function loadSessionItems(supabase: SupabaseClient, sessionId: string): Promise<StocktakeItemDTO[]> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select(
      "id, product_id, ai_confidence, ai_evidence, ai_review_reasons, final_closed_units, final_open_fraction, hidden_back_units, reviewed, products(code_tag, name, brand, count_unit, order_unit, allow_open_fraction, target_stock, safety_margin, min_stock, conversion_factor, round_up_order, unit_cost_gbp)",
    )
    .eq("session_id", sessionId);

  if (error || !data) return [];

  const order: Record<ReadingStatus, number> = { needs_review: 0, confirmed: 1, unseen: 2 };

  return data
    .map((row): StocktakeItemDTO | null => {
      const p = (Array.isArray(row.products) ? row.products[0] : row.products) as {
        code_tag: string;
        name: string;
        brand: string | null;
        count_unit: string;
        order_unit: string;
        allow_open_fraction: boolean;
        target_stock: number;
        safety_margin: number;
        min_stock: number;
        conversion_factor: number;
        round_up_order: boolean;
        unit_cost_gbp: number;
      } | null;
      if (!p) return null;

      const reasons = (row.ai_review_reasons as string[]) ?? [];
      const status: ReadingStatus = row.reviewed
        ? "confirmed"
        : row.ai_confidence == null
          ? "unseen"
          : reasons.length > 0
            ? "needs_review"
            : "confirmed";

      return {
        item_id: row.id as string,
        product_id: row.product_id as string,
        code_tag: p.code_tag,
        name: p.name,
        brand: p.brand,
        count_unit: p.count_unit,
        order_unit: p.order_unit,
        allow_open_fraction: p.allow_open_fraction,
        status,
        reasons,
        evidence: (row.ai_evidence as string | null) ?? null,
        confidence: row.ai_confidence == null ? null : Number(row.ai_confidence),
        reviewed: Boolean(row.reviewed),
        restock: {
          target_stock: Number(p.target_stock),
          safety_margin: Number(p.safety_margin),
          min_stock: Number(p.min_stock),
          conversion_factor: Number(p.conversion_factor),
          round_up_order: Boolean(p.round_up_order),
          unit_cost_gbp: Number(p.unit_cost_gbp),
        },
        final: {
          closed_units: Number(row.final_closed_units ?? 0),
          open_fraction: Number(row.final_open_fraction ?? 0),
          hidden_back_units: Number(row.hidden_back_units ?? 0),
        },
      };
    })
    .filter((x): x is StocktakeItemDTO => x !== null)
    .sort((a, b) => order[a.status] - order[b.status] || a.code_tag.localeCompare(b.code_tag));
}

