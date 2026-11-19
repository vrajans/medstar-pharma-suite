import { Fragment } from "react";
import { formatDateIN, formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { AccountsNav, RangeForm, readRange, SOURCE_LABEL } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";

export const metadata = { title: "Day book · MedStar" };

interface Entry {
  id: string; entry_date: string; source_type: string; narration: string | null; created_at: string;
  journal_lines: Array<{ debit_paise: number; credit_paise: number; accounts: { name: string } | null }>;
}

export default async function DayBookPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; scope?: string; source?: string }> }) {
  const ctx = await requireArea("/accounts");
  const sp = await searchParams;
  const { from, to } = readRange({ from: sp.from ?? sp.to, to: sp.to });
  const scope = sp.scope === "store" ? "store" : "org";
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Day book" /><AccountsNav active="/accounts/daybook" /><LiveOnly what="Day book" /></div>;
  const sb = await supabaseServer();
  let q = sb.from("journal_entries").select("id, entry_date, source_type, narration, created_at, journal_lines(debit_paise, credit_paise, accounts(name))")
    .eq("org_id", ctx.org.orgId).gte("entry_date", from).lte("entry_date", to).order("entry_date").order("created_at").limit(2000);
  if (scope === "store") q = q.eq("store_id", ctx.store.id);
  if (sp.source) q = q.eq("source_type", sp.source);
  const { data, error } = await q;
  const entries = (data ?? []) as unknown as Entry[];
  const total = entries.reduce((s, e) => s + e.journal_lines.reduce((t, l) => t + Number(l.debit_paise), 0), 0);
  const exportRows = entries.flatMap((e) => e.journal_lines.map((l, i) => ({
    date: i ? "" : formatDateIN(e.entry_date), type: i ? "" : SOURCE_LABEL[e.source_type] ?? e.source_type, particulars: l.accounts?.name ?? "",
    debit: Number(l.debit_paise) ? Number(l.debit_paise) / 100 : null, credit: Number(l.credit_paise) ? Number(l.credit_paise) / 100 : null, narration: i ? "" : e.narration ?? "",
  })));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Day book" sub="Every journal entry in date order — sales, returns, purchases, payments, vouchers, shift closes">
        <ExportButtons title={`Day book ${formatDateIN(from)} to ${formatDateIN(to)}`} rows={exportRows} footer="" />
      </PageHeader>
      <AccountsNav active="/accounts/daybook" />
      <RangeForm from={from} to={to} scope={scope}>
        <label className="flex flex-col">Type
          <select name="source" defaultValue={sp.source ?? ""} className="rounded border border-line bg-surface px-2 py-1.5">
            <option value="">All</option>{Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
      </RangeForm>
      {error && <p className="text-danger">{error.message}</p>}
      <p className="mb-2 text-sm text-muted">{entries.length} entries{entries.length === 2000 && " (first 2,000 — narrow the dates)"} · total debits {formatINR(total)}</p>
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Date</th><th className={thCls}>Type</th><th className={thCls}>Particulars</th>
            <th className={`${thCls} text-right`}>Debit</th><th className={`${thCls} px-3 text-right`}>Credit</th></tr></thead>
          <tbody>{entries.map((e) => (
            <Fragment key={e.id}>{e.journal_lines.map((l, i) => (
              <tr key={e.id + i} className={i === 0 ? "border-t border-line" : ""}>
                <td className="px-3 py-0.5">{i === 0 && formatDateIN(e.entry_date)}</td>
                <td>{i === 0 && (SOURCE_LABEL[e.source_type] ?? e.source_type)}</td>
                <td className={Number(l.credit_paise) ? "pl-6" : ""}>{Number(l.credit_paise) ? "To " : ""}{l.accounts?.name}</td>
                <td className="num text-right">{Number(l.debit_paise) ? formatINR(Number(l.debit_paise)) : ""}</td>
                <td className="num px-3 text-right">{Number(l.credit_paise) ? formatINR(Number(l.credit_paise)) : ""}</td>
              </tr>))}
              <tr><td /><td /><td colSpan={3} className="pb-1.5 text-xs italic text-muted">{e.narration}</td></tr>
            </Fragment>))}
          {!entries.length && <tr><td colSpan={5} className="p-6 text-center text-muted">Nothing posted on these dates.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
