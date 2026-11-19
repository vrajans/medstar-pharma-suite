import { formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { formatBillTime } from "@/components/pos/Receipt";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { AdjustmentForm, Decide } from "./forms";

export const metadata = { title: "Stock adjustments · MedStar" };

export default async function AdjustmentsPage() {
  const ctx = await requireArea("/inventory");
  if (ctx.mode === "demo") return <div className="mx-auto max-w-5xl p-6"><PageHeader title="Stock adjustments" /><LiveOnly what="Stock adjustments" /></div>;
  const sb = await supabaseServer();
  const { data } = await sb.from("stock_adjustments")
    .select("id, adj_no, status, reason, note, requested_at, decided_at, decision_note, value_paise, stock_adjustment_lines(qty_delta, cost_paise, batches(batch_no), products(name))")
    .eq("store_id", ctx.store.id).order("requested_at", { ascending: false }).limit(50);
  type Adj = { id: string; adj_no: string | null; status: string; reason: string; note: string | null; requested_at: string; decision_note: string | null; value_paise: number;
    stock_adjustment_lines: Array<{ qty_delta: number; batches: { batch_no: string } | null; products: { name: string } | null }> };
  const rows = (data ?? []) as unknown as Adj[];
  const canDecide = ["owner", "admin"].includes(ctx.org.role);
  const canRequest = ["owner", "admin", "pharmacist", "purchase"].includes(ctx.org.role);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader title="Stock adjustments" sub="Damage, breakage, theft, audit differences and destroyed expired stock. Owners/admins post immediately; others need approval." />
      {canRequest && <section className="rounded-lg border border-line bg-surface p-4"><AdjustmentForm storeId={ctx.store.id} autoApproves={canDecide} /></section>}
      <section className="rounded-lg border border-line bg-surface p-4">
        <table className="w-full text-sm">
          <thead><tr><th className={thCls}>When</th><th className={thCls}>Reason</th><th className={thCls}>Lines</th><th className={`${thCls} text-right`}>Value</th><th className={thCls}>Status</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id} className="border-t border-line align-top">
              <td className="py-1">{formatBillTime(new Date(a.requested_at))}{a.adj_no && <div className="font-mono text-xs text-muted">{a.adj_no}</div>}</td>
              <td>{a.reason.replace("_", " ")}{a.note && <div className="text-xs text-muted">{a.note}</div>}</td>
              <td>{a.stock_adjustment_lines.map((l, i) => <div key={i}>{l.products?.name} · {l.batches?.batch_no} · <span className={l.qty_delta < 0 ? "text-danger" : "text-ok"}>{l.qty_delta > 0 ? "+" : ""}{l.qty_delta}</span></div>)}</td>
              <td className="num text-right">{a.status === "approved" ? formatINR(Number(a.value_paise)) : "—"}</td>
              <td>{a.status === "pending" && canDecide ? <Decide id={a.id} /> : a.status}{a.decision_note && <div className="text-xs text-muted">{a.decision_note}</div>}</td>
            </tr>))}
          {!rows.length && <tr><td colSpan={5} className="py-3 text-muted">No adjustments yet.</td></tr>}</tbody>
        </table>
      </section>
    </div>
  );
}
