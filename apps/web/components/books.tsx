import Link from "next/link";
import { drCr, formatINR } from "@medstar/core";

/** Business date in India. */
export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** from / to search params, defaulting to the current month to date. */
export function readRange(sp: { from?: string; to?: string }) {
  const to = sp.to && ISO.test(sp.to) ? sp.to : istToday();
  const from = sp.from && ISO.test(sp.from) ? sp.from : to.slice(0, 8) + "01";
  return { from: from <= to ? from : to, to };
}

/** ₹ amount with Dr / Cr suffix for a Dr−Cr balance. */
export function Bal({ paise }: { paise: number }) {
  const { amount, side } = drCr(Number(paise));
  return <span className="num whitespace-nowrap">{amount ? formatINR(amount) : "—"} <span className="text-xs text-muted">{side}</span></span>;
}

export const Amt = ({ paise, muted }: { paise: number; muted?: boolean }) =>
  <span className={`num whitespace-nowrap ${muted && !paise ? "text-muted" : ""} ${paise < 0 ? "text-danger" : ""}`}>{paise ? formatINR(Number(paise)) : "—"}</span>;

const SUB = [
  ["/accounts", "Overview"], ["/accounts/vouchers", "Vouchers"], ["/accounts/daybook", "Day book"], ["/accounts/ledger", "Ledgers"],
  ["/accounts/trial-balance", "Trial balance"], ["/accounts/pnl", "Profit & loss"], ["/accounts/balance-sheet", "Balance sheet"],
  ["/accounts/ledgers", "Chart of accounts"], ["/accounts/period-lock", "Period lock"], ["/accounts/tally", "Tally export"],
] as const;

export function AccountsNav({ active }: { active: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2 text-sm">
      {SUB.map(([href, label]) => (
        <Link key={href} href={href} className={`rounded px-2 py-1 ${active === href ? "bg-brand-700 text-white" : "text-muted hover:bg-canvas"}`}>{label}</Link>
      ))}
    </nav>
  );
}

const GST_SUB = [["/gst", "Overview"], ["/gst/gstr1", "GSTR-1"], ["/gst/gstr3b", "GSTR-3B"], ["/gst/composition", "CMP-08 / GSTR-4"], ["/gst/rates", "GST rates"]] as const;
export function GstNav({ active, composition }: { active: string; composition: boolean }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2 text-sm">
      {GST_SUB.filter(([href]) => composition ? !["/gst/gstr1", "/gst/gstr3b"].includes(href) : href !== "/gst/composition").map(([href, label]) => (
        <Link key={href} href={href} className={`rounded px-2 py-1 ${active === href ? "bg-brand-700 text-white" : "text-muted hover:bg-canvas"}`}>{label}</Link>
      ))}
    </nav>
  );
}

/** GET form with a date range, an "all stores / this store" switch and any extra fields. */
export function RangeForm({ from, to, scope, extra, children, single }: {
  from: string; to: string; scope?: string; extra?: Record<string, string | undefined>; children?: React.ReactNode; single?: boolean;
}) {
  return (
    <form className="mb-3 flex flex-wrap items-end gap-2 text-sm">
      {!single && <label className="flex flex-col">From<input type="date" name="from" defaultValue={from} className="rounded border border-line bg-surface px-2 py-1" /></label>}
      <label className="flex flex-col">{single ? "As on" : "To"}<input type="date" name="to" defaultValue={to} className="rounded border border-line bg-surface px-2 py-1" /></label>
      {scope !== undefined && (
        <label className="flex flex-col">Scope
          <select name="scope" defaultValue={scope} className="rounded border border-line bg-surface px-2 py-1.5">
            <option value="org">All stores</option><option value="store">This store only</option>
          </select>
        </label>)}
      {Object.entries(extra ?? {}).map(([k, v]) => v !== undefined && <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <button className="rounded border border-line bg-surface px-3 py-1.5">Show</button>
    </form>
  );
}

export const SOURCE_LABEL: Record<string, string> = {
  sale: "Sale", sale_return: "Credit note", sale_cancel: "Bill cancelled", purchase: "Purchase", purchase_return: "Debit note",
  receipt: "Receipt", supplier_payment: "Supplier payment", voucher: "Voucher", cash_movement: "Cash in/out", shift_close: "Shift close",
  opening_stock: "Opening stock", stock_adjust: "Stock adjustment",
};
