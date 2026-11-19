import { formatDateIN, formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { PurchaseReturnForm, type ReturnableBatch } from "./PurchaseReturnForm";

export const metadata = { title: "Returns to distributors · MedStar" };

export default async function PurchaseReturnsPage({ searchParams }: { searchParams: Promise<{ dist?: string; view?: string }> }) {
  const ctx = await requireArea("/purchase");
  const sp = await searchParams;
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Returns to distributors" /><LiveOnly what="Expiry & breakage returns" /></div>;
  const sb = await supabaseServer();
  const view = sp.view ?? "expiring";
  let bq = sb.from("v_returnable_batches").select("*").eq("store_id", ctx.store.id).order("expiry").limit(500);
  if (view === "expiring") bq = bq.lte("days_to_expiry", 90);
  if (sp.dist && view !== "all") bq = bq.eq("last_distributor_id", sp.dist);
  const [{ data: dists }, { data: batches }, { data: notes }] = await Promise.all([
    sb.from("distributors").select("id, name").eq("org_id", ctx.org.orgId).order("name"),
    bq,
    sb.from("purchase_returns").select("id, debit_note_no, return_date, reason, total_paise, distributors(name)").eq("store_id", ctx.store.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const rows: ReturnableBatch[] = (batches ?? []).map((b) => ({
    batchId: b.batch_id, productName: b.product_name, schedule: b.schedule, batchNo: b.batch_no, expiry: b.expiry, qtyOnHand: b.qty_on_hand,
    costPerUnitPaise: Number(b.cost_per_unit_paise), status: b.status, daysToExpiry: b.days_to_expiry, baseLabel: b.base_unit_label, lastDistributorId: b.last_distributor_id,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <PageHeader title="Returns to distributors" sub="Expired, near-expiry, damaged or recalled stock goes back on a debit note at landed cost; input GST is reversed for regular dealers." />
      <form className="flex flex-wrap items-center gap-2 text-sm">
        <select name="dist" defaultValue={sp.dist ?? ""} className="rounded border border-line bg-surface px-2 py-1.5">
          <option value="">All distributors</option>{(dists ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select name="view" defaultValue={view} className="rounded border border-line bg-surface px-2 py-1.5">
          <option value="expiring">Expired or expiring ≤ 90 days</option><option value="bought">Bought from this distributor</option><option value="all">All stock</option>
        </select>
        <button className="rounded border border-line bg-surface px-3 py-1.5">Show</button>
      </form>
      <PurchaseReturnForm storeId={ctx.store.id} distributors={dists ?? []} batches={rows} defaultDistributor={sp.dist} />
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Debit notes</h2>
        <table className="w-full text-sm">
          <thead><tr><th className={thCls}>No.</th><th className={thCls}>Date</th><th className={thCls}>Distributor</th><th className={thCls}>Reason</th><th className={`${thCls} text-right`}>Total</th></tr></thead>
          <tbody>{(notes ?? []).map((n) => (
            <tr key={n.id} className="border-t border-line"><td className="py-1 font-mono">{n.debit_note_no}</td><td>{formatDateIN(n.return_date)}</td>
              <td>{(n.distributors as unknown as { name: string } | null)?.name}</td><td>{n.reason}</td><td className="num text-right">{formatINR(Number(n.total_paise))}</td></tr>))}
          {!notes?.length && <tr><td colSpan={5} className="py-2 text-muted">None yet.</td></tr>}</tbody>
        </table>
      </section>
    </div>
  );
}
