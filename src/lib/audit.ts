import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction =
  | "product_created"
  | "product_updated"
  | "zone_created"
  | "zone_updated"
  | "zone_deleted"
  | "category_created"
  | "category_updated"
  | "category_deleted"
  | "supplier_created"
  | "supplier_updated"
  | "supplier_deleted"
  | "stocktake_started"
  | "stocktake_completed"
  | "ai_shelf_analysed"
  | "po_created"
  | "po_approved"
  | "po_sent"
  | "csv_imported"
  | "test_data_reset"
  | "user_updated";

export async function recordActivity(
  supabase: SupabaseClient,
  entry: {
    actorId: string;
    action: AuditAction;
    entityType: "product" | "zone" | "category" | "supplier" | "session" | "purchase_order" | "profile" | "system";
    entityId?: string | null;
    summary: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("activity_log").insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      summary: entry.summary,
      meta: entry.meta ?? {},
    });
    if (error) {
      // Non-fatal in case migration 0005 hasn't been applied yet
      console.warn("[audit] activity_log insert skipped:", error.message);
    }
  } catch (e) {
    console.warn("[audit] activity_log error:", e);
  }
}

