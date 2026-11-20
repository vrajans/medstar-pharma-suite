import { redirect } from "next/navigation";
import { formatDateIN, formatINR, uqcFor, type Gstr1Data } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { GstNav } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";
import { PeriodForm, previousMonth, readPeriod } from "../PeriodForm";
import { DownloadGstr1 } from "./DownloadJson";

export const metadata = { title: "GSTR-1 · MedStar" };

const R = (p: number) => Number(p) / 100;

function Table({ title, note, head, rows, empty, numCols = 3 }: { title: string; note?: string; head: string[]; rows: Array<Array<React.ReactNode>>; empty: string; numCols?: number }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <h2 className="border-b border-line px-3 py-1.5 font-semibold">{title} {note && <span className="text-xs font-normal text-muted">{note}</span>}</h2>
      <div className="overflow-auto"><table className="w-full text-sm">
        <thead className="bg-canvas"><tr>{head.map((h, i) => <th key={h} className={`${thCls} ${i === 0 ? "px-3" : ""} ${i >= head.length - numCols ? "pr-3 text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className={`py-1 ${j === 0 ? "px-3" : ""} ${j >= head.length - numCols ? "num pr-3 text-right" : ""}`}>{c}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={head.length} className="p-3 text-center text-muted">{empty}</td></tr>}</tbody>
      </table></div>
    </section>
  );
}

export default async function Gstr1Page({ searchParams }: { searchParams: Promise<{ month?: string; from?: string; to?: string }> }) {
  const ctx = await requireArea("/gst");
  if (ctx.store.gstScheme === "composition") redirect("/gst/composition");
  const p = readPeriod(await searchParams, previousMonth());
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="GSTR-1" /><GstNav active="/gst/gstr1" composition={false} /><LiveOnly what="GSTR-1" /></div>;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("gstr1", { p_store: ctx.store.id, p_from: p.from, p_to: p.to });
  const g = data as Gstr1Data | null;
  const money = (v: number) => formatINR(Number(v));
  const flat = g ? [
    ...g.b2b.map((r) => ({ section: "B2B", gstin: r.ctin, party: r.party, doc_no: r.doc_no, date: formatDateIN(r.doc_date), rate: Number(r.rate), taxable: R(r.txval), cgst: R(r.camt), sgst: R(r.samt), igst: R(r.iamt) })),
    ...g.b2cs.map((r) => ({ section: "B2CS", gstin: "", party: "", doc_no: "", date: "", rate: Number(r.rate), taxable: R(r.txval), cgst: R(r.camt), sgst: R(r.samt), igst: R(r.iamt) })),
    ...g.cdnr.map((r) => ({ section: "CDNR", gstin: r.ctin, party: r.party, doc_no: `${r.doc_no} (against ${r.orig_no})`, date: formatDateIN(r.doc_date), rate: Number(r.rate), taxable: R(r.txval), cgst: R(r.camt), sgst: R(r.samt), igst: R(r.iamt) })),
    ...g.hsn.map((r) => ({ section: r.b2b ? "HSN B2B" : "HSN B2C", gstin: "", party: `${r.hsn} · ${uqcFor(r.unit)} ${r.qty}`, doc_no: "", date: "", rate: Number(r.rate), taxable: R(r.txval), cgst: R(r.camt), sgst: R(r.samt), igst: R(r.iamt) })),
  ] : [];

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <PageHeader title="GSTR-1" sub={`${ctx.store.code} · ${formatDateIN(p.from)} to ${formatDateIN(p.to)} · GSTIN ${ctx.store.gstin ?? "not set"}`}>
        <ExportButtons title={`GSTR-1 ${ctx.store.code} ${formatDateIN(p.from)} to ${formatDateIN(p.to)}`} rows={flat} footer="" />
        {g && <DownloadGstr1 data={g} fp={p.fp} />}
      </PageHeader>
      <GstNav active="/gst/gstr1" composition={false} />
      <PeriodForm month={p.month} from={p.from} to={p.to} custom={p.custom} />
      {error && <p className="text-danger">{error.message}</p>}
      {g && (
        <>
          {(g.stores?.length ?? 0) > 1 && <p className="rounded border border-brand-600 bg-brand-50 p-2 text-sm">One return for GSTIN {g.gstin}: includes branches <b>{g.stores!.join(", ")}</b>, which share this registration.</p>}
          <div className="grid grid-cols-5 gap-3 text-sm">
            {[["Invoices", String(g.totals.invoices)], ["Credit notes", String(g.totals.creditNotes)], ["Taxable value (net)", money(g.totals.txval)],
              ["CGST", money(g.totals.camt)], ["SGST", money(g.totals.samt)]].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-line bg-surface p-3"><div className="text-muted">{l}</div><div className="num text-lg font-semibold">{v}</div></div>))}
          </div>
          <Table title="4A · B2B invoices" note="sales to customers with a GSTIN (clinics, hospitals, other pharmacies)" head={["GSTIN", "Customer", "Invoice", "Date", "Rate", "Taxable", "CGST", "SGST"]}
            rows={g.b2b.map((r) => [r.ctin, r.party, r.doc_no, formatDateIN(r.doc_date), `${Number(r.rate)}%`, money(r.txval), money(r.camt), money(r.samt)])} empty="No B2B sales." />
          <Table title="7 · B2C (small)" note="counter sales to unregistered customers, net of their credit notes, rate-wise" head={["Type", "Place of supply", "Rate", "Taxable", "CGST", "SGST"]}
            rows={g.b2cs.map((r) => ["Intra-state", g.stateCode, `${Number(r.rate)}%`, money(r.txval), money(r.camt), money(r.samt)])} empty="No B2C sales." />
          <Table title="9B · Credit notes to registered customers (CDNR)" head={["GSTIN", "Customer", "Credit note", "Against invoice", "Rate", "Taxable", "CGST", "SGST"]}
            rows={g.cdnr.map((r) => [r.ctin, r.party, `${r.doc_no} · ${formatDateIN(r.doc_date)}`, r.orig_no, `${Number(r.rate)}%`, money(r.txval), money(r.camt), money(r.samt)])} empty="No credit notes to registered customers." />
          <Table title="8 · Nil-rated supplies" note="life-saving drugs at 0% (GST 2.0)" head={["Supply", "Nil-rated", "Exempt", "Non-GST"]}
            rows={[["Intra-state to registered", money(g.nil.b2b), money(0), money(0)], ["Intra-state to unregistered", money(g.nil.b2c), money(0), money(0)]]} empty="" />
          <Table title="12 · HSN summary" note="split B2B / B2C as required from 2025; quantity in the product's base unit" head={["Tab", "HSN", "UQC", "Qty", "Rate", "Taxable", "CGST", "SGST"]}
            rows={g.hsn.map((r) => [r.b2b ? "B2B" : "B2C", r.hsn, uqcFor(r.unit), Number(r.qty), `${Number(r.rate)}%`, money(r.txval), money(r.camt), money(r.samt)])} empty="No supplies." />
          <Table title="13 · Documents issued" head={["Document", "Series", "From", "To", "Total", "Cancelled", "Net issued"]}
            rows={g.docs.map((d) => [d.kind === "INV" ? "Invoices" : "Credit notes", d.series, d.first_no, d.last_no, Number(d.total), Number(d.cancelled), Number(d.total) - Number(d.cancelled)])} empty="No documents." />
          <p className="text-xs text-muted">Place of supply for counter sales is this store&apos;s state. Upload the JSON through the GST portal (Returns → GSTR-1 → Prepare offline → Upload)
            or open it in the GST Offline Tool first to check it. Amendments of earlier periods are not generated — do them on the portal.</p>
        </>
      )}
    </div>
  );
}
