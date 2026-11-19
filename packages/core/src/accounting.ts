import { roundHalfUp, type Paise } from "./money";

/** Ledger groups (accounts.grp). The database derives the account type from the group. */
export type LedgerGroup =
  | "cash" | "bank" | "debtors" | "stock" | "tax_input" | "current_asset" | "fixed_asset"
  | "creditors" | "tax_output" | "loan" | "current_liability" | "capital"
  | "sales" | "indirect_inc" | "direct_exp" | "indirect_exp";

export const GROUP_LABEL: Record<LedgerGroup, string> = {
  cash: "Cash in hand", bank: "Bank & payment clearing", debtors: "Sundry debtors", stock: "Stock in trade",
  tax_input: "Input GST", current_asset: "Current assets", fixed_asset: "Fixed assets",
  creditors: "Sundry creditors", tax_output: "Output GST", loan: "Loans", current_liability: "Current liabilities",
  capital: "Capital", sales: "Sales", indirect_inc: "Other income", direct_exp: "Direct costs", indirect_exp: "Expenses",
};

/** Groups a user may create new ledgers in (parties come from customers / suppliers; stock is system-managed). */
export const CREATABLE_GROUPS: LedgerGroup[] = ["bank", "current_asset", "fixed_asset", "loan", "current_liability", "capital", "indirect_inc", "direct_exp", "indirect_exp"];

export type VoucherKind = "payment" | "receipt" | "contra" | "journal" | "expense";

export const VOUCHER_LABEL: Record<VoucherKind, string> = {
  payment: "Payment", receipt: "Receipt", contra: "Contra (cash ↔ bank)", journal: "Journal", expense: "Expense",
};

export interface VoucherLineInput {
  code: string;
  grp: LedgerGroup | null;
  name: string;
  debitPaise: Paise;
  creditPaise: Paise;
  partyId?: string | null;
}

/**
 * Same rules as post_voucher() in the database, so the form can explain a problem before submitting.
 * Returns a list of human-readable problems (empty = OK).
 */
export function validateVoucher(kind: VoucherKind, lines: VoucherLineInput[], opts: { composition?: boolean } = {}): string[] {
  const errs: string[] = [];
  const used = lines.filter((l) => l.debitPaise > 0 || l.creditPaise > 0);
  if (used.length < 2) errs.push("Add at least one debit and one credit line");
  let dr = 0, cr = 0;
  const isCB = (l: VoucherLineInput) => l.grp === "cash" || l.grp === "bank";
  for (const l of used) {
    if (l.debitPaise < 0 || l.creditPaise < 0 || (l.debitPaise > 0 && l.creditPaise > 0)) errs.push(`${l.name}: enter either a debit or a credit`);
    if (l.grp === "stock" || l.code === "COGS") errs.push(`${l.name} is posted automatically by purchases, sales and stock adjustments`);
    if (l.grp === "tax_input" && opts.composition) errs.push("Composition dealers cannot claim input tax credit");
    if ((l.code === "DEBTORS" || l.code === "CREDITORS") && !l.partyId) errs.push(`Choose the ${l.code === "DEBTORS" ? "customer" : "supplier"} for ${l.name}`);
    dr += l.debitPaise; cr += l.creditPaise;
  }
  if (dr !== cr) errs.push(`Debits (${dr / 100}) and credits (${cr / 100}) must be equal`);
  if (dr === 0 && used.length >= 2) errs.push("Amount must be more than zero");
  const debits = used.filter((l) => l.debitPaise > 0), credits = used.filter((l) => l.creditPaise > 0);
  switch (kind) {
    case "payment":
      if (!credits.length || credits.some((l) => !isCB(l)) || !debits.some((l) => !isCB(l))) errs.push("Payment: credit cash / bank and debit the ledger being paid");
      break;
    case "receipt":
      if (!debits.length || debits.some((l) => !isCB(l)) || !credits.some((l) => !isCB(l))) errs.push("Receipt: debit cash / bank and credit the ledger it came from");
      break;
    case "contra":
      if (credits.some((l) => !isCB(l)) || !debits.some(isCB) || debits.some((l) => !isCB(l) && l.grp !== "indirect_exp"))
        errs.push("Contra moves money between cash and bank accounts (bank charges may be debited)");
      break;
    case "expense": {
      const exp = debits.filter((l) => l.grp === "direct_exp" || l.grp === "indirect_exp" || l.grp === "fixed_asset");
      const other = debits.filter((l) => !exp.includes(l) && l.grp !== "tax_input");
      if (!exp.length || other.length) errs.push("Expense: debit an expense ledger (and input GST if claimable)");
      if (credits.some((l) => !(isCB(l) || l.grp === "creditors" || l.grp === "current_liability")))
        errs.push("An expense is paid from cash / bank or booked to a supplier / expenses payable");
      break;
    }
    case "journal":
      break;
  }
  return [...new Set(errs)];
}

/** GST on a purchase-type expense bill: tax on the taxable value, split CGST/SGST (floor/ceil, same as purchases) or IGST. */
export function expenseTax(taxablePaise: Paise, ratePct: number, interState: boolean) {
  const tax = roundHalfUp((taxablePaise * ratePct) / 100);
  const cgst = interState ? 0 : Math.floor(tax / 2);
  const sgst = interState ? 0 : tax - cgst;
  return { taxablePaise, cgstPaise: cgst, sgstPaise: sgst, igstPaise: interState ? tax : 0, totalPaise: taxablePaise + tax };
}

/** Dr/Cr display of a Dr−Cr balance. */
export function drCr(balancePaise: Paise): { amount: Paise; side: "Dr" | "Cr" | "" } {
  return { amount: Math.abs(balancePaise), side: balancePaise > 0 ? "Dr" : balancePaise < 0 ? "Cr" : "" };
}

/** Indian financial year start (1 April) for an ISO date. */
export function fyStart(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** First and last day of a month given 'YYYY-MM'. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** GST quarter (Apr–Jun = Q1) containing a date → range and label, for CMP-08. */
export function gstQuarter(isoDate: string): { from: string; to: string; label: string } {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  const fy = m >= 4 ? y : y - 1;
  const startMonth = [4, 7, 10, 1][q - 1]!;
  const year = q === 4 ? fy + 1 : fy;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const to = monthRange(`${year}-${String(startMonth + 2).padStart(2, "0")}`).to;
  return { from, to, label: `Q${q} FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}` };
}
