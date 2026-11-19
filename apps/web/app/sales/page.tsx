import Link from "next/link";
import { formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { formatBillTime } from "@/components/pos/Receipt";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";

export const metadata = { title: "Sales · MedStar" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; date?: string }> }) {
  const ctx = await requireArea("/sales");
  const sp = await searchParams;
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Sales" /><LiveOnly what="Bills, returns and cancellations" /></div>;
  const sb = await supabaseServer();
  let q = sb.from("sales_bills").select("id, invoice_no, provisional_no, billed_at, total_paise, status, needs_review, channel, customers(name, phone)")
    .eq("store_id", ctx.store.id).order("billed_at", { ascending: false }).limit(100);
  if (sp.q) q = q.ilike("invoice_no", `%${sp.q.replace(/[%,()]/g, "")}%`);
  if (sp.date) {
    const start = new Date(`${sp.date}T00:00:00+05:30`), end = new Date(start.getTime() + 86_400_000);
    q = q.gte("billed_at", start.toISOString()).lt("billed_at", end.toISOString());
  }
  const { data } = await q;
  const bills = (data ?? []) as unknown as Array<{ id: string; invoice_no: string; provisional_no: string | null; billed_at: string; total_paise: number; status: string; needs_review: boolean; channel: string; customers: { name: string | null; phone: string } | null }>;
  const posted = bills.filter((b) => b.status === "posted");

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Sales" sub={`${ctx.store.code} · ${posted.length} bill(s) shown · ${formatINR(posted.reduce((s, b) => s + Number(b.total_paise), 0))}`} />
      <form className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input name="q" defaultValue={sp.q} placeholder="Invoice no." className="w-48 rounded border border-line bg-surface px-2 py-1.5" />
        <input type="date" name="date" defaultValue={sp.date} className="rounded border border-line bg-surface px-2 py-1.5" />
        <button className="rounded border border-line bg-surface px-3 py-1.5">Filter</button>
      </form>
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Invoice</th><th className={thCls}>Date & time</th><th className={thCls}>Customer</th><th className={`${thCls} text-right`}>Total</th><th className={`${thCls} pr-3`}>Status</th></tr></thead>
          <tbody>{bills.map((b) => (
            <tr key={b.id} className={`border-t border-line ${b.status === "cancelled" ? "text-muted line-through" : ""}`}>
              <td className="px-3 py-1.5"><Link href={`/sales/${b.id}`} className="font-mono hover:underline">{b.invoice_no}</Link>
                {b.provisional_no && <span className="ml-1 text-xs text-muted">({b.provisional_no})</span>}</td>
              <td>{formatBillTime(new Date(b.billed_at))}</td>
              <td>{b.customers ? `${b.customers.name ?? ""} ${b.customers.phone}` : "Walk-in"}</td>
              <td className="num text-right">{formatINR(Number(b.total_paise))}</td>
              <td className="pr-3">{b.status}{b.needs_review && <span className="ml-1 rounded bg-warn/10 px-1 text-xs text-warn no-underline">review</span>}</td>
            </tr>))}
          {!bills.length && <tr><td colSpan={5} className="p-6 text-center text-muted">No bills.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
