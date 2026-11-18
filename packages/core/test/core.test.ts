import { describe, expect, it } from "vitest";
import {
  computeLine, computeBill, resolveGstRate, isValidGstin, BillingRuleError,
  allocateFefo, expiryFromMonthYear, StockError, type Batch,
  validateCounterSale, validateOnlineCart, hasBlockingIssue,
  canTransition, financialYear, formatInvoiceNo, provisionalNo,
  toBase, describeBase, formatINR, rupeesToPaise, PostSaleSchema,
} from "../src";

describe("GST line calculation (QA billing pack)", () => {
  it("T-BIL-001 MRP 105 @5% → taxable 100, CGST 2.50, SGST 2.50", () => {
    const l = computeLine({ packMrpPaise: 10500, unitsPerPack: 1, qtyBase: 1, gstRate: 5, hsn: "3004" });
    expect(l).toMatchObject({ amountPaise: 10500, taxablePaise: 10000, cgstPaise: 250, sgstPaise: 250, igstPaise: 0 });
  });
  it("T-BIL-002 loose sale 5 of 15 tablets at ₹30.91/strip → ₹10.30", () => {
    expect(computeLine({ packMrpPaise: 3091, unitsPerPack: 15, qtyBase: 5, gstRate: 5, hsn: "3004" }).amountPaise).toBe(1030);
  });
  it("T-BIL-003 10% discount on ₹119.50 @5%", () => {
    const l = computeLine({ packMrpPaise: 11950, unitsPerPack: 10, qtyBase: 10, discountPct: 10, gstRate: 5, hsn: "3004" });
    expect(l.amountPaise).toBe(10755);
    expect(l.taxablePaise).toBe(10243);
    expect(l.cgstPaise + l.sgstPaise).toBe(512);
    expect(l.discountPaise).toBe(1195);
  });
  it("T-BIL-004 nil-rated life-saving drug has no tax", () => {
    const l = computeLine({ packMrpPaise: 500000, unitsPerPack: 1, qtyBase: 1, gstRate: 0, hsn: "3002" });
    expect(l.taxablePaise).toBe(500000);
    expect(l.cgstPaise + l.sgstPaise).toBe(0);
  });
  it("odd paisa goes to SGST", () => {
    const l = computeLine({ packMrpPaise: 2200, unitsPerPack: 1, qtyBase: 1, gstRate: 5, hsn: "3004" });
    expect([l.taxablePaise, l.cgstPaise, l.sgstPaise]).toEqual([2095, 52, 53]);
  });
  it("inter-state uses IGST", () => {
    const l = computeLine({ packMrpPaise: 10500, unitsPerPack: 1, qtyBase: 1, gstRate: 5, hsn: "3004" }, { supply: "inter" });
    expect([l.cgstPaise, l.sgstPaise, l.igstPaise]).toEqual([0, 0, 500]);
  });
  it("T-BIL-006 price above MRP is rejected", () => {
    expect(() => computeLine({ packMrpPaise: 1000, packPricePaise: 1100, unitsPerPack: 1, qtyBase: 1, gstRate: 5, hsn: "3004" }))
      .toThrow(BillingRuleError);
  });
  it("T-BIL-007 composition dealer → Bill of Supply, no tax", () => {
    const b = computeBill([{ packMrpPaise: 10500, unitsPerPack: 1, qtyBase: 1, gstRate: 5, hsn: "3004" }], { scheme: "composition" });
    expect(b.documentType).toBe("BILL_OF_SUPPLY");
    expect(b.cgstPaise + b.sgstPaise + b.igstPaise).toBe(0);
  });
  it("returns (negative qty) mirror the sale", () => {
    const l = computeLine({ packMrpPaise: 10500, unitsPerPack: 1, qtyBase: -1, gstRate: 5, hsn: "3004" });
    expect([l.amountPaise, l.taxablePaise, l.cgstPaise + l.sgstPaise]).toEqual([-10500, -10000, -500]);
  });
});

describe("Bill totals", () => {
  const lines = [
    { packMrpPaise: 3091, unitsPerPack: 15, qtyBase: 30, gstRate: 5, hsn: "30049099" },
    { packMrpPaise: 11950, unitsPerPack: 3, qtyBase: 3, discountPct: 10, gstRate: 5, hsn: "30042019" },
    { packMrpPaise: 2200, unitsPerPack: 10, qtyBase: 10, gstRate: 5, hsn: "30049099" },
  ];
  it("matches the POS wireframe example (₹191.00, round-off −0.37)", () => {
    const b = computeBill(lines);
    expect(b.subtotalPaise).toBe(19137);
    expect(b.taxablePaise).toBe(18226);
    expect([b.cgstPaise, b.sgstPaise]).toEqual([455, 456]);
    expect(b.roundOffPaise).toBe(-37);
    expect(b.totalPaise).toBe(19100);
    expect(b.hsnSummary).toHaveLength(2);
  });
  it("T-BIL-005 ₹190.63 rounds up by +0.37", () => {
    const b = computeBill([{ packMrpPaise: 19063, unitsPerPack: 1, qtyBase: 1, gstRate: 5, hsn: "3004" }]);
    expect(b.roundOffPaise).toBe(37);
    expect(b.totalPaise).toBe(19100);
  });
  it("bill-level discount stacks on line discount", () => {
    const b = computeBill([{ packMrpPaise: 10000, unitsPerPack: 1, qtyBase: 1, discountPct: 10, gstRate: 5, hsn: "3004" }], { billDiscountPct: 10, roundToRupee: false });
    expect(b.subtotalPaise).toBe(8100);
  });
});

