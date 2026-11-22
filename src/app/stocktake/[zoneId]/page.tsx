import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { londonDay } from "@/lib/dates";
import { loadSessionItems } from "@/lib/sessions";
import { StocktakeClient } from "@/components/StocktakeClient";

export default async function StocktakeZonePage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = await params;
  const supabase = await createClient();

  const [{ data: zone }, { count: productCount }, { data: drafts }] = await Promise.all([
    supabase.from("zones").select("id, name, description").eq("id", zoneId).maybeSingle(),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("zone_id", zoneId).eq("active", true),
    supabase
      .from("inventory_sessions")
      .select("id, ai_meta, created_at")
      .eq("zone_id", zoneId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  if (!zone) notFound();

  const today = londonDay();
  const todaysDraft = (drafts ?? []).find((d) => londonDay(new Date(d.created_at as string)) === today) ?? null;
  const initialItems = todaysDraft ? await loadSessionItems(supabase, todaysDraft.id as string) : [];

  return (
    <StocktakeClient
      zone={zone}
      productCount={productCount ?? 0}
      initialSessionId={(todaysDraft?.id as string) ?? null}
      initialItems={initialItems}
      initialMeta={(todaysDraft?.ai_meta as { image_quality_issues?: string[]; unmatched_tags_seen?: string[] } | null) ?? null}
    />
  );
}

