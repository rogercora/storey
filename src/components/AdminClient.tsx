"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandHeader } from "@/components/Brand";
import { ProductFormModal, type EditableProduct, type SupplierOption, type ZoneOption } from "@/components/ProductFormModal";
import { formatGBP } from "@/lib/numbers";
import { formatUkDateTime } from "@/lib/dates";

export interface AdminUserDTO {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "staff";
  status: "pending" | "active" | "suspended";
}

export interface AdminProductDTO extends EditableProduct {
  zone_name: string;
  supplier_name: string;
  is_test_data: boolean;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  updated_at?: string | null;
}

export interface ActivityDTO {
  id: string;
  actor_name: string;
  action: string;
  summary: string;
  created_at: string;
}

export function AdminClient({
  currentUserId,
  zones,
  initialSuppliers,
  initialUsers,
  initialProducts,
  initialActivity,
}: {
  currentUserId: string;
  zones: ZoneOption[];
  initialSuppliers: SupplierOption[];
  initialUsers: AdminUserDTO[];
  initialProducts: AdminProductDTO[];
  initialActivity: ActivityDTO[];
}) {
  const [tab, setTab] = useState<"team" | "inventory" | "activity">("team");
  const [users, setUsers] = useState(initialUsers);
  const [products, setProducts] = useState(initialProducts);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [productModal, setProductModal] = useState<
    | { open: false }
    | { open: true; mode: "create" }
    | { open: true; mode: "edit"; product: AdminProductDTO }
  >({ open: false });

  async function updateUser(userId: string, patch: { status?: AdminUserDTO["status"]; role?: AdminUserDTO["role"] }) {
    setBusyId(userId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not update user.");
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...patch } : u)));
    } finally {
      setBusyId(null);
    }
  }

  async function handleImportCsv(e: React.FormEvent) {
    e.preventDefault();
    if (!csvFile) return;
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", csvFile);
      const res = await fetch("/api/admin/import-csv", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "CSV import failed.");
        return;
      }
      const errText = data.errors?.length ? ` (${data.errors.length} warning(s): ${data.errors.slice(0, 3).join(" | ")})` : "";
      setMessage(`Imported ${data.imported} of ${data.total_rows} product(s).${errText}`);
      setCsvFile(null);
      window.location.reload();
    } finally {
      setImporting(false);
    }
  }

  async function handleResetTestData() {
    setResetting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/reset-test-data", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Reset failed.");
        return;
      }
      setProducts((prev) => prev.filter((p) => !p.is_test_data));
      setConfirmReset(false);
      setMessage(
        `Cleared ${data.deleted?.test_products ?? 0} test product(s), ${data.deleted?.inventory_sessions ?? 0} session(s), ${data.deleted?.purchase_orders ?? 0} PO(s) and ${data.deleted_photos ?? 0} photo(s).`,
      );
    } finally {
      setResetting(false);
    }
  }

  const pendingCount = users.filter((u) => u.status === "pending").length;
  const testCount = products.filter((p) => p.is_test_data).length;
  const realCount = products.length - testCount;

  const sortedUsers = [...users].sort((a, b) => {
    const rank = { pending: 0, active: 1, suspended: 2 };
    return rank[a.status] - rank[b.status] || a.full_name.localeCompare(b.full_name);
  });

  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]));
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));

  return (
    <div className="min-h-dvh pb-16">
      <BrandHeader
        right={
          <Link href="/" className="chip bg-volt text-ink">
            ← Zones
          </Link>
        }
      />

      <section className="bg-plum px-5 py-7 text-white">
        <p className="text-xs font-bold uppercase tracking-wider text-white/75">Manager Controls</p>
        <h1 className="mt-1 text-4xl text-volt">Admin · Team &amp; Inventory</h1>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setTab("team")}
            className={`min-h-11 font-display text-base uppercase ${tab === "team" ? "bg-volt text-ink" : "border border-white/40 text-white"}`}
          >
            Team {pendingCount > 0 ? `(${pendingCount})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setTab("inventory")}
            className={`min-h-11 font-display text-base uppercase ${tab === "inventory" ? "bg-volt text-ink" : "border border-white/40 text-white"}`}
          >
            Catalogue
          </button>
          <button
            type="button"
            onClick={() => setTab("activity")}
            className={`min-h-11 font-display text-base uppercase ${tab === "activity" ? "bg-volt text-ink" : "border border-white/40 text-white"}`}
          >
            Activity
          </button>
        </div>
      </section>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-5">
        {error && (
          <p className="border-2 border-accent bg-accent-light px-3 py-2 text-sm font-semibold text-accent" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="border-2 border-ok bg-ok-light px-3 py-2 text-sm font-semibold text-ok">{message}</p>
        )}

        {tab === "team" && (
          <div className="space-y-3">
            {sortedUsers.map((u) => {
              const badge =
                u.status === "pending"
                  ? "bg-volt text-ink"
                  : u.status === "active"
                    ? "bg-brand text-white"
                    : "bg-accent text-white";

              return (
                <article key={u.id} className="card">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-display text-2xl uppercase leading-none">{u.full_name || "Unnamed"}</p>
                    <span className={`chip ${badge}`}>{u.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {u.email} · <b className="uppercase text-ink">{u.role}</b>
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {u.status !== "active" && (
                      <button
                        type="button"
                        className="btn-accent !min-h-10 flex-1"
                        disabled={busyId === u.id}
                        onClick={() => updateUser(u.id, { status: "active" })}
                      >
                        Approve
                      </button>
                    )}
                    {u.status === "active" && u.id !== currentUserId && (
                      <button
                        type="button"
                        className="btn-secondary !min-h-10 flex-1"
                        disabled={busyId === u.id}
                        onClick={() => updateUser(u.id, { status: "suspended" })}
                      >
                        Suspend
                      </button>
                    )}
                    {u.role === "staff" ? (
                      <button
                        type="button"
                        className="btn-secondary !min-h-10 flex-1"
                        disabled={busyId === u.id}
                        onClick={() => updateUser(u.id, { role: "admin" })}
                      >
                        Make admin
                      </button>
                    ) : (
                      u.id !== currentUserId && (
                        <button
                          type="button"
                          className="btn-secondary !min-h-10 flex-1"
                          disabled={busyId === u.id}
                          onClick={() => updateUser(u.id, { role: "staff" })}
                        >
                          Set staff
                        </button>
                      )
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {tab === "inventory" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="card text-center">
                <p className="font-display text-4xl text-brand">{realCount}</p>
                <p className="text-xs font-bold uppercase text-ink-soft">Real products</p>
              </div>
              <div className="card text-center">
                <p className="font-display text-4xl text-warn">{testCount}</p>
                <p className="text-xs font-bold uppercase text-ink-soft">Test products</p>
              </div>
            </div>

            <button
              type="button"
              className="btn-accent w-full"
              onClick={() => setProductModal({ open: true, mode: "create" })}
            >
              + Add new product
            </button>

            <section className="space-y-2">
              <h2 className="text-2xl">Catalogue ({products.length})</h2>
              <ul className="divide-y divide-line border border-line bg-card">
                {products.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-3 text-sm">
                    <div className="min-w-0">
                      <div>
                        <span className="mr-2 bg-ink px-1.5 py-0.5 font-display text-xs text-volt">{p.code_tag}</span>
                        <span className="font-semibold">{p.name}</span>
                        {p.is_test_data && <span className="ml-2 chip bg-warn-light text-warn">Test</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        {p.zone_name} · {p.supplier_name}
                      </p>
                      {(p.updated_by_name || p.created_by_name) && (
                        <p className="mt-0.5 text-[11px] text-ink-soft">
                          By {p.updated_by_name || p.created_by_name}
                          {p.updated_at ? ` · ${formatUkDateTime(p.updated_at)}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <p className="font-bold">{formatGBP(p.unit_cost_gbp)} / {p.order_unit}</p>
                      <p className="text-ink-soft">Target {p.target_stock} {p.count_unit}</p>
                      <button
                        type="button"
                        className="mt-1 font-bold text-brand-dark underline"
                        onClick={() => setProductModal({ open: true, mode: "edit", product: p })}
                      >
                        Edit / £
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card space-y-3">
              <h2 className="text-2xl">Import Real Inventory (CSV)</h2>
              <p className="text-sm text-ink-soft">
                Upload your café and kitchen catalogue. Matching <code>code_tag</code> rows are updated; new zones and suppliers are created automatically.
              </p>
              <a href="/api/admin/csv-template" className="btn-secondary w-full">
                Download CSV template
              </a>
              <form onSubmit={handleImportCsv} className="space-y-3 pt-1">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  required
                  onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
                  className="block w-full border-2 border-ink/25 bg-paper p-3 text-sm"
                />
                <button type="submit" className="btn-primary w-full" disabled={!csvFile || importing}>
                  {importing ? "Importing…" : "Upload & import CSV"}
                </button>
              </form>
            </section>

            <section className="card space-y-3 border-2 border-accent">
              <h2 className="text-2xl text-accent">Clear Test Data</h2>
              <p className="text-sm text-ink-soft">
                Removes all test products, test suppliers, all stocktake sessions, purchase orders and test shelf photos before going live. Permanent zones and your real imported products stay intact.
              </p>
              {!confirmReset ? (
                <button type="button" className="btn w-full bg-accent text-white" onClick={() => setConfirmReset(true)}>
                  Reset Test Data
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-accent">Are you sure? This deletes all test sessions and POs.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setConfirmReset(false)}>
                      Cancel
                    </button>
                    <button type="button" className="btn bg-accent text-white" disabled={resetting} onClick={handleResetTestData}>
                      {resetting ? "Clearing…" : "Confirm clear"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "activity" && (
          <section className="space-y-2">
            <h2 className="text-2xl">Recent activity</h2>
            {initialActivity.length === 0 ? (
              <p className="card text-sm text-ink-soft">
                No activity recorded yet (make sure migration <code>0005_audit_and_staff_products.sql</code> has been run in Supabase).
              </p>
            ) : (
              <ul className="divide-y divide-line border border-line bg-card">
                {initialActivity.map((a) => (
                  <li key={a.id} className="px-3 py-3 text-sm">
                    <p className="font-semibold">{a.summary}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      <b className="text-ink">{a.actor_name}</b> · {formatUkDateTime(a.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {productModal.open && zones.length > 0 && (
        <ProductFormModal
          mode={productModal.mode}
          zones={zones}
          defaultZoneId={productModal.mode === "edit" ? productModal.product.zone_id : zones[0]!.id}
          suppliers={suppliers}
          product={productModal.mode === "edit" ? productModal.product : null}
          onClose={() => setProductModal({ open: false })}
          onSaved={({ product, supplier }) => {
            if (supplier && !suppliers.some((s) => s.id === supplier.id)) {
              setSuppliers((prev) => [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)));
            }
            const nextSupName =
              supplier?.name ??
              (product.supplier_id ? supplierNameById.get(product.supplier_id) ?? "Unassigned" : "Unassigned");
            const nextZoneName = zoneNameById.get(product.zone_id) ?? "";

            const dto: AdminProductDTO = {
              ...product,
              zone_name: nextZoneName,
              supplier_name: nextSupName,
              is_test_data: false,
              updated_by_name: "You",
              updated_at: new Date().toISOString(),
            };

            if (productModal.mode === "create") {
              setProducts((prev) => [dto, ...prev]);
              setMessage(`Added [${product.code_tag}] ${product.name} (${formatGBP(Number(product.unit_cost_gbp))}).`);
            } else {
              setProducts((prev) => prev.map((p) => (p.id === product.id ? dto : p)));
              setMessage(`Updated [${product.code_tag}] ${product.name} (${formatGBP(Number(product.unit_cost_gbp))}).`);
            }
            setProductModal({ open: false });
          }}
        />
      )}
    </div>
  );
}
