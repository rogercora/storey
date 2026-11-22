import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { BrandHeader } from "@/components/Brand";
import { ZoneCard, type ZoneState } from "@/components/ZoneCard";

const londonDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);

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
      .select("zone_id, status, created_at")
      .gte("created_at", new Date(Date.now() - 36 * 3600_000).toISOString()),
  ]);

  // "Today" is a UK calendar day, not a UTC one.
  const today = londonDay(new Date());
  const todays = (sessions ?? []).filter((s) => londonDay(new Date(s.created_at)) === today);
  const statusFor = (zoneId: string): ZoneState => {
    const mine = todays.filter((s) => s.zone_id === zoneId);
    if (mine.some((s) => s.status === "completed")) return "done";
    return mine.length ? "in_progress" : "todo";
  };

  return (
    <div className="min-h-dvh">
      <BrandHeader right={<SignOutButton />} />
      <section className="bg-brand px-5 py-8 text-white">
        <p className="text-sm font-bold">Hello, {profile?.full_name?.split(" ")[0] ?? "there"}</p>
        <h1 className="mt-1 text-5xl text-volt">Daily Stocktake</h1>
      </section>

      <main className="mx-auto max-w-md px-5 pb-16 pt-6">
        {profile?.role === "admin" && (
          <Link href="/admin" className="btn-primary w-full">Admin · Team &amp; Inventory</Link>
        )}

        <h2 className="mb-3 mt-8 text-2xl">Choose a zone</h2>
        <ul className="space-y-3">
          {(zones ?? []).map((z) => (
            <li key={z.id}>
              <ZoneCard href={`/stocktake/${z.id}`} name={z.name} description={z.description} state={statusFor(z.id)} />
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
