import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";

export const runtime = "nodejs";

const HEADERS = [
  "code_tag",
  "name",
  "brand",
  "zone",
  "supplier",
  "supplier_email",
  "supplier_phone",
  "lead_time_days",
  "category",
  "visual_hints",
  "has_handwritten_tag",
  "count_unit",
  "order_unit",
  "conversion_factor",
  "default_shelf_depth",
  "allow_open_fraction",
  "min_stock",
  "target_stock",
  "safety_margin",
  "round_up_order",
  "unit_cost_gbp",
];

const EXAMPLE_ROWS = [
  [
    "DA01",
    "Oat Milk 1L (Barista)",
    "Oatly",
    "Chiller / Fridge",
    "Fresh Dairy Ltd",
    "orders@freshdairy.co.uk",
    "020 7946 0001",
    1,
    "dairy",
    "Cream/blue 1L carton stacked 2 high",
    false,
    "carton",
    "case",
    6,
    2,
    false,
    6,
    18,
    2,
    true,
    14.4,
  ],
  [
    "CP12",
    "12oz Hot Cups (box of 1000)",
    "PackRight",
    "Packaging",
    "PackRight Supplies",
    "sales@packright.co.uk",
    "020 7946 0003",
    2,
    "packaging",
    "Brown cardboard box with handwritten CP12 on front",
    true,
    "box",
    "box",
    1,
    2,
    true,
    1,
    4,
    1,
    true,
    62.0,
  ],
];

export async function GET() {
  const csv = toCsv(HEADERS, EXAMPLE_ROWS);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="event-storey-inventory-template.csv"',
    },
  });
}

