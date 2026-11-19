import { formatDateIN } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { ExportButtons } from "./ExportButtons";

export const metadata = { title: "Registers · MedStar" };

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export default async function RegistersPage({ searchParams }: { searchParams: Promise<{ sch?: string; from?: string; to?: string; q?: string }> }) {
  const ctx = await requireArea("/compliance");
  const sp = await searchParams;
  const sch = ["H1", "X", "NDPS"].includes(sp.sch ?? "") ? sp.sch! : "H1";
  const to = sp.to ?? istToday();
  const from = sp.from ?? to.slice(0, 8) + "01";
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Registers" /><LiveOnly what="Statutory registers" /></div>;
  const sb = await supabaseServer();
  let q = sb.from("schedule_register").select("id, entry_date, invoice_no, patient_name, patient_address, prescriber_name, prescriber_reg_no, prescriber_address, product_name, batch_no, qty_base, created_at")
    .eq("store_id", ctx.store.id).eq("schedule", sch).gte("entry_date", from).lte("entry_date", to).order("entry_date").order("id").limit(5000);
  if (sp.q) { const s = sp.q.replace(/[%,()]/g, ""); q = q.or(`patient_name.ilike.%${s}%,prescriber_name.ilike.%${s}%,product_name.ilike.%${s}%,invoice_no.ilike.%${s}%`); }
  const { data, error } = await q;
  const rows = (data ?? []).map((r) => ({
    date: formatDateIN(r.entry_date), doc: r.invoice_no, patient: `${r.patient_name}, ${r.patient_address}`,
    prescriber: `${r.prescriber_name} (${r.prescriber_reg_no})${r.prescriber_address ? `, ${r.prescriber_address}` : ""}`,
    drug: r.product_name, batch: r.batch_no, qty: r.qty_base,
  }));
  const title = `Schedule ${sch} register · ${ctx.store.code} ${ctx.store.name} · ${formatDateIN(from)} to ${formatDateIN(to)}`;

  return (
    <div className="mx-auto max-w-7xl space-y-3 p-6">
      <PageHeader title={`Schedule ${sch} register`} sub="Generated automatically from bills, credit notes and cancellations. Entries can't be edited or deleted; corrections appear as negative rows.">
        <ExportButtons title={title} rows={rows} />
      </PageHeader>
      <form className="flex flex-wrap items-center gap-2 text-sm">
        <select name="sch" defaultValue={sch} className="rounded border border-line bg-surface px-2 py-1.5"><option>H1</option><option>X</option><option>NDPS</option></select>
        <label>From <input type="date" name="from" defaultValue={from} className="rounded border border-line bg-surface px-2 py-1" /></label>
        <label>To <input type="date" name="to" defaultValue={to} className="rounded border border-line bg-surface px-2 py-1" /></label>
        <input name="q" defaultValue={sp.q} placeholder="Patient, doctor, drug or bill no." className="w-64 rounded border border-line bg-surface px-2 py-1.5" />
        <button className="rounded border border-line bg-surface px-3 py-1.5">Show</button>
      </form>
      {error && <p className="text-danger">{error.message}</p>}
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Date</th><th className={thCls}>Bill / CN no.</th><th className={thCls}>Patient & address</th><th className={thCls}>Prescriber, reg. no., address</th><th className={thCls}>Drug</th><th className={thCls}>Batch</th><th className={`${thCls} pr-3 text-right`}>Qty</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className={`border-t border-line align-top ${r.qty < 0 ? "text-danger" : ""}`}>
              <td className="px-3 py-1">{r.date}</td><td className="font-mono text-xs">{r.doc}</td><td>{r.patient}</td><td>{r.prescriber}</td><td>{r.drug}</td><td className="font-mono">{r.batch}</td><td className="num pr-3 text-right">{r.qty}</td>
            </tr>))}
          {!rows.length && <tr><td colSpan={7} className="p-6 text-center text-muted">No entries in this period.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
