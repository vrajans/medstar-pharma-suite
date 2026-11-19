import { notFound } from "next/navigation";
import { formatDateIN, formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { ProductForm, type ProductFormValue } from "../ProductForm";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireArea("/products");
  if (ctx.mode === "demo") return <div className="mx-auto max-w-4xl p-6"><LiveOnly what="Product details" /></div>;
  const sb = await supabaseServer();
  const [{ data: p }, { data: codes }, { data: batches }] = await Promise.all([
    sb.from("products").select("*").eq("id", id).eq("org_id", ctx.org.orgId).maybeSingle(),
    sb.from("product_barcodes").select("barcode").eq("product_id", id),
    sb.from("batches").select("id, batch_no, expiry, qty_on_hand, pack_mrp_paise, cost_per_unit_paise, status").eq("product_id", id).eq("store_id", ctx.store.id).order("expiry"),
  ]);
  if (!p) notFound();
  const initial: ProductFormValue = {
    id: p.id, name: p.name, manufacturer: p.manufacturer ?? "", composition: p.composition ?? "", dosage_form: p.dosage_form ?? "Tablet", category: p.category,
    hsn: p.hsn, schedule: p.schedule, rx_required: p.rx_required, habit_forming: p.habit_forming, cold_chain: p.cold_chain, pack_label: p.pack_label,
    base_unit_label: p.base_unit_label, units_per_pack: p.units_per_pack, allow_loose: p.allow_loose, reorder_level: p.reorder_level, rack: p.rack ?? "",
    gst_rate_override: p.gst_rate_override === null ? "" : String(Number(p.gst_rate_override)), listed_online: p.listed_online, is_active: p.is_active,
    blocked_reason: p.blocked_reason ?? "", barcodes: (codes ?? []).map((c) => c.barcode),
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <PageHeader title={p.name} sub={p.composition ?? undefined} />
      <div className="rounded-lg border border-line bg-surface p-4">
        <ProductForm orgId={ctx.org.orgId} initial={initial} canEdit={["owner", "admin", "purchase", "pharmacist"].includes(ctx.org.role)} />
      </div>
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Batches at {ctx.store.code}</h2>
        <table className="w-full text-sm">
          <thead><tr><th className={thCls}>Batch</th><th className={thCls}>Expiry</th><th className={`${thCls} text-right`}>Qty ({p.base_unit_label})</th><th className={`${thCls} text-right`}>MRP / {p.pack_label}</th><th className={`${thCls} text-right`}>Cost / {p.base_unit_label}</th><th className={thCls}>Status</th></tr></thead>
          <tbody>{(batches ?? []).map((b) => (
            <tr key={b.id} className="border-t border-line">
              <td className="py-1 font-mono">{b.batch_no}</td>
              <td className={b.expiry < today ? "text-danger" : ""}>{formatDateIN(b.expiry)}</td>
              <td className="num text-right">{b.qty_on_hand}</td>
              <td className="num text-right">{formatINR(Number(b.pack_mrp_paise))}</td>
              <td className="num text-right">{formatINR(Math.round(Number(b.cost_per_unit_paise)))}</td>
              <td>{b.expiry < today ? "expired" : b.status}</td>
            </tr>))}
          {!batches?.length && <tr><td colSpan={6} className="py-2 text-muted">No stock — receive it through a GRN or opening stock.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
