import { type Paise, roundHalfUp } from "./money";

export type GstScheme = "regular" | "composition";
export type SupplyType = "intra" | "inter";

export interface LineInput {
  /** MRP for one pack (selling unit of the price, e.g. one strip), GST inclusive, in paise */
  packMrpPaise: Paise;
  /** number of base units in one pack (e.g. 15 tablets per strip) */
  unitsPerPack: number;
  /** quantity sold in base units */
  qtyBase: number;
  /** optional selling price per pack (must be <= MRP); defaults to MRP */
  packPricePaise?: Paise;
  /** line discount percent, 0..100 */
  discountPct?: number;
  /** GST rate in percent, e.g. 5, 0, 18 */
  gstRate: number;
  hsn: string;
}

export interface LineTax {
  grossPaise: Paise; // MRP value before discount
  amountPaise: Paise; // value charged incl. tax
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  gstRate: number;
  hsn: string;
}

export class BillingRuleError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "BillingRuleError";
  }
}

/**
 * MRP-inclusive GST back-calculation for one bill line.
 * taxable = amount * 100 / (100 + rate), rounded per line to paise.
 * Odd paisa of the CGST/SGST split always goes to SGST.
 */
export function computeLine(
  input: LineInput,
  opts: { scheme?: GstScheme; supply?: SupplyType } = {},
): LineTax {
  const { packMrpPaise, unitsPerPack, qtyBase, gstRate, hsn } = input;
  const scheme = opts.scheme ?? "regular";
  const supply = opts.supply ?? "intra";
  const discountPct = input.discountPct ?? 0;
  const packPrice = input.packPricePaise ?? packMrpPaise;

  if (unitsPerPack <= 0) throw new BillingRuleError("UNITS", "unitsPerPack must be > 0");
  if (qtyBase === 0) throw new BillingRuleError("QTY", "Quantity must not be zero");
  if (packPrice > packMrpPaise)
    throw new BillingRuleError("ABOVE_MRP", "Selling price cannot exceed MRP");
  if (discountPct < 0 || discountPct > 100)
    throw new BillingRuleError("DISCOUNT", "Discount must be between 0 and 100%");
  if (gstRate < 0) throw new BillingRuleError("RATE", "GST rate cannot be negative");

  const grossPaise = roundHalfUp((packMrpPaise * qtyBase) / unitsPerPack);
  const priced = roundHalfUp((packPrice * qtyBase) / unitsPerPack);
  const amountPaise = roundHalfUp(priced * (1 - discountPct / 100));
  const discountPaise = grossPaise - amountPaise;

  if (scheme === "composition") {
    return {
      grossPaise, amountPaise, discountPaise,
      taxablePaise: amountPaise, cgstPaise: 0, sgstPaise: 0, igstPaise: 0,
      gstRate: 0, hsn,
    };
  }

  const rateBp = Math.round(gstRate * 100);
  const taxablePaise = roundHalfUp((amountPaise * 10000) / (10000 + rateBp));
  const tax = amountPaise - taxablePaise;
  let cgstPaise = 0, sgstPaise = 0, igstPaise = 0;
  if (supply === "inter") igstPaise = tax;
  else {
    cgstPaise = Math.trunc(tax / 2);
    sgstPaise = tax - cgstPaise;
  }
  return { grossPaise, amountPaise, discountPaise, taxablePaise, cgstPaise, sgstPaise, igstPaise, gstRate, hsn };
}

export interface BillTotals {
  lines: LineTax[];
  grossPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  subtotalPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  hsnSummary: Array<{ hsn: string; gstRate: number; taxablePaise: Paise; taxPaise: Paise }>;
  documentType: "TAX_INVOICE" | "BILL_OF_SUPPLY";
}

/** Bill-level discount is applied by distributing it to lines (so tax stays correct). */
export function computeBill(
  inputs: LineInput[],
  opts: { scheme?: GstScheme; supply?: SupplyType; billDiscountPct?: number; roundToRupee?: boolean } = {},
): BillTotals {
  const billDisc = opts.billDiscountPct ?? 0;
  const lines = inputs.map((l) => {
    const combined = 100 - (100 - (l.discountPct ?? 0)) * (1 - billDisc / 100);
    return computeLine({ ...l, discountPct: combined }, opts);
  });
  const sum = (k: keyof LineTax) => lines.reduce((a, l) => a + (l[k] as number), 0);
  const subtotalPaise = sum("amountPaise");
  const rounded = opts.roundToRupee === false ? subtotalPaise : roundHalfUp(subtotalPaise / 100) * 100;

  const map = new Map<string, { hsn: string; gstRate: number; taxablePaise: number; taxPaise: number }>();
  for (const l of lines) {
    const key = `${l.hsn}|${l.gstRate}`;
    const e = map.get(key) ?? { hsn: l.hsn, gstRate: l.gstRate, taxablePaise: 0, taxPaise: 0 };
    e.taxablePaise += l.taxablePaise;
    e.taxPaise += l.cgstPaise + l.sgstPaise + l.igstPaise;
    map.set(key, e);
  }

  return {
    lines,
    grossPaise: sum("grossPaise"),
    discountPaise: sum("discountPaise"),
    taxablePaise: sum("taxablePaise"),
    cgstPaise: sum("cgstPaise"),
    sgstPaise: sum("sgstPaise"),
    igstPaise: sum("igstPaise"),
    subtotalPaise,
    roundOffPaise: rounded - subtotalPaise,
    totalPaise: rounded,
    hsnSummary: [...map.values()],
    documentType: opts.scheme === "composition" ? "BILL_OF_SUPPLY" : "TAX_INVOICE",
  };
}

/** Resolve GST rate for an HSN on a date from effective-dated rows (longest prefix wins). */
export interface TaxRateRow { hsnPrefix: string; rate: number; effectiveFrom: string; effectiveTo?: string | null }
export function resolveGstRate(hsn: string, onDate: string, rows: TaxRateRow[]): number {
  const candidates = rows
    .filter((r) => hsn.startsWith(r.hsnPrefix) && r.effectiveFrom <= onDate && (!r.effectiveTo || onDate <= r.effectiveTo))
    .sort((a, b) => b.hsnPrefix.length - a.hsnPrefix.length || b.effectiveFrom.localeCompare(a.effectiveFrom));
  if (!candidates.length) throw new BillingRuleError("NO_RATE", `No GST rate configured for HSN ${hsn} on ${onDate}`);
  return candidates[0]!.rate;
}

/** GSTIN format + checksum validation. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function isValidGstin(gstin: string): boolean {
  const g = gstin.trim().toUpperCase();
  if (!GSTIN_RE.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(g[i]!);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  const check = CHARS[(36 - (sum % 36)) % 36];
  return check === g[14];
}
