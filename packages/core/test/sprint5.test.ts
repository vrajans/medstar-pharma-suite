import { describe, expect, it } from "vitest";
import {
  buildGstr1Json, buildTallyMastersXml, buildTallyVouchersXml, drCr, expenseTax, fyStart, gstQuarter, monthRange, setOffGst,
  tallyVoucherType, uqcFor, validateVoucher, type Gstr1Data, type TallyEntry, type VoucherLineInput,
} from "../src";

const L = (code: string, grp: VoucherLineInput["grp"], dr: number, cr: number, partyId?: string): VoucherLineInput =>
  ({ code, grp, name: code, debitPaise: dr, creditPaise: cr, partyId });

describe("voucher rules (mirror post_voucher)", () => {
  it("accepts a normal payment, receipt, contra with charges, expense with GST, journal", () => {
    expect(validateVoucher("payment", [L("RENT", "indirect_exp", 100, 0), L("BANK", "bank", 0, 100)])).toEqual([]);
    expect(validateVoucher("receipt", [L("CASH", "cash", 500, 0), L("DEBTORS", "debtors", 0, 500, "c1")])).toEqual([]);
    expect(validateVoucher("contra", [L("BANK", "bank", 980, 0), L("BANK_CHG", "indirect_exp", 20, 0), L("CARD_CLR", "bank", 0, 1000)])).toEqual([]);
    expect(validateVoucher("expense", [L("REPAIRS", "indirect_exp", 1000, 0), L("IN_CGST", "tax_input", 90, 0), L("IN_SGST", "tax_input", 90, 0), L("CASH", "cash", 0, 1180)])).toEqual([]);
    expect(validateVoucher("journal", [L("BANK", "bank", 100, 0), L("OPENING_BAL", "capital", 0, 100)])).toEqual([]);
  });
  it("explains what is wrong", () => {
    expect(validateVoucher("journal", [L("RENT", "indirect_exp", 100, 0), L("CAPITAL", "capital", 0, 90)]).join()).toMatch(/must be equal/);
    expect(validateVoucher("payment", [L("RENT", "indirect_exp", 100, 0), L("CAPITAL", "capital", 0, 100)]).join()).toMatch(/Payment/);
    expect(validateVoucher("journal", [L("INVENTORY", "stock", 100, 0), L("CAPITAL", "capital", 0, 100)]).join()).toMatch(/automatically/);
    expect(validateVoucher("receipt", [L("CASH", "cash", 100, 0), L("DEBTORS", "debtors", 0, 100)]).join()).toMatch(/customer/);
    expect(validateVoucher("contra", [L("BANK", "bank", 100, 0), L("SALES", "sales", 0, 100)]).join()).toMatch(/Contra/);
    expect(validateVoucher("expense", [L("REPAIRS", "indirect_exp", 100, 0), L("IN_CGST", "tax_input", 5, 0), L("CASH", "cash", 0, 105)], { composition: true }).join())
      .toMatch(/Composition/);
  });
});