describe("Tax rate resolution (GST 2.0 effective 22-Sep-2025)", () => {
  const rows = [
    { hsnPrefix: "3004", rate: 12, effectiveFrom: "2017-07-01", effectiveTo: "2025-09-21" },
    { hsnPrefix: "3004", rate: 5, effectiveFrom: "2025-09-22" },
    { hsnPrefix: "33", rate: 18, effectiveFrom: "2017-07-01" },
    { hsnPrefix: "30021500", rate: 0, effectiveFrom: "2025-09-22" },
  ];
  it("uses date-effective rate", () => {
    expect(resolveGstRate("30049099", "2025-09-01", rows)).toBe(12);
    expect(resolveGstRate("30049099", "2026-11-17", rows)).toBe(5);
  });
  it("longest prefix wins", () => {
    expect(resolveGstRate("30021500", "2026-01-01", rows)).toBe(0);
    expect(resolveGstRate("33049990", "2026-01-01", rows)).toBe(18);
  });
  it("throws when no rate", () => expect(() => resolveGstRate("9999", "2026-01-01", rows)).toThrow());
});

describe("GSTIN validation", () => {
  it("accepts a valid checksum and rejects a tampered one", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
  });
});

describe("FEFO allocation", () => {
  const today = "2026-11-17";
  const b = (id: string, expiry: string, qty: number, status: Batch["status"] = "active", receivedAt = "2026-01-01"): Batch =>
    ({ id, batchNo: id.toUpperCase(), expiry, qtyBase: qty, status, receivedAt, packMrpPaise: 3091 });
  const batches = [
    b("late", "2028-01-31", 100),
    b("soon", "2026-12-10", 10),
    b("expired", "2026-10-31", 50),
    b("recalled", "2026-11-30", 50, "recalled"),
  ];
  it("picks earliest-expiry sellable batch first and flags near expiry", () => {
    const a = allocateFefo(batches, 25, today);
    expect(a.map((x) => [x.batchId, x.qtyBase, x.nearExpiry])).toEqual([["soon", 10, true], ["late", 15, false]]);
  });
  it("never allocates expired or recalled batches", () => {
    expect(() => allocateFefo(batches, 111, today)).toThrow(StockError);
  });
  it("T-CMP-005 manual pick of expired batch is blocked", () => {
    expect(() => allocateFefo(batches, 1, today, { preferredBatchId: "expired" })).toThrow(/expired/);
    expect(() => allocateFefo(batches, 1, today, { preferredBatchId: "recalled" })).toThrow(/recalled/);
  });
  it("honours a valid preferred batch", () => {
    expect(allocateFefo(batches, 5, today, { preferredBatchId: "late" })[0]!.batchId).toBe("late");
  });
  it("converts printed expiry to month end", () => {
    expect(expiryFromMonthYear("08/27")).toBe("2027-08-31");
    expect(expiryFromMonthYear("02/2028")).toBe("2028-02-29");
  });
});

