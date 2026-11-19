import { roundHalfUp, type Paise } from "./money";

/**
 * Purchase invoice maths (UC-PUR-04). Mirrors post_purchase in SQL exactly:
 *   taxable = round(PTR × qtyPacks × (1 − disc%)),  tax = round(taxable × rate%)
 * Free packs carry no value but add stock, so landed cost per unit = net / ((qty + free) × unitsPerPack).
 */
export interface PurchaseLineInput {
  packRatePaise: Paise; // PTR per pack, ex-GST
  packMrpPaise: Paise;
  qtyPacks: number;
  freePacks?: number;
  discountPct?: number;
  gstRate: number;
  unitsPerPack: number;
}

export interface PurchaseLineResult {
  taxablePaise: Paise;
  taxPaise: Paise;
  totalPaise: Paise;
  unitsReceived: number;
  /** landed cost per base unit in paise (ex-GST for regular dealers, incl. GST for composition) */
  costPerUnitPaise: number;
  /** margin on MRP after GST, % — what the counter actually earns */
  marginPct: number;
  warnings: string[];
}

export function computePurchaseLine(l: PurchaseLineInput, opts: { scheme?: "regular" | "composition" } = {}): PurchaseLineResult {
  const warnings: string[] = [];
  if (l.qtyPacks < 0 || (l.freePacks ?? 0) < 0) throw new Error("Quantities cannot be negative");
  if (l.packRatePaise > l.packMrpPaise) throw new Error("Purchase rate (PTR) is above MRP");
  const disc = l.discountPct ?? 0;
  const taxablePaise = roundHalfUp(l.packRatePaise * l.qtyPacks * (1 - disc / 100));
  const taxPaise = roundHalfUp((taxablePaise * l.gstRate) / 100);
  const unitsReceived = (l.qtyPacks + (l.freePacks ?? 0)) * l.unitsPerPack;
  const costBasis = taxablePaise + (opts.scheme === "composition" ? taxPaise : 0);
  const costPerUnitPaise = unitsReceived ? costBasis / unitsReceived : 0;
  const mrpExTaxPerUnit = l.packMrpPaise / l.unitsPerPack / (1 + l.gstRate / 100);
  const marginPct = mrpExTaxPerUnit ? ((mrpExTaxPerUnit - costPerUnitPaise) / mrpExTaxPerUnit) * 100 : 0;
  if (marginPct < 5) warnings.push(`Low margin (${marginPct.toFixed(1)}%)`);
  return { taxablePaise, taxPaise, totalPaise: taxablePaise + taxPaise, unitsReceived, costPerUnitPaise, marginPct, warnings };
}

export interface PurchaseTotals {
  taxablePaise: Paise;
  taxPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
}

export function computePurchaseTotals(lines: PurchaseLineResult[], interState: boolean): PurchaseTotals {
  const taxablePaise = lines.reduce((s, l) => s + l.taxablePaise, 0);
  const taxPaise = lines.reduce((s, l) => s + l.taxPaise, 0);
  const exact = taxablePaise + taxPaise;
  const totalPaise = roundHalfUp(exact / 100) * 100;
  const cgst = interState ? 0 : Math.trunc(taxPaise / 2);
  return {
    taxablePaise, taxPaise,
    cgstPaise: cgst, sgstPaise: interState ? 0 : taxPaise - cgst, igstPaise: interState ? taxPaise : 0,
    roundOffPaise: totalPaise - exact, totalPaise,
  };
}

/** Distributor invoice total vs our computation; more than ₹1 apart usually means a typo in a line. */
export function invoiceMismatch(computedPaise: Paise, supplierTotalPaise: Paise | null | undefined): Paise | null {
  if (supplierTotalPaise == null) return null;
  const diff = supplierTotalPaise - computedPaise;
  return Math.abs(diff) > 100 ? diff : null;
}
