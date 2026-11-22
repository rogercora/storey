"use client";

import { useState } from "react";
import type { StocktakeItemDTO } from "@/lib/sessions";

export interface SupplierOption {
  id: string;
  name: string;
}

export interface ZoneOption {
  id: string;
  name: string;
}

export interface EditableProduct {
  id: string;
  zone_id: string;
  supplier_id: string | null;
  code_tag: string;
  name: string;
  brand: string | null;
  category: string;
  visual_hints: string | null;
  has_handwritten_tag: boolean;
  count_unit: string;
  order_unit: string;
  conversion_factor: number;
  allow_open_fraction: boolean;
  min_stock: number;
  target_stock: number;
  safety_margin: number;
  round_up_order: boolean;
  unit_cost_gbp: number;
}

const CATEGORIES = ["coffee", "dairy", "syrups", "packaging", "kitchen", "bakery", "drinks", "other"] as const;

export function ProductFormModal({
  mode,
  zones,
  defaultZoneId,
  suppliers,
  sessionId,
  product,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  zones: ZoneOption[];
  defaultZoneId: string;
  suppliers: SupplierOption[];
  sessionId?: string | null;
  product?: EditableProduct | null;
  onClose: () => void;
  onSaved: (res: { product: EditableProduct; supplier?: SupplierOption | null; sessionItem?: StocktakeItemDTO | null }) => void;
}) {
  const [zoneId, setZoneId] = useState(product?.zone_id ?? defaultZoneId);
  const [codeTag, setCodeTag] = useState(product?.code_tag ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [category, setCategory] = useState(product?.category ?? "other");
  const [supplierId, setSupplierId] = useState(product?.supplier_id ?? "");
  const [newSupplier, setNewSupplier] = useState("");
  const [unitCost, setUnitCost] = useState(product ? String(product.unit_cost_gbp) : "");
  const [countUnit, setCountUnit] = useState(product?.count_unit ?? "unit");
  const [orderUnit, setOrderUnit] = useState(product?.order_unit ?? "case");
  const [factor, setFactor] = useState(product ? String(product.conversion_factor) : "1");
  const [minStock, setMinStock] = useState(product ? String(product.min_stock) : "1");
  const [targetStock, setTargetStock] = useState(product ? String(product.target_stock) : "4");
  const [safetyMargin, setSafetyMargin] = useState(product ? String(product.safety_margin) : "1");
  const [allowOpen, setAllowOpen] = useState(product?.allow_open_fraction ?? true);
  const [handwritten, setHandwritten] = useState(product?.has_handwritten_tag ?? false);
  const [roundUp, setRoundUp] = useState(product?.round_up_order ?? true);
  const [hints, setHints] = useState(product?.visual_hints ?? "");

  // Optional initial count when adding directly during a stocktake session
  const [initClosed, setInitClosed] = useState("0");
  const [initOpen, setInitOpen] = useState("0");
  const [initHidden, setInitHidden] = useState("0");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = mode === "create" ? "/api/products" : `/api/products/${product!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const payload: Record<string, unknown> = {
        zone_id: zoneId,
        name,
        brand: brand || null,
        category,
        supplier_id: newSupplier.trim() ? null : supplierId || null,
        new_supplier_name: newSupplier.trim() || null,
        unit_cost_gbp: unitCost || "0",
        count_unit: countUnit || "unit",
        order_unit: orderUnit || "case",
        conversion_factor: factor || "1",
        min_stock: minStock || "0",
        target_stock: targetStock || "0",
        safety_margin: safetyMargin || "0",
        allow_open_fraction: allowOpen,
        has_handwritten_tag: handwritten,
        round_up_order: roundUp,
        visual_hints: hints || null,
      };

      if (mode === "create") {
        payload.code_tag = codeTag;
        if (sessionId) {
          payload.session_id = sessionId;
          payload.initial_closed_units = initClosed || "0";
          payload.initial_open_fraction = initOpen || "0";
          payload.initial_hidden_units = initHidden || "0";
        }
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not save product.");
        return;
      }
      onSaved({
        product: data.product,
        supplier: data.supplier ?? null,
        sessionItem: data.session_item ?? null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto border-t-4 border-ink bg-paper p-5 sm:border-4">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl">{mode === "create" ? "Add product" : `Edit ${product?.code_tag}`}</h2>
          <button type="button" onClick={onClose} className="bg-ink px-3 py-1 font-display text-lg text-volt">
            Close
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs font-bold uppercase">
              Code tag *
              <input
                className="input mt-1 uppercase"
                required
                maxLength={8}
                placeholder="FD02"
                disabled={mode === "edit"}
                value={codeTag}
                onChange={(e) => setCodeTag(e.target.value.toUpperCase())}
              />
            </label>
            <label className="col-span-2 text-xs font-bold uppercase">
              Product name *
              <input className="input mt-1" required placeholder="Sparkling Water 500ml" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold uppercase">
              Unit cost (£ per {orderUnit || "order"}) *
              <input
                className="input mt-1 font-display text-xl"
                required
                inputMode="decimal"
                placeholder="12.50"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            </label>
            <label className="text-xs font-bold uppercase">
              Brand
              <input className="input mt-1" placeholder="Oatly / Monin" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold uppercase">
              Zone
              <select className="input mt-1" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold uppercase">
              Category
              <select className="input mt-1 capitalize" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold uppercase">
              Supplier
              <select className="input mt-1" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— Select —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold uppercase">
              Or new supplier
              <input className="input mt-1" placeholder="Add new name…" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs font-bold uppercase">
              Count unit
              <input className="input mt-1" value={countUnit} onChange={(e) => setCountUnit(e.target.value)} />
            </label>
            <label className="text-xs font-bold uppercase">
              Order unit
              <input className="input mt-1" value={orderUnit} onChange={(e) => setOrderUnit(e.target.value)} />
            </label>
            <label className="text-xs font-bold uppercase">
              Per order
              <input className="input mt-1" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs font-bold uppercase">
              Min stock
              <input className="input mt-1" inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
            </label>
            <label className="text-xs font-bold uppercase">
              Target
              <input className="input mt-1" inputMode="decimal" value={targetStock} onChange={(e) => setTargetStock(e.target.value)} />
            </label>
            <label className="text-xs font-bold uppercase">
              Safety
              <input className="input mt-1" inputMode="decimal" value={safetyMargin} onChange={(e) => setSafetyMargin(e.target.value)} />
            </label>
          </div>

          {mode === "create" && sessionId && (
            <div className="border-2 border-ink bg-brand-light p-3">
              <p className="text-xs font-bold uppercase text-brand-dark">Count now for today&apos;s stocktake</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <label className="text-xs font-bold">
                  Closed
                  <input className="input mt-1 !min-h-10" inputMode="decimal" value={initClosed} onChange={(e) => setInitClosed(e.target.value)} />
                </label>
                <label className="text-xs font-bold">
                  Open (0.5)
                  <input className="input mt-1 !min-h-10" inputMode="decimal" value={initOpen} onChange={(e) => setInitOpen(e.target.value)} />
                </label>
                <label className="text-xs font-bold">
                  Hidden
                  <input className="input mt-1 !min-h-10" inputMode="decimal" value={initHidden} onChange={(e) => setInitHidden(e.target.value)} />
                </label>
              </div>
            </div>
          )}

          <label className="block text-xs font-bold uppercase">
            Visual hints (for AI camera)
            <input className="input mt-1" placeholder="e.g. Brown box with CP12 on top corner" value={hints} onChange={(e) => setHints(e.target.value)} />
          </label>

          <div className="flex flex-wrap gap-4 pt-1 text-sm font-medium">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={allowOpen} onChange={(e) => setAllowOpen(e.target.checked)} />
              Allow open fraction
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={handwritten} onChange={(e) => setHandwritten(e.target.checked)} />
              Handwritten box code
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={roundUp} onChange={(e) => setRoundUp(e.target.checked)} />
              Round up order
            </label>
          </div>

          {error && (
            <p className="border-2 border-accent bg-accent-light px-3 py-2 text-sm font-semibold text-accent" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn-accent w-full" disabled={busy}>
            {busy ? "Saving…" : mode === "create" ? "Save product" : "Save changes"}
          </button>
        </form>
      </div>
    </div>
  );
}

