import { formatDateIN, formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { ButtonLink, LiveOnly, PageHeader, thCls } from "@/components/ui";
import { CustomerForm, CustomerReceipt, CreditLimitEdit } from "./forms";

export const metadata = { title: "Customers · MedStar" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; due?: string }> }) {
  const ctx = await requireArea("/customers");
  const sp = await searchParams;
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Customers" /><LiveOnly what="Customer accounts" /></div>;
  const sb = await supabaseServer();
  let q = sb.from("v_customer_balances").select("*").eq("org_id", ctx.org.orgId).order("outstanding_paise", { ascending: false }).limit(300);
  if (sp.q) { const s = sp.q.replace(/[%,()]/g, ""); q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`); }
  if (sp.due) q = q.gt("outstanding_paise", 0);
  const { data } = await q;
  const rows = data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.outstanding_paise), 0);
  const canLimit = ["owner", "admin"].includes(ctx.org.role);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <PageHeader title="Customers" sub={`Credit (udhaar) outstanding: ${formatINR(total)}`}>
        <ButtonLink href="/doctors">Doctors</ButtonLink>
      </PageHeader>
      <form className="flex flex-wrap items-center gap-2 text-sm">
        <input name="q" defaultValue={sp.q} placeholder="Name or mobile" className="w-64 rounded border border-line bg-surface px-2 py-1.5" />
        <label className="flex items-center gap-1"><input type="checkbox" name="due" value="1" defaultChecked={!!sp.due} /> Only with outstanding</label>
        <button className="rounded border border-line bg-surface px-3 py-1.5">Filter</button>
      </form>
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Customer</th><th className={thCls}>Mobile</th><th className={`${thCls} text-right`}>Credit limit</th><th className={`${thCls} text-right`}>Outstanding</th><th className={thCls}>Last activity</th><th className={thCls} /></tr></thead>
          <tbody>{rows.map((c) => {
            const over = Number(c.outstanding_paise) > Number(c.credit_limit_paise) && Number(c.outstanding_paise) > 0;
            return (
              <tr key={c.customer_id} className="border-t border-line align-top">
                <td className="px-3 py-1.5">{c.name ?? "—"}</td>
                <td className="font-mono">{c.phone}</td>
                <td className="num text-right">{canLimit ? <CreditLimitEdit customerId={c.customer_id} limitPaise={Number(c.credit_limit_paise)} /> : formatINR(Number(c.credit_limit_paise))}</td>
                <td className={`num text-right ${over ? "text-danger" : ""}`}>{formatINR(Number(c.outstanding_paise))}</td>
                <td>{c.last_entry ? formatDateIN(c.last_entry) : "—"}</td>
                <td className="pr-3">{Number(c.outstanding_paise) > 0 && <CustomerReceipt storeId={ctx.store.id} customerId={c.customer_id} outstandingPaise={Number(c.outstanding_paise)} />}</td>
              </tr>);
          })}
          {!rows.length && <tr><td colSpan={6} className="p-6 text-center text-muted">No customers yet — they&apos;re also added from the POS with F4.</td></tr>}</tbody>
        </table>
      </div>
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Add customer</h2>
        <CustomerForm orgId={ctx.org.orgId} />
      </section>
    </div>
  );
}
