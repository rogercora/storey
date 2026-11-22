import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { londonDay } from "@/lib/dates";
import { loadSessionItems } from "@/lib/sessions";
import { StocktakeClient } from "@/components/StocktakeClient";

export default async function StocktakeZonePage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = await params;
  const supabase = await createClient();

  const [{ data: zone }, { data: allZones }, { data: suppliers }, { count: productCount }, { data: sessions }] = await Promise.all([
    supabase.from("zones").select("id, name, description").eq("id", zoneId).maybeSingle(),
    supabase.from("zones").select("id, name").order("sort_order"),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("zone_id", zoneId).eq("active", true),
    supabase
      .from("inventory_sessions")
      .select("id, status, ai_meta, created_at, completed_at, profiles(full_name)")
      .eq("zone_id", zoneId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (!zone) notFound();

  const today = londonDay();
  const todaysDraft =
    (sessions ?? []).find((d) => d.status === "draft" && londonDay(new Date(d.created_at as string)) === today) ?? null;
  const lastCompletedRow = (sessions ?? []).find((d) => d.status === "completed") ?? null;

  const ownerName = (row: (typeof sessions extends Array<infer T> | null ? T : never) | null) => {
    if (!row) return null;
    const p = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as { full_name?: string } | null;
    return p?.full_name || "Team";
  };

  const initialItems = todaysDraft ? await loadSessionItems(supabase, todaysDraft.id as string) : [];

  return (
    <StocktakeClient
      zone={zone}
      zones={allZones ?? []}
      initialSuppliers={suppliers ?? []}
      initialProductCount={productCount ?? 0}
      initialSessionId={(todaysDraft?.id as string) ?? null}
      initialSessionOwner={ownerName(todaysDraft)}
      initialSessionCreatedAt={(todaysDraft?.created_at as string) ?? null}
      lastCompleted={
        lastCompletedRow
          ? {
              by: ownerName(lastCompletedRow) ?? "Team",
              at: (lastCompletedRow.completed_at as string) || (lastCompletedRow.created_at as string),
            }
          : null
      }
      initialItems={initialItems}
      initialMeta={(todaysDraft?.ai_meta as { image_quality_issues?: string[]; unmatched_tags_seen?: string[] } | null) ?? null}
    />
  );
}
