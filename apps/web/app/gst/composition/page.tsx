import Link from "next/link";
import { formatDateIN, formatINR, fyStart, gstQuarter, type CompositionData } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { GstNav, istToday } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";

export const metadata = { title: "CMP-08 / GSTR-4 · MedStar" };

export default async function CompositionPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string; fy?: string }> }) {
  const ctx = await requireArea("/gst");
  const sp = await searchParams;
  const composition = ctx.store.gstScheme === "composition";
  const today = istToday();
  const view = sp.view === "gstr4" ? "gstr4" : "cmp08";
  // quarter list for the current and previous FY
  const quarters: Array<ReturnType<typeof gstQuarter>> = [];
  for (let d = new Date(`${fyStart(today).slice(0, 4) as string}-04-01T00:00:00Z`), i = 0; i < 8; i++) {
    const back = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth() + i * 3, 1)).toISOString().slice(0, 10);
    if (back <= today) quarters.push(gstQuarter(back));
  }
  quarters.reverse();
  const q = quarters.find((x) => x.from === sp.q) ?? quarters.find((x) => x.to < today) ?? quarters[0]!;
  const fy = /^\d{4}$/.test(sp.fy ?? "") ? Number(sp.fy) : Number(fyStart(today).slice(0, 4)) - 1;
  const range = view === "gstr4" ? { from: `${fy}-04-01`, to: `${fy + 1}-03-31`, label: `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}` } : q;

  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="CMP-08 / GSTR-4" /><GstNav active="/gst/composition" composition={composition} /><LiveOnly what="Composition returns" /></div>;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("composition_summary", { p_store: ctx.store.id, p_from: range.from, p_to: range.to < today ? range.to : today, p_rate_pct: 1 });
  const c = data as CompositionData | null;
  const m = (v: number) => formatINR(Number(v));
  const exportRows = c ? [
    { item: "Outward supplies (turnover, net of returns)", value: c.turnover / 100, cgst: null, sgst: null },
    { item: "  of which taxable", value: c.taxableTurnover / 100, cgst: c.cgst / 100, sgst: c.sgst / 100 },
    { item: "  of which Nil-rated / exempt", value: c.exemptTurnover / 100, cgst: 0, sgst: 0 },
    ...c.inward.map((r) => ({ item: `Inward ${r.registered ? "from registered" : "from unregistered"} @ ${Number(r.rate)}%`, value: Number(r.txval) / 100, cgst: null, sgst: null })),
  ] : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <PageHeader title={view === "gstr4" ? "GSTR-4 annual summary" : "CMP-08 quarterly statement"} sub={`${ctx.store.code} · ${range.label} · ${formatDateIN(range.from)} to ${formatDateIN(range.to)}`}>
        <ExportButtons title={`${view === "gstr4" ? "GSTR-4" : "CMP-08"} ${ctx.store.code} ${range.label}`} rows={exportRows} footer="" />
      </PageHeader>
      <GstNav active="/gst/composition" composition={composition} />
      {!composition && <p className="rounded border border-warn bg-warn/10 p-2 text-sm text-warn">This store is on the regular scheme — use GSTR-1 and GSTR-3B. This page is shown for reference only.</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/gst/composition?view=cmp08" className={`rounded px-2 py-1 ${view === "cmp08" ? "bg-brand-700 text-white" : "border border-line"}`}>CMP-08 (quarterly)</Link>
        <Link href="/gst/composition?view=gstr4" className={`rounded px-2 py-1 ${view === "gstr4" ? "bg-brand-700 text-white" : "border border-line"}`}>GSTR-4 (annual)</Link>
        <span className="mx-2 text-muted">|</span>
        {view === "cmp08" ? quarters.map((x) => (
          <Link key={x.from} href={`/gst/composition?view=cmp08&q=${x.from}`} className={`rounded px-2 py-1 ${x.from === q.from ? "bg-canvas font-medium" : "text-muted"}`}>{x.label}</Link>))
          : [fy - 1, fy, fy + 1].filter((y) => `${y}-04-01` <= today).map((y) => (
            <Link key={y} href={`/gst/composition?view=gstr4&fy=${y}`} className={`rounded px-2 py-1 ${y === fy ? "bg-canvas font-medium" : "text-muted"}`}>FY {y}-{String((y + 1) % 100).padStart(2, "0")}</Link>))}
      </div>
      {error && <p className="text-danger">{error.message}</p>}
      {c && (
        <>
          <section className="rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>{view === "gstr4" ? "Table 6 / 5" : "Table 3"} · Summary of self-assessed liability</th>
                <th className={`${thCls} text-right`}>Value</th><th className={`${thCls} text-right`}>CGST</th><th className={`${thCls} px-3 text-right`}>SGST</th></tr></thead>
              <tbody className="[&_td]:py-1.5">
                <tr className="border-t border-line"><td className="px-3">Outward supplies incl. exempt (net of sales returns)</td><td className="num text-right">{m(c.turnover)}</td><td /><td /></tr>
                <tr className="border-t border-line"><td className="px-3 pl-6">Taxable turnover @ {c.ratePct}%</td><td className="num text-right">{m(c.taxableTurnover)}</td>
                  <td className="num text-right">{m(c.cgst)}</td><td className="num px-3 text-right">{m(c.sgst)}</td></tr>
                <tr className="border-t border-line"><td className="px-3 pl-6">Nil-rated medicines (no tax)</td><td className="num text-right">{m(c.exemptTurnover)}</td><td /><td /></tr>
                <tr className="border-t border-line"><td className="px-3">Inward supplies attracting reverse charge</td><td className="num text-right">{m(0)}</td><td className="num text-right">{m(0)}</td><td className="num px-3 text-right">{m(0)}</td></tr>
                <tr className="border-t-2 border-line text-base font-semibold"><td className="px-3">Tax payable</td><td /><td className="num text-right">{m(c.cgst)}</td><td className="num px-3 text-right">{m(c.sgst)}</td></tr>
              </tbody>
            </table>
          </section>
          <section className="rounded-lg border border-line bg-surface">
            <h2 className="border-b border-line px-3 py-1.5 font-semibold">Inward supplies (purchases){view === "gstr4" && " — GSTR-4 Table 4"}</h2>
            <table className="w-full text-sm">
              <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Supplier</th><th className={thCls}>Rate</th><th className={`${thCls} text-right`}>Taxable value</th><th className={`${thCls} px-3 text-right`}>Tax charged</th></tr></thead>
              <tbody>{c.inward.map((r, i) => (
                <tr key={i} className="border-t border-line"><td className="px-3 py-1">{r.registered ? "Registered" : "Unregistered"}{r.inter ? " (incl. inter-state)" : ""}</td><td>{Number(r.rate)}%</td>
                  <td className="num text-right">{m(r.txval)}</td><td className="num px-3 text-right">{m(r.tax)}</td></tr>))}
              {!c.inward.length && <tr><td colSpan={4} className="p-3 text-center text-muted">No purchases in this period.</td></tr>}</tbody>
            </table>
          </section>
          <p className="text-xs text-muted">Composition traders pay 1% (0.5% CGST + 0.5% SGST) on turnover of taxable goods; Nil-rated medicines are left out. Tax is paid in cash — no input tax credit.
            CMP-08 is due by the 18th after each quarter; GSTR-4 by 30 April. Confirm figures with your CA before filing.</p>
        </>
      )}
    </div>
  );
}
