import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { BrandHeader } from "@/components/Brand";
import { ZoneCard, type ZoneState } from "@/components/ZoneCard";
import { formatUkDateTime, londonDay } from "@/lib/dates";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: zones }, { data: sessions }] = await Promise.all([
    supabase.from("profiles").select("full_name, role").eq("id", user!.id).single(),
    supabase.from("zones").select("id, name, description").order("sort_order"),
    supabase
      .from("inventory_sessions")
      .select("zone_id, status, created_at, completed_at, profiles(full_name)")
      .gte("created_at", new Date(Date.now() - 36 * 3600_000).toISOString())
      .order("created_at", { ascending: false }),
  ]);

  // "Today" is a UK calendar day, not a UTC one.
  const today = londonDay(new Date());
  const todays = (sessions ?? []).filter((s) => londonDay(new Date(s.created_at)) === today);
  const infoFor = (zoneId: string): { state: ZoneState; meta: string | null } => {
    const mine = todays.filter((s) => s.zone_id === zoneId);
    const completed = mine.find((s) => s.status === "completed");
    if (completed) {
      const p = (Array.isArray(completed.profiles) ? completed.profiles[0] : completed.profiles) as { full_name?: string } | null;
      const who = p?.full_name || "Team";
      const when = formatUkDateTime((completed.completed_at as string) || (completed.created_at as string));
      return { state: "done", meta: `Counted by ${who} · ${when}` };
    }
    const draft = mine[0];
    if (draft) {
      const p = (Array.isArray(draft.profiles) ? draft.profiles[0] : draft.profiles) as { full_name?: string } | null;
      const who = p?.full_name || "Team";
      const when = formatUkDateTime(draft.created_at as string);
      return { state: "in_progress", meta: `Started by ${who} · ${when}` };
    }
    return { state: "todo", meta: null };
  };

  return (
    <div className="min-h-dvh">
      <BrandHeader right={<SignOutButton />} />
      <section className="bg-brand px-5 py-8 text-white">
        <p className="text-sm font-bold">Hello, {profile?.full_name?.split(" ")[0] ?? "there"}</p>
        <h1 className="mt-1 text-5xl text-volt">Daily Stocktake</h1>
      </section>

      <main className="mx-auto max-w-md px-5 pb-16 pt-6">
        <div className="space-y-3">
          <Link href="/purchase-orders" className="btn-accent w-full">
            Purchase Orders &amp; Exports
          </Link>
          {profile?.role === "admin" && (
            <Link href="/admin" className="btn-primary w-full">
              Admin · Team &amp; Inventory
            </Link>
          )}
        </div>

        <h2 className="mb-3 mt-8 text-2xl">Choose a zone</h2>
        <ul className="space-y-3">
          {(zones ?? []).map((z) => {
            const info = infoFor(z.id);
            return (
              <li key={z.id}>
                <ZoneCard
                  href={`/stocktake/${z.id}`}
                  name={z.name}
                  description={z.description}
                  state={info.state}
                  meta={info.meta}
                />
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
