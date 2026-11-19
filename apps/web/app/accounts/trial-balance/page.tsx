import Link from "next/link";
import { formatDateIN, formatINR, fyStart, GROUP_LABEL, type LedgerGroup } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { AccountsNav, Bal, RangeForm, istToday } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";

export const metadata = { title: "Trial balance · MedStar" };

interface Row { id: string | null; code: string; name: string; type: string; grp: LedgerGroup | null; opening: number; debit: number; credit: number; closing: number }

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; scope?: string }> }) {
  const ctx = await requireArea("/accounts");
  const sp = await searchParams;
  const to = sp.to ?? istToday();
  const from = sp.from ?? fyStart(to);
  const scope = sp.scope === "store" ? "store" : "org";
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Trial balance" /><AccountsNav active="/accounts/trial-balance" /><LiveOnly what="Trial balance" /></div>;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("trial_balance", { p_org: ctx.org.orgId, p_from: from, p_to: to, p_store: scope === "store" ? ctx.store.id : null });
  const rows = (data ?? []) as Row[];
  const sum = (k: "opening" | "debit" | "credit" | "closing") => rows.reduce((s, r) => s + Number(r[k]), 0);
  const drTotal = rows.reduce((s, r) => s + Math.max(0, Number(r.closing)), 0);
  const crTotal = rows.reduce((s, r) => s + Math.max(0, -Number(r.closing)), 0);
  const balanced = sum("closing") === 0;
  const exportRows = rows.map((r) => ({ ledger: r.name, group: r.grp ? GROUP_LABEL[r.grp] : "", opening: Number(r.opening) / 100, debit: Number(r.debit) / 100,
    credit: Number(r.credit) / 100, closing_dr: Number(r.closing) > 0 ? Number(r.closing) / 100 : null, closing_cr: Number(r.closing) < 0 ? -Number(r.closing) / 100 : null }));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Trial balance" sub="Income and expense ledgers start afresh every 1 April; earlier years' profit is carried as one line">
        <ExportButtons title={`Trial balance ${formatDateIN(from)} to ${formatDateIN(to)}`} rows={exportRows} footer="" />
      </PageHeader>
      <AccountsNav active="/accounts/trial-balance" />
      <RangeForm from={from} to={to} scope={scope} />
      {error && <p className="text-danger">{error.message}</p>}
      <p className={`mb-2 text-sm ${balanced ? "text-ok" : "text-danger"}`}>{balanced ? "✓ Debits equal credits" : "Debits and credits differ — contact support"}</p>
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Ledger</th><th className={thCls}>Group</th><th className={`${thCls} text-right`}>Opening</th>
            <th className={`${thCls} text-right`}>Debit</th><th className={`${thCls} text-right`}>Credit</th><th className={`${thCls} px-3 text-right`}>Closing</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.code} className="border-t border-line">
              <td className="px-3 py-1">{r.id ? <Link className="hover:underline" href={`/accounts/ledger?account=${r.id}&from=${from}&to=${to}&scope=${scope}`}>{r.name}</Link> : r.name}</td>
              <td className="text-muted">{r.grp ? GROUP_LABEL[r.grp] : ""}</td>
              <td className="text-right"><Bal paise={r.opening} /></td><td className="num text-right">{Number(r.debit) ? formatINR(Number(r.debit)) : ""}</td>
              <td className="num text-right">{Number(r.credit) ? formatINR(Number(r.credit)) : ""}</td><td className="px-3 text-right"><Bal paise={r.closing} /></td>
            </tr>))}</tbody>
          <tfoot className="border-t-2 border-line font-semibold"><tr>
            <td className="px-3 py-2">Total</td><td /><td /><td className="num text-right">{formatINR(sum("debit"))}</td><td className="num text-right">{formatINR(sum("credit"))}</td>
            <td className="num px-3 text-right">Dr {formatINR(drTotal)} / Cr {formatINR(crTotal)}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}
