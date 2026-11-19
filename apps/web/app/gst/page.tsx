import Link from "next/link";
import { formatINR, gstQuarter, monthRange, setOffGst, type CompositionData, type Gstr3bData } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader } from "@/components/ui";
import { GstNav, istToday } from "@/components/books";

export const metadata = { title: "GST · MedStar" };

export default async function GstPage() {
  const ctx = await requireArea("/gst");
  const composition = ctx.store.gstScheme === "composition";
  const today = istToday();
  const prevMonth = (() => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="GST" /><GstNav active="/gst" composition={composition} /><LiveOnly what="GST returns" /></div>;
  const sb = await supabaseServer();

  const due = composition
    ? [["CMP-08", "18th of the month after each quarter"], ["GSTR-4", "30 April after the financial year"]]
    : [["GSTR-1", "11th of next month (13th of month after quarter under QRMP)"], ["GSTR-3B", "20th of next month (22nd/24th under QRMP, by state)"]];

  let card: React.ReactNode = null;
  if (composition) {
    const q = gstQuarter(today);
    const { data, error } = await sb.rpc("composition_summary", { p_store: ctx.store.id, p_from: q.from, p_to: today });
    const c = data as CompositionData | null;
    card = error ? <p className="text-danger">{error.message}</p> : c && (
      <div className="grid grid-cols-3 gap-4">
        <Tile label={`Turnover ${q.label} so far`} value={formatINR(c.turnover)} />
        <Tile label="Taxable turnover (excl. Nil-rated medicines)" value={formatINR(c.taxableTurnover)} />
        <Tile label={`Tax due so far @ ${c.ratePct}%`} value={formatINR(c.cgst + c.sgst)} />
      </div>);
  } else {
    const r = monthRange(prevMonth);
    const { data, error } = await sb.rpc("gstr3b", { p_store: ctx.store.id, p_from: r.from, p_to: r.to });
    const b = data as Gstr3bData | null;
    const s = b ? setOffGst(b.outwardTaxable, b.itc) : null;
    card = error ? <p className="text-danger">{error.message}</p> : b && s && (
      <div className="grid grid-cols-4 gap-4">
        <Tile label={`Taxable sales ${prevMonth}`} value={formatINR(b.outwardTaxable.txval)} />
        <Tile label="Output tax" value={formatINR(b.outwardTaxable.camt + b.outwardTaxable.samt + b.outwardTaxable.iamt)} />
        <Tile label="Input tax credit (books)" value={formatINR(b.itc.camt + b.itc.samt + b.itc.iamt)} />
        <Tile label="Estimated cash payable" value={formatINR(s.totalCash)} />
      </div>);
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="GST" sub={`${ctx.store.code} · GSTIN ${ctx.store.gstin ?? "not set"} · ${composition ? "Composition scheme" : "Regular scheme"}`} />
      <GstNav active="/gst" composition={composition} />
      {!ctx.store.gstin && <p className="mb-3 rounded border border-warn bg-warn/10 p-2 text-sm text-warn">This store has no GSTIN. Add it in <Link className="underline" href="/settings">Settings</Link> before filing.</p>}
      {card}
      <section className="mt-6 grid grid-cols-2 gap-4 text-sm">
        {(composition
          ? [["/gst/composition", "CMP-08 & GSTR-4", "Quarterly turnover and tax, annual inward/outward summary"]]
          : [["/gst/gstr1", "GSTR-1", "B2B, B2C, credit notes, Nil-rated, HSN summary, documents issued — JSON for the GST portal"],
             ["/gst/gstr3b", "GSTR-3B", "Outward tax, input tax credit, set-off and cash payable; matched with your books"]]
        ).concat([["/gst/rates", "GST rate table", "Effective-dated HSN rates (GST 2.0 from 22-Sep-2025) used on every bill"]]).map(([href, t, d]) => (
          <Link key={href} href={href!} className="rounded-lg border border-line bg-surface p-4 hover:border-brand-600"><div className="font-medium">{t}</div><div className="text-muted">{d}</div></Link>))}
      </section>
      <section className="mt-6 text-sm">
        <h2 className="mb-1 font-semibold">Usual due dates</h2>
        <ul className="list-disc pl-5 text-muted">{due.map(([f, d]) => <li key={f}><b className="text-ink">{f}</b>: {d}</li>)}</ul>
        <p className="mt-2 text-xs text-muted">Due dates are extended by notification from time to time — check the GST portal. Review every return with your CA before filing.</p>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line bg-surface p-4"><div className="text-sm text-muted">{label}</div><div className="num mt-1 text-2xl font-semibold">{value}</div></div>;
}
