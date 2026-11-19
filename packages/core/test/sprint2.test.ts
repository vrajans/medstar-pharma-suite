import { describe, expect, it } from "vitest";
import {
  computePurchaseLine, computePurchaseTotals, invoiceMismatch, parseCsv, csvToObjects, toCsv,
  parseProductRow, parseStockRow, parseSchedule,
} from "../src";

describe("Purchase maths (mirrors post_purchase)", () => {
  it("Dolo GRN: 10 strips + 1 free @ PTR 21.00, 5% → cost per tab 127.27 paise", () => {
    const l = computePurchaseLine({ packRatePaise: 2100, packMrpPaise: 3091, qtyPacks: 10, freePacks: 1, gstRate: 5, unitsPerPack: 15 });
    expect([l.taxablePaise, l.taxPaise, l.unitsReceived]).toEqual([21000, 1050, 165]);
    expect(l.costPerUnitPaise.toFixed(2)).toBe("127.27");
    expect(l.marginPct).toBeGreaterThan(30);
  });
  it("composition dealer cost includes GST", () => {
    const l = computePurchaseLine({ packRatePaise: 1000, packMrpPaise: 2000, qtyPacks: 1, gstRate: 5, unitsPerPack: 10 }, { scheme: "composition" });
    expect(l.costPerUnitPaise).toBe(105);
  });
  it("PTR above MRP is rejected; thin margin is warned", () => {
    expect(() => computePurchaseLine({ packRatePaise: 2000, packMrpPaise: 1900, qtyPacks: 1, gstRate: 5, unitsPerPack: 1 })).toThrow(/above MRP/);
    expect(computePurchaseLine({ packRatePaise: 1850, packMrpPaise: 1950, qtyPacks: 1, gstRate: 5, unitsPerPack: 1 }).warnings[0]).toMatch(/Low margin/);
  });
  it("totals match the SQL GRN test (₹763.00, round-off −0.35)", () => {
    const lines = [
      computePurchaseLine({ packRatePaise: 2100, packMrpPaise: 3091, qtyPacks: 2, gstRate: 5, unitsPerPack: 15 }),
      computePurchaseLine({ packRatePaise: 2100, packMrpPaise: 3091, qtyPacks: 10, freePacks: 1, gstRate: 5, unitsPerPack: 15 }),
      computePurchaseLine({ packRatePaise: 1500, packMrpPaise: 2200, qtyPacks: 5, gstRate: 5, unitsPerPack: 10 }),
      computePurchaseLine({ packRatePaise: 8000, packMrpPaise: 11950, qtyPacks: 5, gstRate: 5, unitsPerPack: 3 }),
    ];
    const t = computePurchaseTotals(lines, false);
    expect([t.taxablePaise, t.taxPaise, t.totalPaise, t.roundOffPaise]).toEqual([72700, 3635, 76300, -35]);
    expect(t.cgstPaise + t.sgstPaise).toBe(3635);
    expect(invoiceMismatch(t.totalPaise, 76300)).toBeNull();
    expect(invoiceMismatch(t.totalPaise, 77300)).toBe(1000);
  });
});

describe("CSV", () => {
  it("handles quotes, commas, CRLF, BOM and blank lines", () => {
    const rows = parseCsv('﻿name,composition\r\n"Dolo 650","Paracetamol, 650mg"\r\n\r\n"He said ""hi""",x\n');
    expect(rows).toEqual([["name", "composition"], ["Dolo 650", "Paracetamol, 650mg"], ['He said "hi"', "x"]]);
  });
  it("normalises headers and round-trips", () => {
    expect(csvToObjects("Product Name,Units-Per Pack\nA,10")[0]).toEqual({ product_name: "A", units_per_pack: "10" });
    expect(parseCsv(toCsv([["a,b", 'q"', 3]]))).toEqual([["a,b", 'q"', "3"]]);
  });
});

describe("Import row parsing", () => {
  it("parses a product row with defaults", () => {
    const r = parseProductRow({ name: "Dolo 650 Tablet", hsn: "3004 9099", schedule: "otc", units_per_pack: "15", barcode: "8901234500011" });
    expect(r.ok && r.value).toMatchObject({ hsn: "30049099", schedule: "OTC", unitsPerPack: 15, packLabel: "Strip", category: "OTC" });
  });
  it("collects every error on a bad row", () => {
    const r = parseProductRow({ name: "", hsn: "30", schedule: "Q", units_per_pack: "0", gst_override: "50" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(5);
  });
  it("maps schedule spellings", () => {
    expect(["Sch H1", "rx", "Narcotic", "schedule x"].map(parseSchedule)).toEqual(["H1", "H", "NDPS", "X"]);
  });
  it("parses opening stock in packs + loose units", () => {
    const r = parseStockRow({ barcode: "8901", batch: "dl2611", expiry: "08/28", mrp: "30.91", cost: "21", qty_packs: "10", qty_units: "7" }, 15);
    expect(r.ok && r.value).toEqual({ barcode: "8901", productName: undefined, batchNo: "DL2611", expiry: "2028-08-31", packMrpPaise: 3091, packCostPaise: 2100, qtyBase: 157 });
  });
  it("rejects stock rows with bad expiry / cost above MRP / zero qty", () => {
    const r = parseStockRow({ product: "X", batch: "B1", expiry: "13/27", mrp: "10", cost: "12" }, 10);
    expect(!r.ok && r.errors.length).toBe(3);
  });
});
