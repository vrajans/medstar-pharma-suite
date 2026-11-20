import type { Paise } from "./money";

/** Shapes returned by the gstr1() / gstr3b() / composition_summary() database functions (amounts in paise). */
export interface Gstr1Data {
  gstin: string | null;
  stateCode: string;
  /** store codes covered — all branches registered under this GSTIN */
  stores?: string[];
  from: string;
  to: string;
  b2b: Array<{ doc_no: string; doc_date: string; doc_value: Paise; ctin: string; party: string | null; rate: number; txval: Paise; camt: Paise; samt: Paise; iamt: Paise }>;
  b2cs: Array<{ rate: number; txval: Paise; camt: Paise; samt: Paise; iamt: Paise }>;
  cdnr: Array<{ doc_no: string; doc_date: string; doc_value: Paise; ctin: string; party: string | null; orig_no: string; orig_date: string; rate: number; txval: Paise; camt: Paise; samt: Paise; iamt: Paise }>;
  nil: { b2b: Paise; b2c: Paise };
  hsn: Array<{ b2b: boolean; hsn: string; unit: string; rate: number; qty: number; txval: Paise; camt: Paise; samt: Paise; iamt: Paise }>;
  docs: Array<{ kind: "INV" | "CN"; series: string; first_no: string; last_no: string; total: number; cancelled: number }>;
  totals: { invoices: number; creditNotes: number; txval: Paise; camt: Paise; samt: Paise; iamt: Paise };
}

export interface TaxHeads { iamt: Paise; camt: Paise; samt: Paise }

export interface Gstr3bData {
  gstin: string | null;
  from: string;
  to: string;
  outwardTaxable: TaxHeads & { txval: Paise };
  outwardNil: Paise;
  itc: TaxHeads;
  itcBySource: Record<string, Paise>;
  inwardNil: { intra: Paise; inter: Paise };
  booksOutputTax: TaxHeads;
}

export interface CompositionData {
  gstin: string | null;
  from: string;
  to: string;
  ratePct: number;
  turnover: Paise;
  taxableTurnover: Paise;
  exemptTurnover: Paise;
  cgst: Paise;
  sgst: Paise;
  inward: Array<{ registered: boolean; rate: number; txval: Paise; tax: Paise; inter: boolean }>;
}

/** Rupees with 2 decimals as a JSON number, the way the GST offline tool expects. */
export const rs = (p: Paise) => Math.round(p) / 100;

/** dd-mm-yyyy from an ISO date. */
const gstDate = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/** Unit label on the product → GST Unit Quantity Code. Unknown units go to OTH. */
export function uqcFor(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/[^a-z]/g, "");
  const map: Record<string, string> = {
    tab: "TBS", tabs: "TBS", tablet: "TBS", tablets: "TBS",
    cap: "NOS", caps: "NOS", capsule: "NOS", nos: "NOS", no: "NOS", unit: "UNT", units: "UNT", piece: "PCS", pcs: "PCS", pc: "PCS",
    ml: "MLT", l: "LTR", ltr: "LTR", litre: "LTR", g: "GMS", gm: "GMS", gms: "GMS", gram: "GMS", kg: "KGS", mg: "OTH",
    bottle: "BTL", btl: "BTL", box: "BOX", pack: "PAC", pac: "PAC", strip: "PAC", tube: "TUB", vial: "NOS", amp: "NOS", ampoule: "NOS",
    sachet: "NOS", pair: "PRS", set: "SET", roll: "ROL", can: "CAN", jar: "NOS",
  };
  return map[u] ?? "OTH";
}

export interface Gstr1Json {
  gstin: string;
  fp: string;
  b2b: unknown[];
  b2cs: unknown[];
  cdnr: unknown[];
  nil: { inv: unknown[] };
  hsn: { hsn_b2b: unknown[]; hsn_b2c: unknown[] };
  doc_issue: { doc_det: unknown[] };
}

/**
 * GSTR-1 in the GST portal's JSON layout (B2B, B2CS, CDNR, Nil, HSN split B2B/B2C, documents issued).
 * fp = return period MMYYYY. Validate the file in the GST Offline Tool before uploading — warnings explain anything unusual.
 */
