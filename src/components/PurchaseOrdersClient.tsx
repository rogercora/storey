"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandHeader } from "@/components/Brand";
import { formatGBP } from "@/lib/numbers";
import { formatUkDateTime } from "@/lib/dates";

export interface PoLineDTO {
  id: string;
  code_tag: string;
  name: string;
  qty_order_units: number;
  order_unit: string;
  unit_cost_gbp: number;
  line_total_gbp: number;
}

export interface PurchaseOrderDTO {
  id: string;
  status: "draft" | "approved" | "sent";
  total_estimated_gbp: number;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
  supplier: {
    name: string;
    contact_email: string | null;
    contact_phone: string | null;
    lead_time_days: number;
  };
  items: PoLineDTO[];
}

export function PurchaseOrdersClient({
  initialOrders,
  completedZonesToday,
}: {
  initialOrders: PurchaseOrderDTO[];
  completedZonesToday: number;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateDrafts() {
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/generate-po", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not generate purchase orders.");
        return;
      }
      if ((data.created_pos?.length ?? 0) === 0) {
        setMessage(data.message ?? "All counted items are already at target stock.");
      } else {
        setMessage(`Created ${data.created_pos.length} draft purchase order(s).`);
      }
      router.refresh();
      // Fetch fresh list via reload if needed
      window.location.reload();
    } finally {
      setGenerating(false);
    }
  }

  async function updateStatus(id: string, status: "approved" | "sent") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not update order.");
        return;
      }
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteDraft(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error ?? "Could not delete draft.");
        return;
      }
      setOrders((prev) => prev.filter((o) => o.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  function buildOrderText(po: PurchaseOrderDTO): string {
    const lines = po.items.map(
      (l) =>
        `- [${l.code_tag}] ${l.name}: ${l.qty_order_units} ${l.order_unit}${l.qty_order_units === 1 ? "" : "s"} (${formatGBP(l.line_total_gbp)})`,
    );
    return [
      `Purchase Order — ${po.supplier.name}`,
      `Date: ${formatUkDateTime(po.created_at)}`,
      "",
      ...lines,
      "",
      `Estimated Total: ${formatGBP(po.total_estimated_gbp)}`,
      "Thank you, Event Storey Kitchen & Café",
    ].join("\n");
  }

  async function copyOrder(po: PurchaseOrderDTO) {
    await navigator.clipboard.writeText(buildOrderText(po));
    setCopiedId(po.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const grandTotal = orders.reduce((sum, o) => sum + Number(o.total_estimated_gbp), 0);

  return (
    <div className="min-h-dvh pb-16">
      <BrandHeader
        right={
          <Link href="/" className="chip bg-volt text-ink">
            ← Zones
          </Link>
        }
      />

      <section className="bg-brand px-5 py-7 text-white">
        <p className="text-xs font-bold uppercase tracking-wider text-white/80">
          {completedZonesToday} zone(s) completed today · Est. total {formatGBP(grandTotal)}
        </p>
        <h1 className="mt-1 text-4xl text-volt">Purchase Orders</h1>
      </section>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-5">
        <button type="button" className="btn-accent w-full" onClick={generateDrafts} disabled={generating}>
          {generating ? "Generating…" : "Generate POs from today's stocktake"}
        </button>

        <div className="grid grid-cols-2 gap-3">
          <a href="/api/export?format=xlsx" className="btn-secondary">
            Export .xlsx
          </a>
          <a href="/api/export?format=csv" className="btn-secondary">
            Export .csv
          </a>
        </div>

        {error && (
          <p className="border-2 border-accent bg-accent-light px-3 py-2 text-sm font-semibold text-accent" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="border-2 border-ok bg-ok-light px-3 py-2 text-sm font-semibold text-ok">{message}</p>
        )}

        {orders.length === 0 ? (
          <div className="card text-center">
            <p className="font-display text-2xl uppercase">No purchase orders yet</p>
            <p className="mt-2 text-sm text-ink-soft">
              Finish at least one zone stocktake, then tap “Generate POs from today&apos;s stocktake”.
            </p>
          </div>
        ) : (
          orders.map((po) => {
            const statusStyle =
              po.status === "sent"
                ? "bg-ink text-white border border-white/40"
                : po.status === "approved"
                  ? "bg-brand text-white"
                  : "bg-volt text-ink";

            return (
              <section key={po.id} className="border-2 border-ink bg-card">
                <div className="flex items-center justify-between bg-ink px-4 py-2.5 text-white">
                  <div>
                    <h2 className="text-xl">{po.supplier.name}</h2>
                    <p className="text-xs text-white/70">{formatUkDateTime(po.created_at)}</p>
                  </div>
                  <span className={`chip ${statusStyle}`}>{po.status}</span>
                </div>

                <ul className="divide-y divide-line px-4">
                  {po.items.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 py-3 text-sm">
                      <div>
                        <span className="mr-2 bg-ink px-1.5 py-0.5 font-display text-xs text-volt">{l.code_tag}</span>
                        <span className="font-semibold">{l.name}</span>
                      </div>
                      <span className="shrink-0 text-right tabular-nums">
                        {l.qty_order_units} {l.order_unit}
                        {l.qty_order_units === 1 ? "" : "s"} · <b>{formatGBP(l.line_total_gbp)}</b>
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="space-y-3 border-t-2 border-ink px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-2xl">Total {formatGBP(po.total_estimated_gbp)}</span>
                    <div className="flex gap-2">
                      {po.status === "draft" && (
                        <button
                          type="button"
                          className="btn-accent !min-h-10 px-4"
                          disabled={busyId === po.id}
                          onClick={() => updateStatus(po.id, "approved")}
                        >
                          Approve
                        </button>
                      )}
                      {po.status !== "sent" && (
                        <button
                          type="button"
                          className="btn-primary !min-h-10 px-4"
                          disabled={busyId === po.id}
                          onClick={() => updateStatus(po.id, "sent")}
                        >
                          Mark sent
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-bold">
                    <button type="button" className="underline" onClick={() => copyOrder(po)}>
                      {copiedId === po.id ? "Copied!" : "Copy order text"}
                    </button>
                    {po.supplier.contact_email && (
                      <a
                        className="underline"
                        href={`mailto:${encodeURIComponent(po.supplier.contact_email)}?subject=${encodeURIComponent(`Purchase Order - Event Storey`)}&body=${encodeURIComponent(buildOrderText(po))}`}
                      >
                        Email {po.supplier.contact_email}
                      </a>
                    )}
                    {po.status === "draft" && (
                      <button
                        type="button"
                        className="ml-auto text-accent underline"
                        disabled={busyId === po.id}
                        onClick={() => deleteDraft(po.id)}
                      >
                        Delete draft
                      </button>
                    )}
                  </div>
                </div>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}

