import { createClient } from "@/lib/supabase/server";
import { londonDay } from "@/lib/dates";
import { PurchaseOrdersClient, type PurchaseOrderDTO } from "@/components/PurchaseOrdersClient";

export default async function PurchaseOrdersPage() {
  const supabase = await createClient();

  const [{ data: pos }, { data: recentSessions }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        "id, status, total_estimated_gbp, created_at, approved_at, sent_at, suppliers(name, contact_email, contact_phone, lead_time_days), purchase_order_items(id, qty_order_units, order_unit, unit_cost_gbp, line_total_gbp, products(code_tag, name))",
      )
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("inventory_sessions")
      .select("zone_id, status, created_at")
      .eq("status", "completed")
      .gte("created_at", new Date(Date.now() - 36 * 3600_000).toISOString()),
  ]);

  const today = londonDay();
  const completedZonesToday = new Set(
    (recentSessions ?? []).filter((s) => londonDay(new Date(s.created_at as string)) === today).map((s) => s.zone_id as string),
  ).size;

  const orders: PurchaseOrderDTO[] = (pos ?? []).map((po) => {
    const sup = (Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers) as {
      name: string;
      contact_email: string | null;
      contact_phone: string | null;
      lead_time_days: number;
    } | null;
    const rawItems = (po.purchase_order_items ?? []) as Array<{
      id: string;
      qty_order_units: number;
      order_unit: string;
      unit_cost_gbp: number;
      line_total_gbp: number;
      products: { code_tag: string; name: string } | Array<{ code_tag: string; name: string }> | null;
    }>;

    return {
      id: po.id as string,
      status: po.status as "draft" | "approved" | "sent",
      total_estimated_gbp: Number(po.total_estimated_gbp ?? 0),
      created_at: po.created_at as string,
      approved_at: (po.approved_at as string | null) ?? null,
      sent_at: (po.sent_at as string | null) ?? null,
      supplier: sup ?? { name: "Supplier", contact_email: null, contact_phone: null, lead_time_days: 1 },
      items: rawItems.map((it) => {
        const prod = Array.isArray(it.products) ? it.products[0] : it.products;
        return {
          id: it.id,
          code_tag: prod?.code_tag ?? "",
          name: prod?.name ?? "Product",
          qty_order_units: Number(it.qty_order_units),
          order_unit: it.order_unit,
          unit_cost_gbp: Number(it.unit_cost_gbp),
          line_total_gbp: Number(it.line_total_gbp),
        };
      }),
    };
  });

  return <PurchaseOrdersClient initialOrders={orders} completedZonesToday={completedZonesToday} />;
}