export function buildGstr1Json(d: Gstr1Data, fp: string): { json: Gstr1Json; warnings: string[] } {
  const warnings: string[] = [];
  if (!d.gstin) warnings.push("The store has no GSTIN — add it in Settings before filing");
  const pos = d.stateCode;
  const itm = (num: number, r: { rate: number; txval: Paise; camt: Paise; samt: Paise; iamt: Paise }) => ({
    num,
    itm_det: r.iamt ? { txval: rs(r.txval), rt: Number(r.rate), iamt: rs(r.iamt), csamt: 0 }
                    : { txval: rs(r.txval), rt: Number(r.rate), camt: rs(r.camt), samt: rs(r.samt), csamt: 0 },
  });

  const byCtin = <T extends { ctin: string; doc_no: string }>(rows: T[]) => {
    const m = new Map<string, Map<string, T[]>>();
    for (const r of rows) {
      const docs = m.get(r.ctin) ?? new Map<string, T[]>();
      docs.set(r.doc_no, [...(docs.get(r.doc_no) ?? []), r]);
      m.set(r.ctin, docs);
    }
    return m;
  };

  const b2b = [...byCtin(d.b2b)].map(([ctin, docs]) => ({
    ctin,
    inv: [...docs].map(([inum, rows]) => ({
      inum, idt: gstDate(rows[0]!.doc_date), val: rs(rows[0]!.doc_value), pos, rchrg: "N", inv_typ: "R",
      itms: rows.map((r, i) => itm(i + 1, r)),
    })),
  }));

  const cdnr = [...byCtin(d.cdnr)].map(([ctin, docs]) => ({
    ctin,
    nt: [...docs].map(([nt_num, rows]) => ({
      ntty: "C", nt_num, nt_dt: gstDate(rows[0]!.doc_date), val: rs(rows[0]!.doc_value), pos, rchrg: "N", inv_typ: "R",
      itms: rows.map((r, i) => itm(i + 1, r)),
    })),
  }));

  const b2cs = d.b2cs.map((r) => {
    if (r.txval < 0) warnings.push(`B2C ${r.rate}%: credit notes exceed sales this period (₹${rs(-r.txval)}); the portal may need this adjusted in a later period`);
    return r.iamt
      ? { sply_ty: "INTER", pos, typ: "OE", rt: Number(r.rate), txval: rs(r.txval), iamt: rs(r.iamt), csamt: 0 }
      : { sply_ty: "INTRA", pos, typ: "OE", rt: Number(r.rate), txval: rs(r.txval), camt: rs(r.camt), samt: rs(r.samt), csamt: 0 };
  });

  // HSN: re-aggregate after mapping unit → UQC (two unit labels can share one UQC)
  const hsnRows = (b2bFlag: boolean) => {
    const m = new Map<string, { hsn: string; uqc: string; rate: number; qty: number; txval: Paise; camt: Paise; samt: Paise; iamt: Paise }>();
    for (const r of d.hsn.filter((h) => h.b2b === b2bFlag)) {
      const uqc = uqcFor(r.unit);
      const k = `${r.hsn}|${uqc}|${r.rate}`;
      const x = m.get(k) ?? { hsn: r.hsn, uqc, rate: Number(r.rate), qty: 0, txval: 0, camt: 0, samt: 0, iamt: 0 };
      x.qty += Number(r.qty); x.txval += r.txval; x.camt += r.camt; x.samt += r.samt; x.iamt += r.iamt;
      m.set(k, x);
    }
    return [...m.values()].filter((x) => x.qty !== 0 || x.txval !== 0).map((x, i) => ({
      num: i + 1, hsn_sc: x.hsn, desc: "", uqc: x.uqc, qty: x.qty, rt: x.rate,
      txval: rs(x.txval), iamt: rs(x.iamt), camt: rs(x.camt), samt: rs(x.samt), csamt: 0,
    }));
  };
  for (const h of d.hsn) if (h.hsn.length < 6) warnings.push(`HSN ${h.hsn} has fewer than 6 digits — required for turnover above ₹5 crore`);

  const docSet = (kind: "INV" | "CN") => d.docs.filter((x) => x.kind === kind).map((x, i) => ({
    num: i + 1, from: x.first_no, to: x.last_no, totnum: Number(x.total), cancel: Number(x.cancelled), net_issue: Number(x.total) - Number(x.cancelled),
  }));
  const docDet = [
    { doc_num: 1, doc_typ: "Invoices for outward supply", docs: docSet("INV") },
    { doc_num: 5, doc_typ: "Credit Note", docs: docSet("CN") },
  ].filter((x) => x.docs.length);

  const nil = [
    { sply_ty: "INTRAB2B", nil_amt: rs(d.nil.b2b), expt_amt: 0, ngsup_amt: 0 },
    { sply_ty: "INTRAB2C", nil_amt: rs(d.nil.b2c), expt_amt: 0, ngsup_amt: 0 },
  ].filter((x) => x.nil_amt !== 0);

  return {
    json: {
      gstin: d.gstin ?? "", fp,
      b2b, b2cs, cdnr,
      nil: { inv: nil },
      hsn: { hsn_b2b: hsnRows(true), hsn_b2c: hsnRows(false) },
      doc_issue: { doc_det: docDet },
    },
    warnings: [...new Set(warnings)],
  };
}

/**
 * Pay GST liability from input tax credit in the legal order (s.49 / rule 88A):
 * IGST credit first (IGST, then CGST, then SGST); then CGST credit (CGST, then IGST); SGST credit (SGST, then IGST).
 * CGST credit can never pay SGST and vice versa. Whatever is left of the liability is paid in cash.
 */
export function setOffGst(liability: TaxHeads, credit: TaxHeads) {
  const out = { iamt: Math.max(0, liability.iamt), camt: Math.max(0, liability.camt), samt: Math.max(0, liability.samt) };
  const cr = { iamt: Math.max(0, credit.iamt), camt: Math.max(0, credit.camt), samt: Math.max(0, credit.samt) };
  const used: Array<{ from: keyof TaxHeads; to: keyof TaxHeads; amount: Paise }> = [];
  const use = (from: keyof TaxHeads, to: keyof TaxHeads) => {
    const a = Math.min(cr[from], out[to]);
    if (a > 0) { cr[from] -= a; out[to] -= a; used.push({ from, to, amount: a }); }
  };
  use("iamt", "iamt"); use("iamt", "camt"); use("iamt", "samt");
  use("camt", "camt"); use("camt", "iamt");
  use("samt", "samt"); use("samt", "iamt");
  return { used, cashPayable: out, creditCarriedForward: cr, totalCash: out.iamt + out.camt + out.samt };
}