describe("helpers", () => {
  it("expense GST split matches purchases (floor CGST, remainder SGST)", () => {
    expect(expenseTax(10001, 18, false)).toEqual({ taxablePaise: 10001, cgstPaise: 900, sgstPaise: 900, igstPaise: 0, totalPaise: 11801 });
    expect(expenseTax(10000, 5, true)).toMatchObject({ igstPaise: 500, cgstPaise: 0, totalPaise: 10500 });
  });
  it("dates: FY start, month, GST quarter", () => {
    expect(fyStart("2026-11-19")).toBe("2026-04-01");
    expect(fyStart("2027-03-31")).toBe("2026-04-01");
    expect(monthRange("2027-02")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(gstQuarter("2026-11-19")).toEqual({ from: "2026-10-01", to: "2026-12-31", label: "Q3 FY 2026-27" });
    expect(gstQuarter("2027-02-10")).toEqual({ from: "2027-01-01", to: "2027-03-31", label: "Q4 FY 2026-27" });
  });
  it("Dr/Cr display", () => {
    expect(drCr(-500)).toEqual({ amount: 500, side: "Cr" });
    expect(drCr(0).side).toBe("");
  });
});

const g1: Gstr1Data = {
  gstin: "29AAAFM1234C1Z5", stateCode: "29", from: "2026-11-01", to: "2026-11-30",
  b2b: [
    { doc_no: "BLR1/26-27/0042", doc_date: "2026-11-19", doc_value: 6200, ctin: "29AABCS1429B1ZB", party: "Sunrise Clinic", rate: 5, txval: 5905, camt: 147, samt: 148, iamt: 0 },
  ],
  b2cs: [{ rate: 5, txval: 100000, camt: 2500, samt: 2500, iamt: 0 }, { rate: 18, txval: 10000, camt: 900, samt: 900, iamt: 0 }],
  cdnr: [{ doc_no: "BLRCN/26-27/0003", doc_date: "2026-11-19", doc_value: 3100, ctin: "29AABCS1429B1ZB", party: "Sunrise Clinic", orig_no: "BLR1/26-27/0042", orig_date: "2026-11-19", rate: 5, txval: 2952, camt: 74, samt: 74, iamt: 0 }],
  nil: { b2b: 0, b2c: 45000 },
  hsn: [
    { b2b: true, hsn: "30049099", unit: "Tab", rate: 5, qty: 15, txval: 2953, camt: 73, samt: 74, iamt: 0 },
    { b2b: false, hsn: "30049099", unit: "Tab", rate: 5, qty: 300, txval: 60000, camt: 1500, samt: 1500, iamt: 0 },
    { b2b: false, hsn: "30049099", unit: "Tablet", rate: 5, qty: 200, txval: 40000, camt: 1000, samt: 1000, iamt: 0 },
    { b2b: false, hsn: "3304", unit: "ml", rate: 18, qty: 500, txval: 10000, camt: 900, samt: 900, iamt: 0 },
  ],
  docs: [{ kind: "INV", series: "BLR1/26-27/", first_no: "BLR1/26-27/0001", last_no: "BLR1/26-27/0042", total: 42, cancelled: 2 },
         { kind: "CN", series: "BLRCN/26-27/", first_no: "BLRCN/26-27/0003", last_no: "BLRCN/26-27/0003", total: 1, cancelled: 0 }],
  totals: { invoices: 40, creditNotes: 1, txval: 0, camt: 0, samt: 0, iamt: 0 },
};

describe("GSTR-1 JSON", () => {
  const { json, warnings } = buildGstr1Json(g1, "112026");
  it("builds portal sections in rupees", () => {
    expect(json.fp).toBe("112026");
    expect(json.b2b).toEqual([{ ctin: "29AABCS1429B1ZB", inv: [{ inum: "BLR1/26-27/0042", idt: "19-11-2026", val: 62, pos: "29", rchrg: "N", inv_typ: "R",
      itms: [{ num: 1, itm_det: { txval: 59.05, rt: 5, camt: 1.47, samt: 1.48, csamt: 0 } }] }] }]);
    expect(json.cdnr[0]).toMatchObject({ ctin: "29AABCS1429B1ZB", nt: [{ ntty: "C", nt_num: "BLRCN/26-27/0003", nt_dt: "19-11-2026", val: 31 }] });
    expect(json.b2cs).toEqual([
      { sply_ty: "INTRA", pos: "29", typ: "OE", rt: 5, txval: 1000, camt: 25, samt: 25, csamt: 0 },
      { sply_ty: "INTRA", pos: "29", typ: "OE", rt: 18, txval: 100, camt: 9, samt: 9, csamt: 0 },
    ]);
    expect(json.nil.inv).toEqual([{ sply_ty: "INTRAB2C", nil_amt: 450, expt_amt: 0, ngsup_amt: 0 }]);
    expect(json.doc_issue.doc_det).toEqual([
      { doc_num: 1, doc_typ: "Invoices for outward supply", docs: [{ num: 1, from: "BLR1/26-27/0001", to: "BLR1/26-27/0042", totnum: 42, cancel: 2, net_issue: 40 }] },
      { doc_num: 5, doc_typ: "Credit Note", docs: [{ num: 1, from: "BLRCN/26-27/0003", to: "BLRCN/26-27/0003", totnum: 1, cancel: 0, net_issue: 1 }] },
    ]);
  });
  it("merges HSN rows whose units map to the same UQC and splits B2B / B2C", () => {
    expect(json.hsn.hsn_b2b).toHaveLength(1);
    expect(json.hsn.hsn_b2c).toEqual([
      { num: 1, hsn_sc: "30049099", desc: "", uqc: "TBS", qty: 500, rt: 5, txval: 1000, iamt: 0, camt: 25, samt: 25, csamt: 0 },
      { num: 2, hsn_sc: "3304", desc: "", uqc: "MLT", qty: 500, rt: 18, txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0 },
    ]);
    expect(warnings.join()).toMatch(/3304 has fewer than 6 digits/);
  });
  it("maps units to UQC", () => {
    expect(uqcFor("Tab")).toBe("TBS");
    expect(uqcFor("ML")).toBe("MLT");
    expect(uqcFor("Strip")).toBe("PAC");
    expect(uqcFor("dose")).toBe("OTH");
  });
});

describe("GSTR-3B set-off order", () => {
  it("uses IGST credit first, never CGST for SGST", () => {
    const r = setOffGst({ iamt: 0, camt: 10000, samt: 10000 }, { iamt: 3000, camt: 2000, samt: 9000 });
    expect(r.cashPayable).toEqual({ iamt: 0, camt: 5000, samt: 1000 });
    expect(r.creditCarriedForward).toEqual({ iamt: 0, camt: 0, samt: 0 });
    expect(r.used[0]).toEqual({ from: "iamt", to: "camt", amount: 3000 });
  });
  it("carries forward excess credit and ignores negative liability", () => {
    const r = setOffGst({ iamt: 0, camt: -50, samt: 100 }, { iamt: 0, camt: 500, samt: 500 });
    expect(r.cashPayable).toEqual({ iamt: 0, camt: 0, samt: 0 });
    expect(r.creditCarriedForward).toEqual({ iamt: 0, camt: 500, samt: 400 });
    expect(r.totalCash).toBe(0);
  });
});

describe("Tally export", () => {
  const entries: TallyEntry[] = [
    { id: "e1", date: "2026-11-19", source: "sale", narration: "Sale BLR1/26-27/0042", docNo: "BLR1/26-27/0042", lines: [
      { ledger: "Sunrise Clinic (9800000002)", grp: "debtors", code: "DEBTORS", party: true, debit: 6200, credit: 0 },
      { ledger: "Sales", grp: "sales", code: "SALES", party: false, debit: 0, credit: 5905 },
      { ledger: "Output CGST", grp: "tax_output", code: "OUT_CGST", party: false, debit: 0, credit: 147 },
      { ledger: "Output SGST", grp: "tax_output", code: "OUT_SGST", party: false, debit: 0, credit: 148 },
    ] },
    { id: "e2", date: "2026-11-19", source: "voucher", voucherKind: "expense", narration: "Expense <AC> & service", docNo: "BLREV/26-27/0001", lines: [
      { ledger: "Repairs & maintenance", grp: "indirect_exp", code: "REPAIRS", party: false, debit: 10000, credit: 0 },
      { ledger: "Cash in hand", grp: "cash", code: "CASH", party: false, debit: 0, credit: 10000 },
    ] },
  ];
  it("creates party and group ledgers", () => {
    const m = buildTallyMastersXml("MedStar Demo", entries);
    expect(m).toContain('<LEDGER NAME="Sunrise Clinic (9800000002)" ACTION="Create">');
    expect(m).toContain("<PARENT>Sundry Debtors</PARENT>");
    expect(m).toContain('<LEDGER NAME="Repairs &amp; maintenance" ACTION="Create">');
    expect(m).toContain("<REPORTNAME>All Masters</REPORTNAME>");
  });
  it("writes vouchers with Tally's sign convention and escapes text", () => {
    const v = buildTallyVouchersXml("MedStar Demo", entries);
    expect(v).toContain('<VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20261119</DATE>');
    expect(v).toContain("<LEDGERNAME>Sunrise Clinic (9800000002)</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-62.00</AMOUNT>");
    expect(v).toContain("<LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>59.05</AMOUNT>");
    expect(v).toContain("Expense &lt;AC&gt; &amp; service");
    expect(v).toContain('VCHTYPE="Payment"');
  });
  it("maps voucher types", () => {
    expect(tallyVoucherType({ source: "sale_return", lines: [] })).toBe("Credit Note");
    expect(tallyVoucherType({ source: "voucher", voucherKind: "contra", lines: [] })).toBe("Contra");
    expect(tallyVoucherType({ source: "shift_close", lines: [] })).toBe("Journal");
  });
});
