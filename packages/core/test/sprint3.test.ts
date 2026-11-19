import { describe, expect, it } from "vitest";
import { computeReturnLine, creditNoteTotal, NOTHING_RETURNED } from "../src";

// Alprax line from the SQL test bill: 10 tabs, ₹22.00, taxable 20.95, CGST 0.52, SGST 0.53, cost ₹15.00
const alprax = { qtyBase: 10, amountPaise: 2200, taxablePaise: 2095, cgstPaise: 52, sgstPaise: 53, igstPaise: 0, costPaise: 1500, gstRate: 5, hsn: "30049099" };

describe("Sales return maths (mirrors post_sales_return)", () => {
  it("pro-rates a partial return", () => {
    const r = computeReturnLine(alprax, NOTHING_RETURNED, 5);
    expect(r).toMatchObject({ amountPaise: 1100, taxablePaise: 1048, cgstPaise: 26, sgstPaise: 26, costPaise: 750, final: false });
  });
  it("final return takes the exact remainder so the line nets to zero", () => {
    const first = computeReturnLine(alprax, NOTHING_RETURNED, 5);
    const r = computeReturnLine(alprax, { qtyBase: 5, ...first }, 5);
    expect(r).toMatchObject({ amountPaise: 1100, taxablePaise: 1047, cgstPaise: 26, sgstPaise: 27, costPaise: 750, final: true });
    expect(first.taxablePaise + r.taxablePaise).toBe(alprax.taxablePaise);
  });
  it("refuses over-returns and zero", () => {
    expect(() => computeReturnLine(alprax, { ...NOTHING_RETURNED, qtyBase: 8 }, 3)).toThrow(/Only 2/);
    expect(() => computeReturnLine(alprax, NOTHING_RETURNED, 0)).toThrow();
  });
  it("composition bills carry no tax on the credit note", () => {
    const r = computeReturnLine({ ...alprax, taxablePaise: 2200, cgstPaise: 0, sgstPaise: 0 }, NOTHING_RETURNED, 3, { composition: true });
    expect([r.amountPaise, r.taxablePaise, r.cgstPaise + r.sgstPaise]).toEqual([660, 660, 0]);
  });
  it("credit note rounds to the rupee", () => {
    expect(creditNoteTotal([1100, 3091])).toEqual({ exactPaise: 4191, roundOffPaise: 9, totalPaise: 4200 });
  });
});
