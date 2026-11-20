import { redirect } from "next/navigation";
import { formatDateIN, formatINR, setOffGst, type Gstr3bData } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { GstNav } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";
import { PeriodForm, previousMonth, readPeriod } from "../PeriodForm";

export const metadata = { title: "GSTR-3B · MedStar" };

const HEAD = { iamt: "IGST", camt: "CGST", samt: "SGST" } as const;

export default async function Gstr3bPage({ searchParams }: { searchParams: Promise<{ month?: string; from?: string; to?: string }> }) {
  const ctx = await requireArea("/gst");
  if (ctx.store.gstScheme === "composition") redirect("/gst/composition");
  const p = readPeriod(await searchParams, previousMonth());
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="GSTR-3B" /><GstNav active="/gst/gstr3b" composition={false} /><LiveOnly what="GSTR-3B" /></div>;
  const sb = await supabaseServer();
  const branches = ctx.store.gstin ? ctx.org.stores.filter((x) => x.gstin === ctx.store.gstin).map((x) => x.code) : [ctx.store.code];
  const { data, error } = await sb.rpc("gstr3b", { p_store: ctx.store.id, p_from: p.from, p_to: p.to });
  const b = data as Gstr3bData | null;
  // Net ITC can go negative when debit notes (purchase returns) exceed purchases: show it as a reversal (4B) and add it to the liability.
  const K = ["iamt", "camt", "samt"] as const;
  const avail = b ? Object.fromEntries(K.map((k) => [k, Math.max(0, Number(b.itc[k]))])) as Record<typeof K[number], number> : null;
  const rev = b ? Object.fromEntries(K.map((k) => [k, Math.max(0, -Number(b.itc[k]))])) as Record<typeof K[number], number> : null;
  const s = b && avail && rev ? setOffGst(
    { iamt: Number(b.outwardTaxable.iamt) + rev.iamt, camt: Number(b.outwardTaxable.camt) + rev.camt, samt: Number(b.outwardTaxable.samt) + rev.samt }, avail) : null;
  const m = (v: number) => formatINR(Number(v));
  const mismatch = b && (["iamt", "camt", "samt"] as const).some((k) => Number(b.outwardTaxable[k]) !== Number(b.booksOutputTax[k]));
  const exportRows = b && s ? [
    { table: "3.1(a) Outward taxable", taxable: Number(b.outwardTaxable.txval) / 100, igst: b.outwardTaxable.iamt / 100, cgst: b.outwardTaxable.camt / 100, sgst: b.outwardTaxable.samt / 100 },
    { table: "3.1(c) Nil-rated", taxable: Number(b.outwardNil) / 100, igst: 0, cgst: 0, sgst: 0 },
    { table: "4(A)(5) ITC — all other", taxable: null, igst: avail!.iamt / 100, cgst: avail!.camt / 100, sgst: avail!.samt / 100 },
    { table: "4(B)(2) ITC reversed — others", taxable: null, igst: rev!.iamt / 100, cgst: rev!.camt / 100, sgst: rev!.samt / 100 },
    { table: "5 Nil / exempt inward (intra)", taxable: Number(b.inwardNil.intra) / 100, igst: null, cgst: null, sgst: null },
    { table: "5 Nil / exempt inward (inter)", taxable: Number(b.inwardNil.inter) / 100, igst: null, cgst: null, sgst: null },
    { table: "6.1 Paid in cash", taxable: null, igst: s.cashPayable.iamt / 100, cgst: s.cashPayable.camt / 100, sgst: s.cashPayable.samt / 100 },
  ] : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <PageHeader title="GSTR-3B" sub={`${ctx.store.code} · ${formatDateIN(p.from)} to ${formatDateIN(p.to)} · GSTIN ${ctx.store.gstin ?? "not set"}`}>
        <ExportButtons title={`GSTR-3B ${ctx.store.code} ${formatDateIN(p.from)} to ${formatDateIN(p.to)}`} rows={exportRows} footer="" />
      </PageHeader>
      <GstNav active="/gst/gstr3b" composition={false} />
      <PeriodForm month={p.month} from={p.from} to={p.to} custom={p.custom} />
      {error && <p className="text-danger">{error.message}</p>}
      {branches.length > 1 && <p className="rounded border border-brand-600 bg-brand-50 p-2 text-sm">One return for GSTIN {ctx.store.gstin}: includes branches <b>{branches.join(", ")}</b>, which share this registration.</p>}
      {b && s && (
        <>
          {mismatch
            ? <p className="rounded border border-danger bg-danger/10 p-2 text-sm text-danger">Output tax in the return differs from Output GST in your books for this period. A manual voucher may have touched an output GST ledger — check the ledger before filing.</p>
            : <p className="text-sm text-ok">✓ Output tax matches your books</p>}
          <section className="rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Table</th><th className={`${thCls} text-right`}>Taxable value</th><th className={`${thCls} text-right`}>IGST</th><th className={`${thCls} text-right`}>CGST</th><th className={`${thCls} px-3 text-right`}>SGST</th></tr></thead>
              <tbody className="[&_td]:py-1.5">
                <tr className="border-t border-line"><td className="px-3">3.1(a) Outward taxable supplies (net of credit notes)</td><td className="num text-right">{m(b.outwardTaxable.txval)}</td>
                  <td className="num text-right">{m(b.outwardTaxable.iamt)}</td><td className="num text-right">{m(b.outwardTaxable.camt)}</td><td className="num px-3 text-right">{m(b.outwardTaxable.samt)}</td></tr>
                <tr className="border-t border-line"><td className="px-3">3.1(c) Nil-rated & exempt outward supplies</td><td className="num text-right">{m(b.outwardNil)}</td><td /><td /><td /></tr>
                <tr className="border-t border-line"><td className="px-3">4(A)(5) Input tax credit — all other ITC <span className="text-xs text-muted">(purchases − debit notes + expense bills, as in your books)</span></td><td />
                  <td className="num text-right">{m(avail!.iamt)}</td><td className="num text-right">{m(avail!.camt)}</td><td className="num px-3 text-right">{m(avail!.samt)}</td></tr>
                {rev && K.some((k) => rev[k] > 0) && (
                  <tr className="border-t border-line"><td className="px-3">4(B)(2) ITC reversed <span className="text-xs text-muted">(debit notes exceeded purchases this period)</span></td><td />
                    <td className="num text-right">{m(rev.iamt)}</td><td className="num text-right">{m(rev.camt)}</td><td className="num px-3 text-right">{m(rev.samt)}</td></tr>)}
                <tr className="border-t border-line"><td className="px-3">5 Nil-rated / exempt inward supplies</td><td className="num text-right">{m(Number(b.inwardNil.intra) + Number(b.inwardNil.inter))}</td><td /><td /><td /></tr>
              </tbody>
            </table>
          </section>
          <section className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-line bg-surface p-3 text-sm">
              <h2 className="mb-2 font-semibold">6.1 Payment of tax (estimate)</h2>
              <table className="w-full"><tbody>
                {s.used.map((u, i) => <tr key={i}><td>{HEAD[u.from]} credit used for {HEAD[u.to]}</td><td className="num text-right">{m(u.amount)}</td></tr>)}
                {(["iamt", "camt", "samt"] as const).map((k) => <tr key={k} className="border-t border-line font-medium"><td>{HEAD[k]} payable in cash</td><td className="num text-right">{m(s.cashPayable[k])}</td></tr>)}
                <tr className="border-t-2 border-line text-base font-semibold"><td>Total cash payable</td><td className="num text-right">{m(s.totalCash)}</td></tr>
                {(["iamt", "camt", "samt"] as const).some((k) => s.creditCarriedForward[k] > 0) && (
                  <tr><td className="pt-2 text-muted">Credit carried forward</td><td className="num pt-2 text-right text-muted">
                    {(["iamt", "camt", "samt"] as const).map((k) => `${HEAD[k]} ${m(s.creditCarriedForward[k])}`).join(" · ")}</td></tr>)}
              </tbody></table>
            </div>
            <div className="rounded-lg border border-line bg-surface p-3 text-sm">
              <h2 className="mb-2 font-semibold">Before you file</h2>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                <li>Match ITC with <b>GSTR-2B</b> on the portal — claim only what your suppliers have filed. Short-filed invoices must be left out or reversed.</li>
                <li>After filing, record the GST payment as a <b>Payment voucher</b> (Dr Output CGST/SGST, Cr Bank) and the set-off as a <b>Journal</b> (Dr Output, Cr Input).</li>
                <li>Then lock the month under Accounts → Period lock.</li>
              </ul>
              <p className="mt-2 text-xs">ITC by source: {Object.entries(b.itcBySource).map(([k, v]) => `${k.replace("_", " ")} ${m(v)}`).join(" · ") || "none"}</p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
