import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { AdminClient, type AdminProductDTO, type AdminUserDTO } from "@/components/AdminClient";

export default async function AdminPage() {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) redirect("/");

  const [{ data: profiles }, { data: products }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, status").order("created_at", { ascending: true }),
    supabase
      .from("products")
      .select("id, code_tag, name, target_stock, count_unit, order_unit, unit_cost_gbp, is_test_data, zones(name), suppliers(name)")
      .eq("active", true)
      .order("code_tag"),
  ]);

  const mappedProducts: AdminProductDTO[] = (products ?? []).map((p) => {
    const z = (Array.isArray(p.zones) ? p.zones[0] : p.zones) as { name?: string } | null;
    const s = (Array.isArray(p.suppliers) ? p.suppliers[0] : p.suppliers) as { name?: string } | null;
    return {
      id: p.id as string,
      code_tag: p.code_tag as string,
      name: p.name as string,
      zone_name: z?.name ?? "",
      supplier_name: s?.name ?? "Unassigned",
      target_stock: Number(p.target_stock),
      count_unit: p.count_unit as string,
      order_unit: p.order_unit as string,
      unit_cost_gbp: Number(p.unit_cost_gbp),
      is_test_data: Boolean(p.is_test_data),
    };
  });

  return (
    <AdminClient
      currentUserId={auth.user.id}
      initialUsers={(profiles ?? []) as AdminUserDTO[]}
      initialProducts={mappedProducts}
    />
  );
}

