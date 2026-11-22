"use client";

import { useState } from "react";
import { computeRestock, type RestockInput } from "@/lib/restock";
import { formatGBP, normaliseFraction, roundTo } from "@/lib/numbers";

export type ReviewStatus = "confirmed" | "needs_review" | "unseen";

export interface ReviewItemProps {
  code: string;
  name: string;
  countUnit: string;
  orderUnit: string;
  status: ReviewStatus;
  reasons: string[];
  evidence?: string | null;
  confidence: number | null;
  allowOpenFraction: boolean;
  restock: RestockInput;
  initial: { closed: number; open: number; hidden: number };
}

const REASON_LABEL: Record<string, string> = {
  low_confidence: "Low confidence",
  moderate_confidence: "Please check count",
  occlusion: "Items may be hidden",
  open_box: "Open box?",
  no_code_read: "Code not read",
  duplicate_reading: "Seen twice",
};

const FRACTION_SHORTCUTS = ["0", "0.25", "0.5", "0.7", "0.8"];

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</p>
      <div className="flex items-stretch border-2 border-ink">
        <button type="button" aria-label={`Decrease ${label}`} className="w-14 bg-ink font-display text-3xl text-white active:bg-brand" onClick={() => onChange(Math.max(0, value - 1))}>
          −
        </button>
        <div className="flex flex-1 items-center justify-center font-display text-3xl tabular-nums">{value}</div>
        <button type="button" aria-label={`Increase ${label}`} className="w-14 bg-volt font-display text-3xl active:bg-volt-dark" onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export function ReviewItemCard(props: ReviewItemProps) {
  const { code, name, countUnit, orderUnit, status, reasons, evidence, confidence, allowOpenFraction, restock } = props;
  const [closed, setClosed] = useState(props.initial.closed);
  const [hidden, setHidden] = useState(props.initial.hidden);
  const [openText, setOpenText] = useState(props.initial.open ? String(props.initial.open) : "0");
  const [expanded, setExpanded] = useState(status === "needs_review");
  const [confirmed, setConfirmed] = useState(status === "confirmed");

  const open = normaliseFraction(openText); // accepts "0,7" and "0.7"
  const total = roundTo(closed + open + hidden, 3);
  const r = computeRestock(restock, total);

  const bar =
    status === "needs_review" && !confirmed ? "bg-volt text-ink" : status === "unseen" && !confirmed ? "bg-ink/15 text-ink" : "bg-brand text-white";
  const barText =
    confirmed ? "Confirmed" : status === "needs_review" ? "Needs a quick check" : status === "unseen" ? "Not seen in photo" : "Confirmed";

  return (
    <article className="border-2 border-ink bg-card">
      <div className={`flex items-center justify-between px-3 py-1.5 ${bar}`}>
        <span className="font-display text-sm uppercase tracking-wide">{barText}</span>
        {confidence != null && <span className="text-xs font-bold">AI {(confidence * 100).toFixed(0)}%</span>}
      </div>

      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="bg-ink px-2 py-1 font-display text-xl text-volt">{code}</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-xl leading-tight">{name}</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Total <b className="text-ink">{total}</b> {countUnit}s
              {r.order_qty > 0 ? (
                <>
                  {" "}· Order <b className="text-ink">{r.order_qty}</b> {orderUnit}
                  {r.order_qty === 1 ? "" : "s"} ({formatGBP(r.estimated_cost_gbp)})
                </>
              ) : (
                " · Nothing to order"
              )}
            </p>
          </div>
        </div>

        {reasons.length > 0 && !confirmed && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {reasons.map((x) => (
              <li key={x} className="chip bg-warn-light text-warn">{REASON_LABEL[x] ?? x}</li>
            ))}
          </ul>
        )}
        {evidence && expanded && <p className="mt-2 text-sm italic text-ink-soft">“{evidence}”</p>}

        {expanded ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stepper label={`Closed ${countUnit}s`} value={closed} onChange={setClosed} />
              <Stepper label="Hidden / back row" value={hidden} onChange={setHidden} />
            </div>

            {allowOpenFraction && (
              <div>
                <p className="text-sm font-bold">Open box? If yes, how much is left? <span className="font-normal text-ink-soft">(e.g. 0.7)</span></p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {FRACTION_SHORTCUTS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setOpenText(s)}
                      className={`min-h-11 min-w-14 border-2 border-ink px-3 font-display text-xl ${open === Number(s) ? "bg-ink text-volt" : "bg-card"}`}
                    >
                      {s}
                    </button>
                  ))}
                  <input
                    className="input !min-h-11 w-24 text-center font-display text-xl"
                    inputMode="decimal"
                    aria-label="Open box fraction remaining"
                    value={openText}
                    onChange={(e) => setOpenText(e.target.value)}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => {
                setConfirmed(true);
                setExpanded(false);
              }}
            >
              Confirm
            </button>
          </div>
        ) : (
          <button type="button" className="mt-3 text-sm font-bold underline" onClick={() => setExpanded(true)}>
            Edit
          </button>
        )}
      </div>
    </article>
  );
}

