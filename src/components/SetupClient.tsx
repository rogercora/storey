"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandHeader } from "@/components/Brand";
import { formatUkDateTime } from "@/lib/dates";

export interface ZoneDTO {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  actor_name?: string | null;
  updated_at?: string | null;
}

export interface CategoryDTO {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  actor_name?: string | null;
  updated_at?: string | null;
}

export interface SupplierDTO {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  lead_time_days: number;
  notes: string | null;
  actor_name?: string | null;
  updated_at?: string | null;
}

export function SetupClient({
  role,
  initialZones,
  initialCategories,
  initialSuppliers,
}: {
  role: "admin" | "supervisor";
  initialZones: ZoneDTO[];
  initialCategories: CategoryDTO[];
  initialSuppliers: SupplierDTO[];
}) {
  const [tab, setTab] = useState<"zones" | "categories" | "suppliers">("zones");
  const [zones, setZones] = useState(initialZones);
  const [categories, setCategories] = useState(initialCategories);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Zone form state
  const [editZoneId, setEditZoneId] = useState<string | null>(null);
  const [zName, setZName] = useState("");
  const [zDesc, setZDesc] = useState("");
  const [zOrder, setZOrder] = useState("60");

  // Category form state
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [cName, setCName] = useState("");
  const [cOrder, setCOrder] = useState("90");

  // Supplier form state
  const [editSupId, setEditSupId] = useState<string | null>(null);
  const [sName, setSName] = useState("");
  const [sEmail, setSEmail] = useState("");
  const [sPhone, setSPhone] = useState("");
  const [sLead, setSLead] = useState("1");
  const [sNotes, setSNotes] = useState("");

  async function saveZone(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/setup/zones", {
        method: editZoneId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editZoneId ? { id: editZoneId } : {}),
          name: zName,
          description: zDesc || null,
          sort_order: Number(zOrder || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data?.error ?? "Could not save zone.");

      const saved: ZoneDTO = { ...data.zone, actor_name: "You", updated_at: new Date().toISOString() };
      setZones((prev) =>
        (editZoneId ? prev.map((z) => (z.id === saved.id ? saved : z)) : [...prev, saved]).sort(
          (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
        ),
      );
      setEditZoneId(null);
      setZName("");
      setZDesc("");
      setZOrder("60");
      setNotice(`Saved zone "${saved.name}".`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteZone(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/setup/zones?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return setError(data?.error ?? "Could not delete zone.");
      setZones((prev) => prev.filter((z) => z.id !== id));
      setNotice("Zone deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/setup/categories", {
        method: editCatId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editCatId ? { id: editCatId } : {}),
          name: cName,
          sort_order: Number(cOrder || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data?.error ?? "Could not save category.");

      const saved: CategoryDTO = { ...data.category, actor_name: "You", updated_at: new Date().toISOString() };
      setCategories((prev) =>
        (editCatId ? prev.map((c) => (c.id === saved.id ? saved : c)) : [...prev, saved]).sort(
          (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
        ),
      );
      setEditCatId(null);
      setCName("");
      setCOrder("90");
      setNotice(`Saved category "${saved.name}".`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCategory(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/setup/categories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return setError(data?.error ?? "Could not delete category.");
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setNotice("Category deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSupplier(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/setup/suppliers", {
        method: editSupId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editSupId ? { id: editSupId } : {}),
          name: sName,
          contact_email: sEmail || null,
          contact_phone: sPhone || null,
          lead_time_days: Number(sLead || 1),
          notes: sNotes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data?.error ?? "Could not save supplier.");

      const saved: SupplierDTO = { ...data.supplier, actor_name: "You", updated_at: new Date().toISOString() };
      setSuppliers((prev) =>
        (editSupId ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved]).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setEditSupId(null);
      setSName("");
      setSEmail("");
      setSPhone("");
      setSLead("1");
      setSNotes("");
      setNotice(`Saved supplier "${saved.name}".`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSupplier(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/setup/suppliers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return setError(data?.error ?? "Could not delete supplier.");
      setSuppliers((prev) => prev.filter((s) => s.id !== id));
      setNotice("Supplier deleted.");
    } finally {
      setBusy(false);
    }
  }

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
          {role === "admin" ? "Admin" : "Supervisor"} · Store Structure
        </p>
        <h1 className="mt-1 text-4xl text-volt">Zones, Categories &amp; Suppliers</h1>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(["zones", "categories", "suppliers"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setError(null);
                setNotice(null);
              }}
              className={`min-h-11 font-display text-base uppercase ${tab === t ? "bg-volt text-ink" : "border border-white/40 text-white"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <main className="mx-auto max-w-md space-y-5 px-4 pt-5">
        {error && (
          <p className="border-2 border-accent bg-accent-light px-3 py-2 text-sm font-semibold text-accent" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="border-2 border-ok bg-ok-light px-3 py-2 text-sm font-semibold text-ok">{notice}</p>}

        {tab === "zones" && (
          <>
            <form onSubmit={saveZone} className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl">{editZoneId ? "Edit zone" : "Add new zone"}</h2>
                {editZoneId && (
                  <button
                    type="button"
                    className="text-xs font-bold underline"
                    onClick={() => {
                      setEditZoneId(null);
                      setZName("");
                      setZDesc("");
                      setZOrder("60");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-2 text-xs font-bold uppercase">
                  Zone name *
                  <input className="input mt-1" required placeholder="Walk-in Freezer" value={zName} onChange={(e) => setZName(e.target.value)} />
                </label>
                <label className="text-xs font-bold uppercase">
                  Order
                  <input className="input mt-1" inputMode="numeric" value={zOrder} onChange={(e) => setZOrder(e.target.value)} />
                </label>
              </div>
              <label className="block text-xs font-bold uppercase">
                Description
                <input className="input mt-1" placeholder="Frozen pastry and ice cream" value={zDesc} onChange={(e) => setZDesc(e.target.value)} />
              </label>
              <button className="btn-accent w-full" disabled={busy}>
                {editZoneId ? "Save zone" : "Add zone"}
              </button>
            </form>

            <ul className="space-y-2">
              {zones.map((z) => (
                <li key={z.id} className="card flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-2xl uppercase leading-none">
                      {z.name} <span className="text-sm text-ink-soft">#{z.sort_order}</span>
                    </p>
                    {z.description && <p className="mt-1 text-sm text-ink-soft">{z.description}</p>}
                    {z.actor_name && (
                      <p className="mt-1 text-[11px] text-ink-soft">
                        By {z.actor_name}
                        {z.updated_at ? ` · ${formatUkDateTime(z.updated_at)}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-3 text-xs font-bold">
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        setEditZoneId(z.id);
                        setZName(z.name);
                        setZDesc(z.description ?? "");
                        setZOrder(String(z.sort_order));
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="text-accent underline" onClick={() => deleteZone(z.id)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === "categories" && (
          <>
            <form onSubmit={saveCategory} className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl">{editCatId ? "Edit category" : "Add new category"}</h2>
                {editCatId && (
                  <button
                    type="button"
                    className="text-xs font-bold underline"
                    onClick={() => {
                      setEditCatId(null);
                      setCName("");
                      setCOrder("90");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-2 text-xs font-bold uppercase">
                  Category name *
                  <input className="input mt-1" required placeholder="Cleaning" value={cName} onChange={(e) => setCName(e.target.value)} />
                </label>
                <label className="text-xs font-bold uppercase">
                  Order
                  <input className="input mt-1" inputMode="numeric" value={cOrder} onChange={(e) => setCOrder(e.target.value)} />
                </label>
              </div>
              <button className="btn-accent w-full" disabled={busy}>
                {editCatId ? "Save category" : "Add category"}
              </button>
            </form>

            <ul className="space-y-2">
              {categories.map((c) => (
                <li key={c.id} className="card flex items-center justify-between gap-2">
                  <div>
                    <p className="font-display text-2xl uppercase leading-none">
                      {c.name} <span className="text-sm text-ink-soft">({c.slug})</span>
                    </p>
                    {c.actor_name && (
                      <p className="mt-1 text-[11px] text-ink-soft">
                        By {c.actor_name}
                        {c.updated_at ? ` · ${formatUkDateTime(c.updated_at)}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-3 text-xs font-bold">
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        setEditCatId(c.id);
                        setCName(c.name);
                        setCOrder(String(c.sort_order));
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="text-accent underline" onClick={() => deleteCategory(c.id)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === "suppliers" && (
          <>
            <form onSubmit={saveSupplier} className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl">{editSupId ? "Edit supplier" : "Add new supplier"}</h2>
                {editSupId && (
                  <button
                    type="button"
                    className="text-xs font-bold underline"
                    onClick={() => {
                      setEditSupId(null);
                      setSName("");
                      setSEmail("");
                      setSPhone("");
                      setSLead("1");
                      setSNotes("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
              <label className="block text-xs font-bold uppercase">
                Supplier name *
                <input className="input mt-1" required placeholder="Brakes Foodservice" value={sName} onChange={(e) => setSName(e.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold uppercase">
                  Order email
                  <input className="input mt-1" type="email" placeholder="orders@supplier.co.uk" value={sEmail} onChange={(e) => setSEmail(e.target.value)} />
                </label>
                <label className="text-xs font-bold uppercase">
                  Phone
                  <input className="input mt-1" placeholder="020 7946 0000" value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs font-bold uppercase">
                  Lead days
                  <input className="input mt-1" inputMode="numeric" value={sLead} onChange={(e) => setSLead(e.target.value)} />
                </label>
                <label className="col-span-2 text-xs font-bold uppercase">
                  Delivery notes
                  <input className="input mt-1" placeholder="Order before 2pm" value={sNotes} onChange={(e) => setSNotes(e.target.value)} />
                </label>
              </div>
              <button className="btn-accent w-full" disabled={busy}>
                {editSupId ? "Save supplier" : "Add supplier"}
              </button>
            </form>

            <ul className="space-y-2">
              {suppliers.map((s) => (
                <li key={s.id} className="card space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-2xl uppercase leading-none">{s.name}</p>
                    <div className="flex shrink-0 gap-3 text-xs font-bold">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => {
                          setEditSupId(s.id);
                          setSName(s.name);
                          setSEmail(s.contact_email ?? "");
                          setSPhone(s.contact_phone ?? "");
                          setSLead(String(s.lead_time_days));
                          setSNotes(s.notes ?? "");
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="text-accent underline" onClick={() => deleteSupplier(s.id)} disabled={busy}>
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-ink-soft">
                    {[s.contact_email, s.contact_phone, `${s.lead_time_days}d lead`].filter(Boolean).join(" · ")}
                  </p>
                  {s.notes && <p className="text-xs italic text-ink-soft">{s.notes}</p>}
                  {s.actor_name && (
                    <p className="text-[11px] text-ink-soft">
                      By {s.actor_name}
                      {s.updated_at ? ` · ${formatUkDateTime(s.updated_at)}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}

