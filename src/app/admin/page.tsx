import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { AdminClient, type ActivityDTO, type AdminProductDTO, type AdminUserDTO } from "@/components/AdminClient";

export default async function AdminPage() {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) redirect("/");

  const [{ data: profiles }, { data: zones }, { data: suppliers }, catRes, { data: products }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, status").order("created_at", { ascending: true }),
    supabase.from("zones").select("id, name").order("sort_order"),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("categories").select("slug, name").order("sort_order"),
    supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("code_tag"),
  ]);

  const profileById = new Map<string, string>((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));
  const zoneById = new Map<string, string>((zones ?? []).map((z) => [z.id as string, z.name as string]));
  const supplierById = new Map<string, string>((suppliers ?? []).map((s) => [s.id as string, s.name as string]));

  const mappedProducts: AdminProductDTO[] = (products ?? []).map((p) => ({
    id: p.id as string,
    zone_id: p.zone_id as string,
    supplier_id: (p.supplier_id as string | null) ?? null,
    code_tag: p.code_tag as string,
    name: p.name as string,
    brand: (p.brand as string | null) ?? null,
    category: (p.category as string) ?? "other",
    visual_hints: (p.visual_hints as string | null) ?? null,
    has_handwritten_tag: Boolean(p.has_handwritten_tag),
    count_unit: p.count_unit as string,
    order_unit: p.order_unit as string,
    conversion_factor: Number(p.conversion_factor),
    allow_open_fraction: Boolean(p.allow_open_fraction),
    min_stock: Number(p.min_stock),
    target_stock: Number(p.target_stock),
    safety_margin: Number(p.safety_margin),
    round_up_order: Boolean(p.round_up_order),
    unit_cost_gbp: Number(p.unit_cost_gbp),
    zone_name: zoneById.get(p.zone_id as string) ?? "",
    supplier_name: p.supplier_id ? supplierById.get(p.supplier_id as string) ?? "Unassigned" : "Unassigned",
    is_test_data: Boolean(p.is_test_data),
    created_by_name: p.created_by ? profileById.get(p.created_by as string) ?? null : null,
    updated_by_name: p.updated_by ? profileById.get(p.updated_by as string) ?? null : null,
    updated_at: (p.updated_at as string | null) ?? null,
  }));

  // Load activity_log gracefully (works even before migration 0005 is applied).
  let activity: ActivityDTO[] = [];
  const { data: logs, error: logErr } = await supabase
    .from("activity_log")
    .select("id, actor_id, action, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(60);

  if (!logErr && logs) {
    activity = logs.map((l) => ({
      id: l.id as string,
      actor_name: l.actor_id ? profileById.get(l.actor_id as string) ?? "Team member" : "System",
      action: l.action as string,
      summary: l.summary as string,
      created_at: l.created_at as string,
    }));
  }

  return (
    <AdminClient
      currentUserId={auth.user.id}
      zones={zones ?? []}
      categories={catRes.data ?? []}
      initialSuppliers={suppliers ?? []}
      initialUsers={(profiles ?? []) as AdminUserDTO[]}
      initialProducts={mappedProducts}
      initialActivity={activity}
    />
  );
}
