import type { Paise } from "./money";
import type { LedgerGroup } from "./accounting";

/** Shape returned by tally_export() (amounts in paise). */
export interface TallyEntry {
  id: string;
  date: string;
  source: string;
  narration: string | null;
  docNo: string | null;
  voucherKind?: string | null;
  lines: Array<{ ledger: string; grp: LedgerGroup | null; code: string; party: boolean; debit: Paise; credit: Paise }>;
}

/**
 * Tally group for each MedStar ledger group. Stock in trade goes under Current Assets (not Stock-in-Hand) so the file imports into
 * an accounts-only company ("Integrate accounts with inventory" = No) — item-level stock stays in MedStar.
 */
export const TALLY_PARENT: Record<LedgerGroup, string> = {
  cash: "Cash-in-Hand", bank: "Bank Accounts", debtors: "Sundry Debtors", stock: "Current Assets", tax_input: "Duties & Taxes",
  current_asset: "Current Assets", fixed_asset: "Fixed Assets", creditors: "Sundry Creditors", tax_output: "Duties & Taxes",
  loan: "Loans (Liability)", current_liability: "Current Liabilities", capital: "Capital Account", sales: "Sales Accounts",
  indirect_inc: "Indirect Incomes", direct_exp: "Direct Expenses", indirect_exp: "Indirect Expenses",
};

export function tallyVoucherType(e: Pick<TallyEntry, "source" | "voucherKind" | "lines">): string {
  switch (e.source) {
    case "sale": return "Sales";
    case "sale_return": return "Credit Note";
    case "purchase": return "Purchase";
    case "purchase_return": return "Debit Note";
    case "receipt": return "Receipt";
    case "supplier_payment": return "Payment";
    case "voucher":
      switch (e.voucherKind) {
        case "payment": return "Payment";
        case "receipt": return "Receipt";
        case "contra": return "Contra";
        case "expense": return e.lines.some((l) => l.credit > 0 && (l.grp === "cash" || l.grp === "bank")) ? "Payment" : "Journal";
        default: return "Journal";
      }
    default: return "Journal";
  }
}

const x = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const amt = (p: Paise) => (p / 100).toFixed(2);

const envelope = (company: string, report: "All Masters" | "Vouchers", body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n <BODY>\n  <IMPORTDATA>\n` +
  `   <REQUESTDESC><REPORTNAME>${report}</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${x(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>\n` +
  `   <REQUESTDATA>\n${body}   </REQUESTDATA>\n  </IMPORTDATA>\n </BODY>\n</ENVELOPE>\n`;

/** Ledger masters for every ledger used in the entries (import this file first). */
export function buildTallyMastersXml(company: string, entries: TallyEntry[]): string {
  const ledgers = new Map<string, string>();
  for (const e of entries) for (const l of e.lines) {
    const parent = l.party ? (l.code === "CREDITORS" ? "Sundry Creditors" : "Sundry Debtors") : (l.grp ? TALLY_PARENT[l.grp] : "Suspense A/c");
    if (!ledgers.has(l.ledger)) ledgers.set(l.ledger, parent);
  }
  const body = [...ledgers].sort(([a], [b]) => a.localeCompare(b)).map(([name, parent]) =>
    `    <TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${x(name)}" ACTION="Create"><NAME.LIST><NAME>${x(name)}</NAME></NAME.LIST>` +
    `<PARENT>${x(parent)}</PARENT><ISBILLWISEON>No</ISBILLWISEON></LEDGER></TALLYMESSAGE>\n`).join("");
  return envelope(company, "All Masters", body);
}

/** Accounting vouchers (debit = ISDEEMEDPOSITIVE Yes with a negative amount, Tally's convention). */
export function buildTallyVouchersXml(company: string, entries: TallyEntry[]): string {
  const body = entries.map((e) => {
    const type = tallyVoucherType(e);
    const lines = e.lines.filter((l) => l.debit || l.credit).map((l) => l.debit > 0
      ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${x(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amt(l.debit)}</AMOUNT></ALLLEDGERENTRIES.LIST>`
      : `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${x(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amt(l.credit)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join("");
    return `    <TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${x(type)}" ACTION="Create">` +
      `<DATE>${e.date.replace(/-/g, "")}</DATE><GUID>medstar-${x(e.id)}</GUID><VOUCHERTYPENAME>${x(type)}</VOUCHERTYPENAME>` +
      `<VOUCHERNUMBER>${x(e.docNo ?? "")}</VOUCHERNUMBER><NARRATION>${x(e.narration)}</NARRATION>${lines}</VOUCHER></TALLYMESSAGE>\n`;
  }).join("");
  return envelope(company, "Vouchers", body);
}
