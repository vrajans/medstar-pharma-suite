import { formatDateIN, formatINR, type DrugSchedule } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { ScheduleBadge } from "@/components/ScheduleBadge";
import { ButtonLink, LiveOnly, PageHeader, thCls } from "@/components/ui";

export const metadata = { title: "Inventory · MedStar" };

interface Row { name: string; schedule: DrugSchedule; batch_no: string; expiry: string; qty_on_hand: number; pack_mrp_paise: number; status: string; days_to_expiry: number; value_at_cost_paise: number }

const VIEWS = [["all", "All stock"], ["90", "Expiring ≤ 90 days"], ["blocked", "Expired / recalled"]] as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const ctx = await requireArea("/inventory");
  const sp = await searchParams;
  const view = sp.view ?? "all";
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Inventory" /><LiveOnly what="Batch-wise inventory" /></div>;
  const sb = await supabaseServer();
  let q = sb.from("v_stock_by_batch").select("name, schedule, batch_no, expiry, qty_on_hand, pack_mrp_paise, status, days_to_expiry, value_at_cost_paise")
    .eq("store_id", ctx.store.id).gt("qty_on_hand", 0).order("expiry").limit(1000);
  if (view === "90") q = q.gte("days_to_expiry", 0).lte("days_to_expiry", 90).eq("status", "active");
  if (view === "blocked") q = q.or("days_to_expiry.lt.0,status.neq.active");
  if (sp.q) q = q.ilike("name", `%${sp.q.replace(/[%,()]/g, "")}%`);
  const { data, error } = await q;
  const rows = (data ?? []) as Row[];
  const value = rows.reduce((s, r) => s + Number(r.value_at_cost_paise), 0);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Inventory" sub={`${ctx.store.code} · ${rows.length} batch(es) · value at cost ${formatINR(value)}`}>
        <ButtonLink href="/inventory/opening">Load opening stock</ButtonLink>
        <ButtonLink href="/purchase/new" primary>New GRN</ButtonLink>
      </PageHeader>
      <form className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {VIEWS.map(([v, label]) => (
          <button key={v} name="view" value={v} className={`rounded-full border px-3 py-1 ${view === v ? "border-brand-700 bg-brand-50" : "border-line bg-surface"}`}>{label}</button>))}
        <input name="q" defaultValue={sp.q} placeholder="Search product" className="ml-2 w-56 rounded border border-line bg-surface px-2 py-1" />
      </form>
      {error && <p className="text-danger">{error.message}</p>}
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Product</th><th className={thCls}>Batch</th><th className={thCls}>Expiry</th><th className={`${thCls} text-right`}>Qty</th><th className={`${thCls} text-right`}>MRP</th><th className={`${thCls} text-right`}>Value at cost</th><th className={`${thCls} pr-3`}>Status</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const expired = r.days_to_expiry < 0;
            return (
              <tr key={i} className="border-t border-line">
                <td className="px-3 py-1.5"><span className="flex items-center gap-2"><ScheduleBadge schedule={r.schedule} />{r.name}</span></td>
                <td className="font-mono">{r.batch_no}</td>
                <td className={expired ? "text-danger" : r.days_to_expiry <= 90 ? "text-warn" : ""}>{formatDateIN(r.expiry)}{!expired && r.days_to_expiry <= 90 && ` (${r.days_to_expiry}d)`}</td>
                <td className="num text-right">{r.qty_on_hand}</td>
                <td className="num text-right">{formatINR(Number(r.pack_mrp_paise))}</td>
                <td className="num text-right">{formatINR(Number(r.value_at_cost_paise))}</td>
                <td className={`pr-3 ${expired || r.status !== "active" ? "text-danger" : ""}`}>{expired ? "expired — return to distributor" : r.status}</td>
              </tr>);
          })}
          {!rows.length && <tr><td colSpan={7} className="p-6 text-center text-muted">Nothing here.</td></tr>}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Expiry returns to distributors (debit notes) and stock adjustments arrive in Sprint 3.</p>
    </div>
  );
}
