import { BrandHeader, Wordmark } from "@/components/Brand";
import { ZoneCard } from "@/components/ZoneCard";
import { ReviewItemCard, type ReviewItemProps } from "@/components/ReviewItemCard";

/** DESIGN PREVIEW - mock data only, no Supabase, dev-only (see middleware.ts). */
export const metadata = { title: "Design preview · Daily Stocktake" };

function Phone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="shrink-0">
      <div className="h-[780px] w-[390px] overflow-y-auto rounded-[2.5rem] border-[10px] border-ink bg-paper shadow-2xl">{children}</div>
      <figcaption className="mt-3 text-center font-display text-xl uppercase text-white">{title}</figcaption>
    </figure>
  );
}

const cartonRestock = { target_stock: 18, safety_margin: 2, min_stock: 6, conversion_factor: 6, round_up_order: true, unit_cost_gbp: 14.4 };
const boxRestock = { target_stock: 4, safety_margin: 1, min_stock: 1, conversion_factor: 1, round_up_order: true, unit_cost_gbp: 62 };

const items: ReviewItemProps[] = [
  {
    code: "CP12", name: "12oz Hot Cups (box of 1000)", countUnit: "box", orderUnit: "box", status: "needs_review",
    reasons: ["occlusion", "open_box"], evidence: "2 sealed boxes, CP12 on front, 1 open box on top, more boxes behind",
    confidence: 0.82, allowOpenFraction: true, restock: boxRestock, initial: { closed: 2, open: 0.7, hidden: 0 },
  },
  {
    code: "SY01", name: "Vanilla Syrup 1L", countUnit: "bottle", orderUnit: "case", status: "needs_review",
    reasons: ["low_confidence"], evidence: "Label partly hidden by glare, could be caramel",
    confidence: 0.64, allowOpenFraction: false,
    restock: { target_stock: 6, safety_margin: 1, min_stock: 2, conversion_factor: 6, round_up_order: true, unit_cost_gbp: 38.5 },
    initial: { closed: 3, open: 0, hidden: 0 },
  },
  {
    code: "DA01", name: "Oat Milk 1L (Barista)", countUnit: "carton", orderUnit: "case", status: "confirmed",
    reasons: [], confidence: 0.96, allowOpenFraction: false, restock: cartonRestock, initial: { closed: 7, open: 0, hidden: 0 },
  },
  {
    code: "TP12", name: "12oz Lids (box of 1000)", countUnit: "box", orderUnit: "box", status: "unseen",
    reasons: [], confidence: null, allowOpenFraction: true, restock: boxRestock, initial: { closed: 0, open: 0, hidden: 0 },
  },
];

