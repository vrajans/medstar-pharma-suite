import { Fragment } from "react";
import { formatDateIN, formatINR, GROUP_LABEL, type LedgerGroup } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader } from "@/components/ui";
import { AccountsNav, RangeForm, istToday } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";

export const metadata = { title: "Balance sheet · MedStar" };

interface Item { code: string; name: string; grp: LedgerGroup | null; amount: number }
interface BS { assets: Item[]; liabilities: Item[]; equity: Item[]; profitCurrentYear: number; profitEarlierYears: number; totalAssets: number; totalLiabilitiesEquity: number }

function Side({ title, groups, extra, total }: { title: string; groups: Item[]; extra?: Array<[string, number]>; total: number }) {
  const byGrp = new Map<string, Item[]>();
  for (const i of groups) byGrp.set(i.grp ?? "other", [...(byGrp.get(i.grp ?? "other") ?? []), i]);
  return (
    <div className="rounded-lg border border-line bg-surface">
      <h2 className="border-b border-line px-3 py-2 font-semibold">{title}</h2>
      <table className="w-full text-sm"><tbody>
        {[...byGrp].map(([g, items]) => (
          <Fragment key={g}>
            <tr className="bg-canvas/50"><td className="px-3 py-1 text-xs font-medium uppercase text-muted">{GROUP_LABEL[g as LedgerGroup] ?? g}</td>
              <td className="num px-3 text-right text-muted">{formatINR(items.reduce((s, i) => s + Number(i.amount), 0))}</td></tr>
            {items.map((i) => <tr key={i.code}><td className="px-3 py-0.5 pl-6">{i.name}</td><td className={`num px-3 text-right ${Number(i.amount) < 0 ? "text-danger" : ""}`}>{formatINR(Number(i.amount))}</td></tr>)}
          </Fragment>))}
        {extra?.filter(([, v]) => v).map(([label, v]) => <tr key={label}><td className="px-3 py-1">{label}</td><td className={`num px-3 text-right ${v < 0 ? "text-danger" : ""}`}>{formatINR(v)}</td></tr>)}
      </tbody>
      <tfoot className="border-t-2 border-line font-semibold"><tr><td className="px-3 py-2">Total</td><td className="num px-3 text-right">{formatINR(total)}</td></tr></tfoot></table>
    </div>
  );
}

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ to?: string; scope?: string }> }) {
  const ctx = await requireArea("/accounts");
  const sp = await searchParams;
  const asOf = sp.to ?? istToday();
  const scope = sp.scope === "store" ? "store" : "org";
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Balance sheet" /><AccountsNav active="/accounts/balance-sheet" /><LiveOnly what="Balance sheet" /></div>;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("balance_sheet", { p_org: ctx.org.orgId, p_as_of: asOf, p_store: scope === "store" ? ctx.store.id : null });
  const bs = data as BS | null;
  const exportRows = bs ? [
    ...[...bs.liabilities, ...bs.equity].map((i) => ({ side: "Liabilities & capital", group: GROUP_LABEL[i.grp as LedgerGroup] ?? "", ledger: i.name, amount: Number(i.amount) / 100 })),
    { side: "Liabilities & capital", group: "", ledger: "Profit — this year", amount: bs.profitCurrentYear / 100 },
    { side: "Liabilities & capital", group: "", ledger: "Profit — earlier years", amount: bs.profitEarlierYears / 100 },
    ...bs.assets.map((i) => ({ side: "Assets", group: GROUP_LABEL[i.grp as LedgerGroup] ?? "", ledger: i.name, amount: Number(i.amount) / 100 })),
  ] : [];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Balance sheet" sub={`As on ${formatDateIN(asOf)} · stock at cost from batches`}>
        <ExportButtons title={`Balance sheet as on ${formatDateIN(asOf)}`} rows={exportRows} footer="" />
      </PageHeader>
      <AccountsNav active="/accounts/balance-sheet" />
      <RangeForm from={asOf} to={asOf} scope={scope} single />
      {error && <p className="text-danger">{error.message}</p>}
      {bs && (
        <>
          <p className={`mb-3 text-sm ${bs.totalAssets === bs.totalLiabilitiesEquity ? "text-ok" : "text-danger"}`}>
            {bs.totalAssets === bs.totalLiabilitiesEquity ? "✓ Assets equal liabilities + capital" : `Out by ${formatINR(bs.totalAssets - bs.totalLiabilitiesEquity)} — contact support`}</p>
          <div className="grid grid-cols-2 gap-6">
            <Side title="Liabilities & capital" groups={[...bs.equity, ...bs.liabilities]} total={bs.totalLiabilitiesEquity}
              extra={[["Profit & loss — this financial year", bs.profitCurrentYear], ["Profit & loss — earlier years", bs.profitEarlierYears]]} />
            <Side title="Assets" groups={bs.assets} total={bs.totalAssets} />
          </div>
        </>
      )}
    </div>
  );
}
