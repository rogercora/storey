import { describe, expect, it } from "vitest";
import { parseCsvRecords, toCsv } from "./csv";

describe("csv", () => {
  it("parses UTF-8 BOM, quoted commas and escaped quotes", () => {
    const raw = `\uFEFFcode_tag,name,visual_hints\r\nCP12,"12oz Hot Cups, 1000","Brown box ""CP12"" on top"\r\n`;
    const rows = parseCsvRecords(raw);
    expect(rows).toEqual([
      { code_tag: "CP12", name: "12oz Hot Cups, 1000", visual_hints: 'Brown box "CP12" on top' },
    ]);
  });

  it("serialises with BOM and formula-injection guard", () => {
    const out = toCsv(["Item", "Qty"], [["=SUM(A1)", 3]]);
    expect(out.startsWith("\uFEFFItem,Qty\r\n'=SUM(A1),3")).toBe(true);
  });
});

