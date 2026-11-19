import { formatDateIN } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { GstNav, istToday } from "@/components/books";

export const metadata = { title: "GST rates · MedStar" };

export default async function RatesPage() {
  const ctx = await requireArea("/gst");
  const composition = ctx.store.gstScheme === "composition";
  if (ctx.mode === "demo") return <div className="mx-auto max-w-5xl p-6"><PageHeader title="GST rates" /><GstNav active="/gst/rates" composition={composition} /><LiveOnly what="GST rate table" /></div>;
  const sb = await supabaseServer();
  const today = istToday();
  const [rates, overrides] = await Promise.all([
    sb.from("tax_rates").select("id, hsn_prefix, rate, effective_from, effective_to, note").order("hsn_prefix").order("effective_from", { ascending: false }),
    sb.from("products").select("id, name, hsn, gst_rate_override").eq("org_id", ctx.org.orgId).not("gst_rate_override", "is", null).order("name").limit(500),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader title="GST rate table" sub="Effective-dated: a bill always uses the rate in force on its date, so old bills reprint correctly after a rate change" />
      <GstNav active="/gst/rates" composition={composition} />
      {rates.error && <p className="text-danger">{rates.error.message}</p>}
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>HSN starts with</th><th className={`${thCls} text-right`}>Rate</th><th className={thCls}>From</th><th className={thCls}>To</th><th className={`${thCls} px-3`}>Note</th></tr></thead>
          <tbody>{(rates.data ?? []).map((r) => {
            const current = r.effective_from <= today && (!r.effective_to || r.effective_to >= today);
            return (
              <tr key={r.id} className={`border-t border-line ${current ? "" : "text-muted"}`}>
                <td className="px-3 py-1 font-mono">{r.hsn_prefix}</td><td className="num text-right">{Number(r.rate)}%</td>
                <td>{formatDateIN(r.effective_from)}</td><td>{r.effective_to ? formatDateIN(r.effective_to) : current ? "in force" : "—"}</td><td className="px-3">{r.note}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      <section>
        <h2 className="mb-1 font-semibold">Product-level overrides</h2>
        <p className="mb-2 text-sm text-muted">Nil-rated life-saving drugs and other exceptions are set on the product (Products → edit → GST override).</p>
        <div className="overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Product</th><th className={thCls}>HSN</th><th className={`${thCls} px-3 text-right`}>Rate</th></tr></thead>
            <tbody>{(overrides.data ?? []).map((p) => (
              <tr key={p.id} className="border-t border-line"><td className="px-3 py-1">{p.name}</td><td className="font-mono">{p.hsn}</td><td className="num px-3 text-right">{Number(p.gst_rate_override)}%</td></tr>))}
            {!overrides.data?.length && <tr><td colSpan={3} className="p-3 text-center text-muted">No overrides.</td></tr>}</tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-muted">The platform rate table is maintained by MedStar (GST 2.0 rates from 22-Sep-2025). If a rate looks wrong for your products, tell support — don&apos;t change bills.</p>
    </div>
  );
}
