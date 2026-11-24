import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader } from "@/components/ui";
import { PoActions, ShortList, type PoPrint, type Suggestion, type Supplier } from "./forms";

export const metadata = { title: "Short list & orders · MedStar" };

interface PoRow {
  id: string; po_no: string; status: string; created_at: string; distributor_id: string;
  purchase_order_lines: Array<{ qty_packs: number; expected_rate_paise: number | null; products: { name: string; manufacturer: string | null; pack_label: string } | null }>;
}

export default async function ShortListPage() {
  const ctx = await requireArea("/purchase");
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Short list & orders" /><LiveOnly what="Short list" /></div>;
  const sb = await supabaseServer();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [sug, dist, pos, lic] = await Promise.all([
    sb.rpc("reorder_suggestions", { p_store: ctx.store.id, p_days: 30 }),
    sb.from("distributors").select("id, name, phone, drug_licence_valid_to, is_active").eq("org_id", ctx.org.orgId).eq("is_active", true).order("name"),
    sb.from("purchase_orders").select("id, po_no, status, created_at, distributor_id, purchase_order_lines(qty_packs, expected_rate_paise, products(name, manufacturer, pack_label))")
      .eq("store_id", ctx.store.id).order("created_at", { ascending: false }).limit(50),
    sb.from("licences").select("number, valid_to").eq("store_id", ctx.store.id).ilike("kind", "Form 2%"),
  ]);
  const suppliers: Supplier[] = (dist.data ?? []).map((d) => ({ id: d.id, name: d.name, phone: d.phone, licenceOk: !d.drug_licence_valid_to || d.drug_licence_valid_to >= today }));
  const store = { ...ctx.store, drugLicences: (lic.data ?? []).filter((l) => !l.valid_to || l.valid_to >= today).map((l) => l.number) };
  const orders = (pos.data ?? []) as unknown as PoRow[];
  const toPrint = (o: PoRow): PoPrint => ({
    no: o.po_no, at: o.created_at, store, orgName: ctx.org.orgName, supplier: { name: suppliers.find((s) => s.id === o.distributor_id)?.name ?? "" },
    lines: o.purchase_order_lines.map((l) => ({ name: l.products?.name ?? "", manufacturer: l.products?.manufacturer ?? null, packs: l.qty_packs, packLabel: l.products?.pack_label ?? "", ratePaise: l.expected_rate_paise })),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader title="Short list & purchase orders" sub={`${ctx.store.code} · items below their reorder level or below the last 30 days' sales, grouped by the supplier you last bought from`} />
      {sug.error && <p className="text-danger">{sug.error.message}</p>}
      <ShortList storeId={ctx.store.id} suggestions={(sug.data ?? []) as Suggestion[]} suppliers={suppliers} store={store} orgName={ctx.org.orgName} />
      <section>
        <h2 className="mb-2 font-semibold">Recent orders</h2>
        <div className="overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-canvas text-left text-xs uppercase text-muted"><tr><th className="px-3 py-2">Order</th><th>Supplier</th><th>Items</th><th>Status</th><th className="px-3" /></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id} className="border-t border-line">
                <td className="px-3 py-1.5 font-mono">{o.po_no}<div className="font-sans text-xs text-muted">{new Date(o.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</div></td>
                <td>{suppliers.find((s) => s.id === o.distributor_id)?.name}</td>
                <td>{o.purchase_order_lines.length}</td>
                <td className="capitalize">{o.status}</td>
                <td className="px-3 text-right">{o.status === "open" ? <PoActions id={o.id} po={toPrint(o)} phone={suppliers.find((s) => s.id === o.distributor_id)?.phone ?? null} /> : null}</td>
              </tr>))}
            {!orders.length && <tr><td colSpan={5} className="p-6 text-center text-muted">No orders yet.</td></tr>}</tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">When the goods arrive, enter the supplier&apos;s invoice as a GRN (Purchase → New GRN) and mark the order received.</p>
      </section>
    </div>
  );
}
