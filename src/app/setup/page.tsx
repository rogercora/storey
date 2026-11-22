import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSupervisorOrAdmin } from "@/lib/auth";
import { SetupClient, type CategoryDTO, type SupplierDTO, type ZoneDTO } from "@/components/SetupClient";

export default async function SetupPage() {
  const supabase = await createClient();
  const auth = await requireSupervisorOrAdmin(supabase);
  if (!auth.ok) redirect("/");

  const [{ data: profiles }, { data: zones }, { data: suppliers }, catRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email"),
    supabase.from("zones").select("*").order("sort_order"),
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("categories").select("*").order("sort_order"),
  ]);

  const byId = new Map<string, string>((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));

  const mappedZones: ZoneDTO[] = (zones ?? []).map((z) => ({
    id: z.id as string,
    name: z.name as string,
    description: (z.description as string | null) ?? null,
    sort_order: Number(z.sort_order ?? 0),
    actor_name: (z.updated_by || z.created_by) ? byId.get((z.updated_by || z.created_by) as string) ?? null : null,
    updated_at: (z.updated_at as string | null) ?? (z.created_at as string | null) ?? null,
  }));

  const mappedCats: CategoryDTO[] = (catRes.data ?? []).map((c) => ({
    id: c.id as string,
    slug: c.slug as string,
    name: c.name as string,
    sort_order: Number(c.sort_order ?? 0),
    actor_name: (c.updated_by || c.created_by) ? byId.get((c.updated_by || c.created_by) as string) ?? null : null,
    updated_at: (c.updated_at as string | null) ?? (c.created_at as string | null) ?? null,
  }));

  const mappedSuppliers: SupplierDTO[] = (suppliers ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    contact_email: (s.contact_email as string | null) ?? null,
    contact_phone: (s.contact_phone as string | null) ?? null,
    lead_time_days: Number(s.lead_time_days ?? 1),
    notes: (s.notes as string | null) ?? null,
    actor_name: (s.updated_by || s.created_by) ? byId.get((s.updated_by || s.created_by) as string) ?? null : null,
    updated_at: (s.updated_at as string | null) ?? (s.created_at as string | null) ?? null,
  }));

  return (
    <SetupClient
      role={auth.profile.role as "admin" | "supervisor"}
      initialZones={mappedZones}
      initialCategories={mappedCats}
      initialSuppliers={mappedSuppliers}
    />
  );
}

