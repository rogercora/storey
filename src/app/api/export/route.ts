import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { londonDay } from "@/lib/dates";
import { toCsv } from "@/lib/csv";
import { computeRestock } from "@/lib/restock";

export const runtime = "nodejs";

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * GET /api/export?format=xlsx|csv&day=YYYY-MM-DD
 * Exports the day's stocktake and restock suggestions (plus Purchase Orders in .xlsx)
 * in UK English with GBP (£) formatting.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireActiveUser(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const targetDay = request.nextUrl.searchParams.get("day") || londonDay();

  // Pull recent sessions and filter to the requested UK calendar day.
  const { data: sessions, error: sErr } = await supabase
    .from("inventory_sessions")
    .select("id, zone_id, status, created_at, completed_at, zones(name), profiles(full_name)")
    .gte("created_at", new Date(Date.now() - 14 * 24 * 3600_000).toISOString())
    .order("created_at", { ascending: false });

  if (sErr) return fail(500, "Could not load stocktake sessions.");

  // Keep latest session per zone for that day (prefer completed over draft).
  const daySessions = (sessions ?? []).filter((s) => londonDay(new Date(s.created_at as string)) === targetDay);
  const byZone = new Map<string, (typeof daySessions)[number]>();
  for (const s of daySessions) {
    const zid = s.zone_id as string;
    const prev = byZone.get(zid);
    if (!prev || (prev.status !== "completed" && s.status === "completed")) {
      byZone.set(zid, s);
    }
  }

  const chosenIds = [...byZone.values()].map((s) => s.id as string);
  const sessionInfo = new Map([...byZone.values()].map((s) => [s.id as string, s]));

  let itemRows: Array<Record<string, unknown>> = [];
  if (chosenIds.length > 0) {
    const { data, error } = await supabase
      .from("inventory_items")
      .select(
        "session_id, final_closed_units, final_open_fraction, hidden_back_units, total_counted, ai_confidence, ai_occlusion_warning, products(code_tag, name, brand, count_unit, order_unit, conversion_factor, min_stock, target_stock, safety_margin, round_up_order, unit_cost_gbp, suppliers(name))",
      )
      .in("session_id", chosenIds);
    if (error) return fail(500, "Could not load counted items.");
    itemRows = (data ?? []) as Array<Record<string, unknown>>;
  }

  const stockHeaders = [
    "Date",
    "Zone",
    "Code",
    "Product",
    "Brand",
    "Supplier",
    "Count Unit",
    "Closed Units",
    "Open Fraction",
    "Hidden / Back Row",
    "Total Counted",
    "Min Stock",
    "Target + Safety",
    "Shortfall (Count Units)",
    "Suggested Order Qty",
    "Order Unit",
    "Unit Cost (GBP)",
    "Est. Cost (GBP)",
    "Counted By",
    "Status",
  ];

  const stockData = itemRows
    .map((r) => {
      const sess = sessionInfo.get(r.session_id as string);
      const zoneObj = Array.isArray(sess?.zones) ? sess?.zones[0] : sess?.zones;
      const profObj = Array.isArray(sess?.profiles) ? sess?.profiles[0] : sess?.profiles;
      const p = (Array.isArray(r.products) ? r.products[0] : r.products) as {
        code_tag: string;
        name: string;
        brand: string | null;
        count_unit: string;
        order_unit: string;
        conversion_factor: number;
        min_stock: number;
        target_stock: number;
        safety_margin: number;
        round_up_order: boolean;
        unit_cost_gbp: number;
        suppliers?: { name: string } | Array<{ name: string }> | null;
      } | null;

      if (!p) return null;
      const supObj = Array.isArray(p.suppliers) ? p.suppliers[0] : p.suppliers;
      const total = Number(r.total_counted ?? 0);
      const restock = computeRestock(p, total);

      return [
        targetDay,
        (zoneObj as { name?: string } | null)?.name ?? "",
        p.code_tag,
        p.name,
        p.brand ?? "",
        supObj?.name ?? "Unassigned",
        p.count_unit,
        Number(r.final_closed_units ?? 0),
        Number(r.final_open_fraction ?? 0),
        Number(r.hidden_back_units ?? 0),
        total,
        Number(p.min_stock),
        Number(p.target_stock) + Number(p.safety_margin),
        restock.needed_count_units,
        restock.order_qty,
        p.order_unit,
        Number(p.unit_cost_gbp),
        restock.estimated_cost_gbp,
        (profObj as { full_name?: string } | null)?.full_name ?? "",
        sess?.status === "completed" ? "Completed" : "Draft",
      ];
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2])));

  if (format === "csv") {
    const csv = toCsv(stockHeaders, stockData);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="daily-stocktake-${targetDay}.csv"`,
      },
    });
  }

  // Build multi-sheet .xlsx workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = "Event Storey Stocktake";
  wb.created = new Date();

  const stockSheet = wb.addWorksheet("Daily Stocktake");
  stockSheet.addRow(stockHeaders);
  stockSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  stockSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
  for (const row of stockData) stockSheet.addRow(row);
  stockSheet.getColumn(17).numFmt = "£#,##0.00";
  stockSheet.getColumn(18).numFmt = "£#,##0.00";
  stockSheet.columns.forEach((col) => {
    col.width = 16;
  });
  stockSheet.getColumn(4).width = 30;

  // Sheet 2: Purchase Orders created today (or latest)
  const { data: pos } = await supabase
    .from("purchase_orders")
    .select(
      "id, status, total_estimated_gbp, created_at, suppliers(name, contact_email), purchase_order_items(qty_order_units, order_unit, unit_cost_gbp, line_total_gbp, products(code_tag, name))",
    )
    .gte("created_at", new Date(Date.now() - 14 * 24 * 3600_000).toISOString())
    .order("created_at", { ascending: false });

  const poSheet = wb.addWorksheet("Purchase Orders");
  const poHeaders = ["PO Date", "Supplier", "Supplier Email", "Status", "Code", "Product", "Order Qty", "Order Unit", "Unit Cost (GBP)", "Line Total (GBP)"];
  poSheet.addRow(poHeaders);
  poSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  poSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF018168" } };

  for (const po of pos ?? []) {
    const poDay = londonDay(new Date(po.created_at as string));
    if (poDay !== targetDay) continue;
    const sup = (Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers) as { name?: string; contact_email?: string } | null;
    const lines = (po.purchase_order_items ?? []) as Array<{
      qty_order_units: number;
      order_unit: string;
      unit_cost_gbp: number;
      line_total_gbp: number;
      products: { code_tag: string; name: string } | Array<{ code_tag: string; name: string }> | null;
    }>;
    for (const line of lines) {
      const prod = Array.isArray(line.products) ? line.products[0] : line.products;
      poSheet.addRow([
        poDay,
        sup?.name ?? "",
        sup?.contact_email ?? "",
        String(po.status).toUpperCase(),
        prod?.code_tag ?? "",
        prod?.name ?? "",
        Number(line.qty_order_units),
        line.order_unit,
        Number(line.unit_cost_gbp),
        Number(line.line_total_gbp),
      ]);
    }
  }
  poSheet.getColumn(9).numFmt = "£#,##0.00";
  poSheet.getColumn(10).numFmt = "£#,##0.00";
  poSheet.columns.forEach((col) => {
    col.width = 18;
  });
  poSheet.getColumn(6).width = 30;

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="daily-stocktake-${targetDay}.xlsx"`,
    },
  });
}

