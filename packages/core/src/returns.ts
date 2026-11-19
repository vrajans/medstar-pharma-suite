import { roundHalfUp, type Paise } from "./money";
import { computeLine } from "./gst";

/**
 * Sales-return (credit note) maths for one original bill line — mirrors post_sales_return in SQL.
 * Partial returns are pro-rated; the return that brings the line to zero takes the exact remainder,
 * so a fully returned line always reverses the original paise for paise.
 */
export interface OriginalLine {
  qtyBase: number;
  amountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  costPaise: Paise;
  gstRate: number;
  hsn: string;
}

export interface ReturnedSoFar { qtyBase: number; amountPaise: Paise; taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; costPaise: Paise }

export const NOTHING_RETURNED: ReturnedSoFar = { qtyBase: 0, amountPaise: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, costPaise: 0 };

export function computeReturnLine(orig: OriginalLine, already: ReturnedSoFar, qtyBase: number, opts: { composition?: boolean } = {}) {
  const remaining = orig.qtyBase - already.qtyBase;
  if (!Number.isInteger(qtyBase) || qtyBase <= 0) throw new Error("Return quantity must be a whole number above zero");
  if (qtyBase > remaining) throw new Error(`Only ${remaining} unit(s) left to return on this line`);
  if (qtyBase === remaining) {
    return {
      amountPaise: orig.amountPaise - already.amountPaise,
      taxablePaise: orig.taxablePaise - already.taxablePaise,
      cgstPaise: orig.cgstPaise - already.cgstPaise,
      sgstPaise: orig.sgstPaise - already.sgstPaise,
      igstPaise: orig.igstPaise - already.igstPaise,
      costPaise: orig.costPaise - already.costPaise,
      final: true,
    };
  }
  const amountPaise = roundHalfUp((orig.amountPaise * qtyBase) / orig.qtyBase);
  const t = computeLine({ packMrpPaise: amountPaise, unitsPerPack: 1, qtyBase: 1, gstRate: orig.gstRate, hsn: orig.hsn }, { scheme: opts.composition ? "composition" : "regular" });
  return {
    amountPaise, taxablePaise: t.taxablePaise, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise,
    costPaise: roundHalfUp((orig.costPaise * qtyBase) / orig.qtyBase), final: false,
  };
}

/** Credit-note total rounded to the rupee, like the bill itself. */
export function creditNoteTotal(lineAmounts: Paise[]) {
  const exact = lineAmounts.reduce((s, a) => s + a, 0);
  const totalPaise = roundHalfUp(exact / 100) * 100;
  return { exactPaise: exact, roundOffPaise: totalPaise - exact, totalPaise };
}
