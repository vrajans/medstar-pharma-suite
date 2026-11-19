import Link from "next/link";
import { formatDateIN, formatINR, GROUP_LABEL, type LedgerGroup } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { AccountsNav, Bal, RangeForm, readRange, SOURCE_LABEL } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";

export const metadata = { title: "Ledger · MedStar" };

interface Ledger {
  account: { id: string; code: string; name: string; type: string; grp: LedgerGroup | null };
  opening: number; debit: number; credit: number; closing: number; count: number;
  rows: Array<{ date: string; entryId: string; source: string; narration: string | null; against: string | null; debit: number; credit: number; balance: number }>;
}

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; scope?: string; code?: string; account?: string; party?: string }> }) {
  const ctx = await requireArea("/accounts");
  const sp = await searchParams;
  const { from, to } = readRange(sp);
  const scope = sp.scope === "store" ? "store" : "org";
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Ledger" /><AccountsNav active="/accounts/ledger" /><LiveOnly what="Ledgers" /></div>;
  const sb = await supabaseServer();
  const { data: accounts } = await sb.from("accounts").select("id, code, name, grp").eq("org_id", ctx.org.orgId).order("name");
  const all = accounts ?? [];
  const acc = all.find((a) => a.id === sp.account) ?? all.find((a) => a.code === (sp.code ?? "CASH"));
  const partyKind = acc?.code === "DEBTORS" ? "customers" : acc?.code === "CREDITORS" ? "distributors" : null;
  const parties = partyKind === "customers"
    ? ((await sb.from("customers").select("id, name, phone").eq("org_id", ctx.org.orgId).order("name").limit(3000)).data ?? []).map((c) => ({ id: c.id, label: `${c.name ?? "Customer"} · ${c.phone}` }))
    : partyKind === "distributors"
      ? ((await sb.from("distributors").select("id, name").eq("org_id", ctx.org.orgId).order("name")).data ?? []).map((d) => ({ id: d.id, label: d.name }))
      : [];
  const party = parties.find((p) => p.id === sp.party);
  const res = acc ? await sb.rpc("ledger_report", { p_account: acc.id, p_from: from, p_to: to, p_store: scope === "store" ? ctx.store.id : null, p_party: party?.id ?? null }) : null;
  const lg = res?.data as Ledger | null;
  const title = `${acc?.name ?? "Ledger"}${party ? ` — ${party.label}` : ""} · ${formatDateIN(from)} to ${formatDateIN(to)}`;
  const exportRows = lg ? [
    { date: formatDateIN(from), type: "", particulars: "Opening balance", debit: lg.opening > 0 ? lg.opening / 100 : null, credit: lg.opening < 0 ? -lg.opening / 100 : null, balance: lg.opening / 100 },
    ...lg.rows.map((r) => ({ date: formatDateIN(r.date), type: SOURCE_LABEL[r.source] ?? r.source, particulars: `${r.against ?? ""} — ${r.narration ?? ""}`,
      debit: r.debit ? r.debit / 100 : null, credit: r.credit ? r.credit / 100 : null, balance: r.balance / 100 })),
  ] : [];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Ledgers" sub="Cash book, bank book, party ledgers and any other ledger with running balance">
        <ExportButtons title={title} rows={exportRows} footer="" />
      </PageHeader>
      <AccountsNav active="/accounts/ledger" />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {[["CASH", "Cash book"], ["BANK", "Bank book"], ["UPI_CLR", "UPI clearing"], ["CARD_CLR", "Card clearing"], ["DEBTORS", "Customer ledger"], ["CREDITORS", "Supplier ledger"]].map(([c, l]) => (
          <Link key={c} href={`/accounts/ledger?code=${c}&from=${from}&to=${to}`} className={`rounded-full border px-3 py-1 ${acc?.code === c ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface"}`}>{l}</Link>))}
      </div>
      <RangeForm from={from} to={to} scope={scope}>
        <label className="flex flex-col">Ledger
          <select name="account" defaultValue={acc?.id} className="max-w-xs rounded border border-line bg-surface px-2 py-1.5">
            {all.map((a) => <option key={a.id} value={a.id}>{a.name}{a.grp ? ` (${GROUP_LABEL[a.grp as LedgerGroup]})` : ""}</option>)}
          </select></label>
        {partyKind && (
          <label className="flex flex-col">{partyKind === "customers" ? "Customer" : "Supplier"}
            <select name="party" defaultValue={party?.id ?? ""} className="max-w-xs rounded border border-line bg-surface px-2 py-1.5">
              <option value="">All</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select></label>)}
      </RangeForm>
      {res?.error && <p className="text-danger">{res.error.message}</p>}
      {lg && (
        <>
          <div className="mb-2 grid grid-cols-4 gap-3 text-sm">
            <div className="rounded border border-line bg-surface p-2"><div className="text-muted">Opening</div><Bal paise={lg.opening} /></div>
            <div className="rounded border border-line bg-surface p-2"><div className="text-muted">Debits</div><span className="num">{formatINR(lg.debit)}</span></div>
            <div className="rounded border border-line bg-surface p-2"><div className="text-muted">Credits</div><span className="num">{formatINR(lg.credit)}</span></div>
            <div className="rounded border border-line bg-surface p-2"><div className="text-muted">Closing</div><b><Bal paise={lg.closing} /></b></div>
          </div>
          <div className="overflow-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Date</th><th className={thCls}>Type</th><th className={thCls}>Particulars</th>
                <th className={`${thCls} text-right`}>Debit</th><th className={`${thCls} text-right`}>Credit</th><th className={`${thCls} px-3 text-right`}>Balance</th></tr></thead>
              <tbody>
                <tr className="border-t border-line bg-canvas/50"><td className="px-3 py-1">{formatDateIN(from)}</td><td /><td>Opening balance</td><td /><td /><td className="px-3 text-right"><Bal paise={lg.opening} /></td></tr>
                {lg.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="px-3 py-1">{formatDateIN(r.date)}</td><td>{SOURCE_LABEL[r.source] ?? r.source}</td>
                    <td>{r.against && <div>{r.against}</div>}<div className="text-xs text-muted">{r.narration}</div></td>
                    <td className="num text-right">{r.debit ? formatINR(r.debit) : ""}</td><td className="num text-right">{r.credit ? formatINR(r.credit) : ""}</td>
                    <td className="px-3 text-right"><Bal paise={r.balance} /></td>
                  </tr>))}
                {!lg.rows.length && <tr><td colSpan={6} className="p-6 text-center text-muted">No entries in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          {lg.count > lg.rows.length && <p className="mt-2 text-sm text-warn">Showing the first {lg.rows.length} of {lg.count} entries — narrow the dates.</p>}
        </>
      )}
    </div>
  );
}
