import Link from "next/link";
import { formatDateIN, formatINR, fyStart } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader } from "@/components/ui";
import { AccountsNav, Bal, istToday } from "@/components/books";

export const metadata = { title: "Accounts · MedStar" };

interface TbRow { code: string; name: string; grp: string | null; closing: number }

export default async function AccountsPage() {
  const ctx = await requireArea("/accounts");
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Accounts" /><AccountsNav active="/accounts" /><LiveOnly what="Accounting" /></div>;
  const sb = await supabaseServer();
  const today = istToday();
  const monthStart = today.slice(0, 8) + "01";
  const [tb, pl, lock, vch] = await Promise.all([
    sb.rpc("trial_balance", { p_org: ctx.org.orgId, p_from: fyStart(today), p_to: today }),
    sb.rpc("profit_and_loss", { p_org: ctx.org.orgId, p_from: monthStart, p_to: today }),
    sb.from("period_locks").select("locked_until").eq("org_id", ctx.org.orgId).maybeSingle(),
    sb.from("vouchers").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.orgId).gte("voucher_date", monthStart),
  ]);
  const rows = (tb.data ?? []) as TbRow[];
  const sum = (pred: (r: TbRow) => boolean) => rows.filter(pred).reduce((s, r) => s + Number(r.closing), 0);
  const p = (pl.data ?? {}) as { netSales?: number; grossProfit?: number; netProfit?: number; expensesTotal?: number };

  const tiles = [
    { label: "Cash in hand", value: <Bal paise={sum((r) => r.grp === "cash")} />, href: "/accounts/ledger?code=CASH" },
    { label: "Bank & UPI / card clearing", value: <Bal paise={sum((r) => r.grp === "bank")} />, href: "/accounts/ledger?code=BANK" },
    { label: "Customers owe you (udhaar)", value: <Bal paise={sum((r) => r.grp === "debtors")} />, href: "/customers" },
    { label: "You owe suppliers", value: <Bal paise={sum((r) => r.grp === "creditors")} />, href: "/purchase" },
    { label: "GST payable (output − input)", value: <Bal paise={sum((r) => r.grp === "tax_output" || r.grp === "tax_input")} />, href: "/gst" },
    { label: "Stock in trade (at cost)", value: <Bal paise={sum((r) => r.grp === "stock")} />, href: "/inventory" },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Accounts" sub={`${ctx.org.orgName} · books are kept automatically from every bill, return, purchase and payment`}>
        {["owner", "admin", "accountant"].includes(ctx.org.role) && <Link href="/accounts/vouchers/new" className="rounded-md bg-brand-700 px-3 py-1.5 text-sm text-white">New voucher</Link>}
      </PageHeader>
      <AccountsNav active="/accounts" />
      {(tb.error || pl.error) && <p className="mb-3 text-danger">{tb.error?.message ?? pl.error?.message}</p>}
      <div className="grid grid-cols-3 gap-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-lg border border-line bg-surface p-4 hover:border-brand-600">
            <div className="text-sm text-muted">{t.label}</div><div className="mt-1 text-2xl font-semibold">{t.value}</div>
          </Link>))}
      </div>
      <section className="mt-6 grid grid-cols-4 gap-4 rounded-lg border border-line bg-surface p-4 text-sm">
        <div><div className="text-muted">Net sales this month</div><div className="num text-lg font-semibold">{formatINR(p.netSales ?? 0)}</div></div>
        <div><div className="text-muted">Gross profit</div><div className="num text-lg font-semibold">{formatINR(p.grossProfit ?? 0)}</div></div>
        <div><div className="text-muted">Expenses</div><div className="num text-lg font-semibold">{formatINR(p.expensesTotal ?? 0)}</div></div>
        <div><div className="text-muted">Net profit</div><div className={`num text-lg font-semibold ${(p.netProfit ?? 0) < 0 ? "text-danger" : "text-ok"}`}>{formatINR(p.netProfit ?? 0)}</div></div>
      </section>
      <p className="mt-4 text-sm text-muted">
        {lock.data?.locked_until ? <>Books are locked up to <b>{formatDateIN(lock.data.locked_until)}</b>. </> : <>Books are not locked. </>}
        {vch.count ?? 0} manual voucher(s) this month. <Link className="text-brand-700 underline" href="/accounts/period-lock">Period lock</Link>
      </p>
    </div>
  );
}
