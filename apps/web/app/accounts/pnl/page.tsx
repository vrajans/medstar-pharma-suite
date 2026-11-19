import Link from "next/link";
import { formatDateIN, formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { AccountsNav, RangeForm, readRange } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";

export const metadata = { title: "Profit & loss · MedStar" };

interface Line { code: string; name: string; grp: string; amount: number }
interface PL { trading: Line[]; otherIncome: Line[]; expenses: Line[]; netSales: number; directCosts: number; grossProfit: number; otherIncomeTotal: number; expensesTotal: number; netProfit: number }
interface Margin { rows: Array<{ label: string; qty: number; sales: number; cost: number; margin: number; marginPct: number | null }>; sales: number; cost: number }

export default async function PnlPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; scope?: string; by?: string }> }) {
  const ctx = await requireArea("/accounts");
  const sp = await searchParams;
  const { from, to } = readRange(sp);
  const scope = sp.scope === "store" ? "store" : "org";
  const by = ["product", "category", "manufacturer"].includes(sp.by ?? "") ? sp.by! : "category";
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Profit & loss" /><AccountsNav active="/accounts/pnl" /><LiveOnly what="Profit & loss" /></div>;
  const sb = await supabaseServer();
  const [plR, mR] = await Promise.all([
    sb.rpc("profit_and_loss", { p_org: ctx.org.orgId, p_from: from, p_to: to, p_store: scope === "store" ? ctx.store.id : null }),
    sb.rpc("margin_report", { p_store: ctx.store.id, p_from: from, p_to: to, p_by: by }),
  ]);
  const pl = plR.data as PL | null;
  const m = mR.data as Margin | null;
  const pct = (a: number, b: number) => (b ? `${((a * 100) / b).toFixed(1)}%` : "—");
  const Section = ({ title, lines, sign = 1 }: { title: string; lines: Line[]; sign?: 1 | -1 }) => (
    <>
      <tr className="border-t border-line bg-canvas/50"><td colSpan={2} className="px-3 py-1 text-xs font-medium uppercase text-muted">{title}</td></tr>
      {lines.map((l) => (
        <tr key={l.code}><td className="px-3 py-0.5 pl-6"><Link className="hover:underline" href={`/accounts/ledger?code=${l.code}&from=${from}&to=${to}`}>{l.name}</Link></td>
          <td className="num px-3 text-right">{formatINR(sign * Number(l.amount))}</td></tr>))}
    </>
  );
  const exportRows = pl ? [
    ...pl.trading.map((l) => ({ section: l.grp === "sales" ? "Sales" : "Direct costs", ledger: l.name, amount: Number(l.amount) / 100 })),
    { section: "", ledger: "Gross profit", amount: pl.grossProfit / 100 },
    ...pl.otherIncome.map((l) => ({ section: "Other income", ledger: l.name, amount: Number(l.amount) / 100 })),
    ...pl.expenses.map((l) => ({ section: "Expenses", ledger: l.name, amount: Number(l.amount) / 100 })),
    { section: "", ledger: "Net profit", amount: pl.netProfit / 100 },
  ] : [];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Profit & loss" sub={`${formatDateIN(from)} to ${formatDateIN(to)}`}>
        <ExportButtons title={`Profit & loss ${formatDateIN(from)} to ${formatDateIN(to)}`} rows={exportRows} footer="" />
      </PageHeader>
      <AccountsNav active="/accounts/pnl" />
      <RangeForm from={from} to={to} scope={scope} extra={{ by }} />
      {(plR.error || mR.error) && <p className="text-danger">{plR.error?.message ?? mR.error?.message}</p>}
      {pl && (
        <div className="grid grid-cols-2 gap-6">
          <div className="overflow-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm"><tbody>
              <Section title="Sales (net of returns)" lines={pl.trading.filter((l) => l.grp === "sales")} />
              <Section title="Direct costs" lines={pl.trading.filter((l) => l.grp === "direct_exp")} />
              <tr className="border-t border-line font-semibold"><td className="px-3 py-1.5">Gross profit <span className="font-normal text-muted">({pct(pl.grossProfit, pl.netSales)} of sales)</span></td><td className="num px-3 text-right">{formatINR(pl.grossProfit)}</td></tr>
              <Section title="Other income" lines={pl.otherIncome} />
              <Section title="Expenses" lines={pl.expenses} />
              <tr className="border-t-2 border-line text-base font-semibold"><td className="px-3 py-2">Net {pl.netProfit < 0 ? "loss" : "profit"}</td>
                <td className={`num px-3 text-right ${pl.netProfit < 0 ? "text-danger" : "text-ok"}`}>{formatINR(pl.netProfit)}</td></tr>
            </tbody></table>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Gross margin · {ctx.store.code}</h2>
              <div className="flex gap-1 text-sm">{["category", "manufacturer", "product"].map((b) => (
                <Link key={b} href={`/accounts/pnl?from=${from}&to=${to}&scope=${scope}&by=${b}`} className={`rounded px-2 py-0.5 ${by === b ? "bg-brand-700 text-white" : "border border-line"}`}>{b}</Link>))}</div>
            </div>
            <p className="mb-2 text-xs text-muted">From bills and credit notes at cost of the batch sold (FEFO). Sales are before GST.</p>
            <div className="max-h-[560px] overflow-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-canvas"><tr><th className={`${thCls} px-3`}>{by}</th><th className={`${thCls} text-right`}>Sales</th><th className={`${thCls} text-right`}>Cost</th><th className={`${thCls} px-3 text-right`}>Margin</th></tr></thead>
                <tbody>{(m?.rows ?? []).map((r) => (
                  <tr key={r.label} className="border-t border-line"><td className="px-3 py-0.5">{r.label}</td><td className="num text-right">{formatINR(r.sales)}</td>
                    <td className="num text-right">{formatINR(r.cost)}</td><td className={`num px-3 text-right ${r.margin < 0 ? "text-danger" : ""}`}>{formatINR(r.margin)} <span className="text-xs text-muted">{r.marginPct ?? "—"}%</span></td></tr>))}
                {!m?.rows.length && <tr><td colSpan={4} className="p-6 text-center text-muted">No sales in this period.</td></tr>}</tbody>
                {m && m.rows.length > 0 && <tfoot className="border-t-2 border-line font-semibold"><tr><td className="px-3 py-1">Total</td><td className="num text-right">{formatINR(m.sales)}</td>
                  <td className="num text-right">{formatINR(m.cost)}</td><td className="num px-3 text-right">{formatINR(m.sales - m.cost)} <span className="text-xs">{pct(m.sales - m.cost, m.sales)}</span></td></tr></tfoot>}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
