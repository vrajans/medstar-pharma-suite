import { formatDateIN, formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { ButtonLink, LiveOnly, PageHeader, thCls } from "@/components/ui";
import { DistributorForm, SupplierPayment } from "./forms";

export const metadata = { title: "Purchase · MedStar" };

export default async function PurchasePage() {
  const ctx = await requireArea("/purchase");
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Purchase" /><LiveOnly what="Purchase & GRN" /></div>;
  const sb = await supabaseServer();
  const [{ data: grns }, { data: dists }] = await Promise.all([
    sb.from("purchase_invoices").select("id, supplier_invoice_no, supplier_invoice_date, total_paise, due_date, inter_state, created_at, distributors(name)")
      .eq("store_id", ctx.store.id).order("created_at", { ascending: false }).limit(50),
    sb.from("v_supplier_balances").select("*").eq("org_id", ctx.org.orgId).order("name"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader title="Purchase" sub={`Goods receipts for ${ctx.store.code} · distributor balances`}>
        <ButtonLink href="/inventory/opening">Opening stock</ButtonLink>
        <ButtonLink href="/purchase/returns">Returns / debit notes</ButtonLink>
        <ButtonLink href="/purchase/new" primary>New GRN</ButtonLink>
      </PageHeader>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Recent goods receipts</h2>
        <table className="w-full text-sm">
          <thead><tr><th className={thCls}>Date</th><th className={thCls}>Distributor</th><th className={thCls}>Invoice</th><th className={`${thCls} text-right`}>Total</th><th className={thCls}>Due</th></tr></thead>
          <tbody>{(grns ?? []).map((g) => (
            <tr key={g.id} className="border-t border-line">
              <td className="py-1">{formatDateIN(g.supplier_invoice_date)}</td>
              <td>{(g.distributors as unknown as { name: string } | null)?.name}{g.inter_state && <span className="ml-1 text-xs text-muted">IGST</span>}</td>
              <td className="font-mono">{g.supplier_invoice_no}</td>
              <td className="num text-right">{formatINR(Number(g.total_paise))}</td>
              <td>{g.due_date ? formatDateIN(g.due_date) : "—"}</td>
            </tr>))}
          {!grns?.length && <tr><td colSpan={5} className="py-3 text-muted">No purchases yet.</td></tr>}</tbody>
        </table>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Distributors</h2>
        <table className="mb-4 w-full text-sm">
          <thead><tr><th className={thCls}>Name</th><th className={thCls}>GSTIN</th><th className={thCls}>Drug licence</th><th className={`${thCls} text-right`}>We owe</th><th className={thCls}>Oldest due</th><th className={thCls} /></tr></thead>
          <tbody>{(dists ?? []).map((d) => {
            const licenceDays = d.drug_licence_valid_to ? Math.round((Date.parse(d.drug_licence_valid_to) - Date.parse(today)) / 86_400_000) : null;
            return (
              <tr key={d.distributor_id} className="border-t border-line align-top">
                <td className="py-1">{d.name}<div className="text-xs text-muted">{d.credit_days} days credit</div></td>
                <td className="font-mono text-xs">{d.gstin ?? "—"}</td>
                <td className={licenceDays !== null && licenceDays <= 30 ? "text-danger" : ""}>{d.drug_licence_no}
                  {d.drug_licence_valid_to && <div className="text-xs">to {formatDateIN(d.drug_licence_valid_to)}{licenceDays !== null && licenceDays < 0 && " — EXPIRED, purchases blocked"}</div>}</td>
                <td className="num text-right">{formatINR(Number(d.due_paise))}</td>
                <td className={d.oldest_due_date && d.oldest_due_date < today && Number(d.due_paise) > 0 ? "text-danger" : ""}>{d.oldest_due_date && Number(d.due_paise) > 0 ? formatDateIN(d.oldest_due_date) : "—"}</td>
                <td>{Number(d.due_paise) > 0 && <SupplierPayment storeId={ctx.store.id} distributorId={d.distributor_id} name={d.name} duePaise={Number(d.due_paise)} />}</td>
              </tr>);
          })}</tbody>
        </table>
        <h3 className="mb-1 text-sm font-semibold">Add distributor</h3>
        <DistributorForm orgId={ctx.org.orgId} />
      </section>
    </div>
  );
}