describe("Drug schedule compliance", () => {
  const policy = { pharmacistPresence: "hard" as const, rxValidityDays: 180 };
  const otc = { id: "1", name: "Dolo 650", schedule: "OTC" as const };
  const h = { id: "2", name: "Azithral 500", schedule: "H" as const };
  const h1 = { id: "3", name: "Alprax 0.25", schedule: "H1" as const, habitForming: true };
  const x = { id: "4", name: "Sch X drug", schedule: "X" as const };

  it("OTC passes with no checks", () => {
    expect(validateCounterSale([otc], { pharmacistOnDuty: false, pharmacistApproved: false, today: "2026-11-17", policy })).toEqual([]);
  });
  it("Schedule H requires pharmacist approval", () => {
    const i = validateCounterSale([h], { pharmacistOnDuty: true, pharmacistApproved: false, today: "2026-11-17", policy });
    expect(i.map((x) => x.code)).toContain("PHARMACIST_APPROVAL");
  });
  it("T-CMP-001 H1 without prescriber reg no. is blocked", () => {
    const i = validateCounterSale([h1], {
      pharmacistOnDuty: true, pharmacistApproved: true, today: "2026-11-17", policy,
      rx: { patientName: "Meena", patientAddress: "Indiranagar", prescriberName: "Dr Rao", rxDate: "2026-11-10" },
    });
    expect(hasBlockingIssue(i)).toBe(true);
    expect(i.find((x) => x.code === "MISSING_PRESCRIBERREGNO")?.message).toBe("Schedule H1: prescriber registration number required");
  });
  it("complete H1 sale passes", () => {
    const i = validateCounterSale([h1], {
      pharmacistOnDuty: true, pharmacistApproved: true, today: "2026-11-17", policy,
      rx: { patientName: "Meena", patientAddress: "Indiranagar", prescriberName: "Dr Rao", prescriberRegNo: "KMC-12345", rxDate: "2026-11-10" },
    });
    expect(i).toEqual([]);
  });
  it("Schedule X needs a retained prescription copy", () => {
    const i = validateCounterSale([x], {
      pharmacistOnDuty: true, pharmacistApproved: true, today: "2026-11-17", policy,
      rx: { patientName: "A", patientAddress: "B", prescriberName: "C", prescriberRegNo: "D", rxDate: "2026-11-10" },
    });
    expect(i.map((x) => x.code)).toEqual(["RX_COPY"]);
  });
  it("soft pharmacist policy warns instead of blocking", () => {
    const i = validateCounterSale([h], { pharmacistOnDuty: false, pharmacistApproved: true, today: "2026-11-17", policy: { ...policy, pharmacistPresence: "soft" } });
    expect(hasBlockingIssue(i)).toBe(false);
  });
  it("T-CMP-003 Schedule X and habit-forming drugs cannot be delivered online", () => {
    const i = validateOnlineCart([otc, h1, x], { fulfilment: "delivery", rxUploaded: true });
    expect(i.filter((x) => x.code === "NOT_FOR_DELIVERY").map((x) => x.productId)).toEqual(["3", "4"]);
  });
  it("online Rx items require uploaded prescription", () => {
    expect(validateOnlineCart([h], { fulfilment: "delivery", rxUploaded: false })[0]!.code).toBe("RX_REQUIRED");
  });
});

describe("Online order state machine", () => {
  it("T-CMP-004 Rx order cannot be confirmed without pharmacist approval", () => {
    expect(canTransition("placed", "confirmed", { hasRxItems: true, rxApproved: false }).ok).toBe(false);
    expect(canTransition("rx_verification", "confirmed", { hasRxItems: true, rxApproved: false }).ok).toBe(false);
    expect(canTransition("rx_verification", "confirmed", { hasRxItems: true, rxApproved: true }).ok).toBe(true);
  });
  it("dispatch requires invoice; delivery requires OTP", () => {
    expect(canTransition("packed", "out_for_delivery", { hasRxItems: false, rxApproved: false }).ok).toBe(false);
    expect(canTransition("packed", "out_for_delivery", { hasRxItems: false, rxApproved: false, invoiceId: "i" }).ok).toBe(true);
    expect(canTransition("out_for_delivery", "delivered", { hasRxItems: false, rxApproved: false, deliveryOtpVerified: false }).ok).toBe(false);
  });
  it("cannot cancel after packing", () => {
    expect(canTransition("packed", "cancelled", { hasRxItems: false, rxApproved: false }).ok).toBe(false);
  });
});

describe("Invoice numbering", () => {
  it("financial year runs April–March", () => {
    expect(financialYear("2026-11-17")).toBe("26-27");
    expect(financialYear("2027-03-31")).toBe("26-27");
    expect(financialYear("2027-04-01")).toBe("27-28");
  });
  it("≤ 16 chars, GST Rule 46", () => {
    const n = formatInvoiceNo("BLR1", "2026-11-17", 123);
    expect(n).toBe("BLR1/26-27/00123");
    expect(n.length).toBeLessThanOrEqual(16);
    expect(provisionalNo("POS2", 7)).toBe("OFF-POS2-7");
  });
});

describe("Units & formatting", () => {
  const levels = [{ code: "TAB", label: "Tab", baseUnits: 1 }, { code: "STRIP", label: "Strip", baseUnits: 15 }, { code: "BOX", label: "Box", baseUnits: 150 }];
  it("converts and describes", () => {
    expect(toBase(2, "STRIP", levels)).toBe(30);
    expect(describeBase(187, levels)).toBe("1 Box + 2 Strip + 7 Tab");
  });
  it("formats INR with Indian grouping", () => {
    expect(formatINR(12345678)).toBe("₹1,23,456.78");
    expect(rupeesToPaise("30.91")).toBe(3091);
  });
});

describe("Contracts", () => {
  it("validates a post_sale payload", () => {
    const r = PostSaleSchema.safeParse({
      billUuid: crypto.randomUUID(), storeId: crypto.randomUUID(), deviceCode: "POS1",
      billedAt: new Date().toISOString(),
      lines: [{ productId: crypto.randomUUID(), qtyBase: 10 }],
      payments: [{ mode: "upi", amountPaise: 3091 }],
    });
    expect(r.success).toBe(true);
  });
});