export default function PreviewPage() {
  return (
    <main className="min-h-dvh bg-neutral-900 px-6 py-10">
      <h1 className="text-center text-5xl text-volt">Design preview</h1>
      <p className="mx-auto mt-3 max-w-xl text-center text-sm text-white/70">
        Mock data only. The review cards are live: try the − / + buttons and the open-box shortcuts (or type 0,7).
      </p>

      <div className="mt-10 flex gap-8 overflow-x-auto pb-6 lg:justify-center">
        {/* 1 - Login */}
        <Phone title="Sign in">
          <BrandHeader />
          <section className="bg-brand px-5 py-10 text-center text-white">
            <h1 className="text-5xl text-volt">Daily Stocktake</h1>
            <p className="mt-3 font-bold">Sign in to start counting.</p>
          </section>
          <div className="space-y-4 px-5 py-8">
            <label className="block text-sm font-bold">Email<input className="input mt-1" defaultValue="sam@cafe.co.uk" /></label>
            <label className="block text-sm font-bold">Password<input className="input mt-1" type="password" defaultValue="password123" /></label>
            <button className="btn-accent w-full">Sign in</button>
            <p className="text-center text-sm">New to the team? <b className="underline">Create an account</b></p>
          </div>
        </Phone>

        {/* 2 - Pending */}
        <Phone title="Pending approval">
          <div className="flex min-h-full flex-col bg-plum text-white">
            <div className="px-5 py-4"><Wordmark /></div>
            <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
              <h1 className="text-5xl text-volt">Account Pending Approval</h1>
              <p className="mt-4 text-lg font-semibold">Please ask your manager to activate your access.</p>
              <div className="mt-8 flex gap-3">
                <button className="btn-accent">Check again</button>
                <button className="btn border-2 border-white text-white">Sign out</button>
              </div>
            </div>
          </div>
        </Phone>

        {/* 3 - Dashboard */}
        <Phone title="Zones · Daily Stocktake">
          <BrandHeader right={<button className="btn border-2 border-white text-white">Sign out</button>} />
          <section className="bg-brand px-5 py-8 text-white">
            <p className="text-sm font-bold">Hello, Sam</p>
            <h1 className="mt-1 text-5xl text-volt">Daily Stocktake</h1>
          </section>
          <div className="px-5 pb-10 pt-6">
            <button className="btn-primary w-full">Admin · Team &amp; Inventory</button>
            <h2 className="mb-3 mt-8 text-2xl">Choose a zone</h2>
            <ul className="space-y-3">
              <li><ZoneCard href="#" name="Front Display" description="Front counter and display cabinet" state="done" /></li>
              <li><ZoneCard href="#" name="Dry Store" description="Ambient shelving: coffee, syrups" state="in_progress" /></li>
              <li><ZoneCard href="#" name="Chiller / Fridge" description="Walk-in chiller and fridges" state="todo" /></li>
              <li><ZoneCard href="#" name="Kitchen" description="Kitchen prep and baking" state="todo" /></li>
              <li><ZoneCard href="#" name="Packaging" description="Cups, lids and take-away" state="todo" /></li>
            </ul>
          </div>
        </Phone>

        {/* 4 - Camera */}
        <Phone title="Photo capture">
          <BrandHeader right={<span className="chip bg-volt text-ink">Packaging</span>} />
          <div className="px-5 py-6">
            <h2 className="text-3xl">Photograph the shelf</h2>
            <p className="mt-1 text-sm text-ink-soft">Make sure the handwritten codes (e.g. CP12) face the camera.</p>
            <div className="mt-4 flex aspect-[3/4] items-center justify-center border-2 border-dashed border-ink bg-ink/80 text-center text-white">
              <div><p className="font-display text-2xl text-volt">Camera view</p><p className="mt-1 text-sm">Tap to open camera</p></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button className="btn-secondary">🔦 Torch</button>
              <button className="btn-secondary">Upload</button>
            </div>
            <p className="mt-4 bg-warn-light px-3 py-2 text-sm font-semibold text-warn">Offline: 2 photos queued. They will upload automatically.</p>
            <button className="btn-accent mt-4 w-full">Analyse 2 photos</button>
          </div>
        </Phone>

        {/* 5 - Review */}
        <Phone title="Quick review">
          <BrandHeader right={<span className="chip bg-volt text-ink">Packaging</span>} />
          <section className="bg-brand px-5 py-5 text-white">
            <h1 className="text-4xl text-volt">Quick review</h1>
            <div className="mt-3 flex gap-2 text-sm font-bold">
              <span className="bg-volt px-2 py-1 text-ink">2 to check</span>
              <span className="bg-white px-2 py-1 text-ink">1 confirmed</span>
              <span className="bg-white/20 px-2 py-1">1 not seen</span>
            </div>
          </section>
          <div className="space-y-4 px-4 py-5">
            <h2 className="text-xl">Check these first</h2>
            {items.filter((i) => i.status === "needs_review").map((i) => <ReviewItemCard key={i.code} {...i} />)}
            <h2 className="pt-2 text-xl">Confirmed</h2>
            {items.filter((i) => i.status === "confirmed").map((i) => <ReviewItemCard key={i.code} {...i} />)}
            <h2 className="pt-2 text-xl">Not seen in photo (0)</h2>
            {items.filter((i) => i.status === "unseen").map((i) => <ReviewItemCard key={i.code} {...i} />)}
            <button className="btn-accent w-full">Finish stocktake</button>
          </div>
        </Phone>

        {/* 6 - PO */}
        <Phone title="Purchase orders">
          <BrandHeader />
          <section className="bg-brand px-5 py-5 text-white">
            <h1 className="text-4xl text-volt">Purchase orders</h1>
            <p className="mt-2 text-sm font-bold">Draft · 22 Nov 2026 · Total £350.40</p>
          </section>
          <div className="space-y-4 px-4 py-5">
            {[
              { s: "PackRight Supplies", lines: [["CP12 · 12oz Hot Cups", "2 box", "£124.00"], ["TP12 · 12oz Lids", "4 box", "£164.00"]], total: "£288.00" },
              { s: "Fresh Dairy Ltd", lines: [["DA01 · Oat Milk 1L", "3 case", "£43.20"], ["DA02 · Whole Milk 4 pint", "2 case", "£19.20"]], total: "£62.40" },
            ].map((po) => (
              <section key={po.s} className="border-2 border-ink bg-card">
                <div className="flex items-center justify-between bg-ink px-3 py-2 text-white">
                  <h3 className="text-xl">{po.s}</h3><span className="chip bg-volt text-ink">Draft</span>
                </div>
                <ul className="divide-y divide-line px-3">
                  {po.lines.map(([n, q, c]) => (
                    <li key={n} className="flex items-center justify-between py-3 text-sm"><span className="font-semibold">{n}</span><span>{q} · <b>{c}</b></span></li>
                  ))}
                </ul>
                <div className="flex items-center justify-between border-t-2 border-ink px-3 py-3">
                  <span className="font-display text-xl">Total {po.total}</span>
                  <button className="btn-accent !min-h-10">Approve</button>
                </div>
              </section>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-secondary">Export .xlsx</button>
              <button className="btn-secondary">Export .csv</button>
            </div>
          </div>
        </Phone>

        {/* 7 - Admin */}
        <Phone title="Admin · Team">
          <BrandHeader />
          <section className="bg-plum px-5 py-5 text-white">
            <h1 className="text-4xl text-volt">Team / Users</h1>
          </section>
          <div className="space-y-3 px-4 py-5">
            {[
              ["Jamie Cole", "jamie@cafe.co.uk", "Pending"],
              ["Priya Shah", "priya@cafe.co.uk", "Active"],
              ["Tom Reid", "tom@cafe.co.uk", "Suspended"],
            ].map(([n, e, s]) => (
              <div key={n} className="card">
                <div className="flex items-center justify-between"><p className="font-display text-xl uppercase">{n}</p>
                  <span className={`chip ${s === "Pending" ? "bg-volt text-ink" : s === "Active" ? "bg-brand text-white" : "bg-accent text-white"}`}>{s}</span></div>
                <p className="text-sm text-ink-soft">{e}</p>
                <div className="mt-3 flex gap-2">
                  {s !== "Active" && <button className="btn-accent !min-h-10 flex-1">Approve</button>}
                  {s === "Active" && <button className="btn-secondary !min-h-10 flex-1">Suspend</button>}
                  <button className="btn-secondary !min-h-10 flex-1">Make admin</button>
                </div>
              </div>
            ))}
            <h2 className="pt-4 text-2xl">Go live</h2>
            <button className="btn-primary w-full">Import real inventory (CSV)</button>
            <button className="btn-secondary w-full">Download CSV template</button>
            <button className="btn w-full bg-accent text-white">Clear test data</button>
          </div>
        </Phone>
      </div>
    </main>
  );
}
