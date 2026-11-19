import { formatDateIN } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { ExportButtons } from "../registers/ExportButtons";

export const metadata = { title: "Controlled-drug reconciliation · MedStar" };

interface Row { product: string; schedule: string; unit: string; opening: number; received: number; sold: number; customer_returns: number; returned_to_supplier: number; adjusted: number; closing: number; on_hand_now: number; register_qty: number }

export default async function ControlledPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireArea("/compliance");
  const sp = await searchParams;
  const to = sp.to ?? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const from = sp.from ?? to.slice(0, 8) + "01";
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Controlled-drug reconciliation" /><LiveOnly what="Stock reconciliation" /></div>;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("controlled_stock_summary", { p_store: ctx.store.id, p_from: from, p_to: to });
  const rows = (data ?? []) as Row[];
  const exportRows = rows.map((r) => ({ product: r.product, schedule: r.schedule, unit: r.unit, opening: r.opening, received: r.received, sold: r.sold,
    customer_returns: r.customer_returns, returned_to_supplier: r.returned_to_supplier, adjusted: r.adjusted, closing: r.closing, register_net: r.register_qty }));
  const title = `Controlled-drug stock reconciliation · ${ctx.store.code} · ${formatDateIN(from)} to ${formatDateIN(to)}`;

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-6">
      <PageHeader title="Controlled-drug stock reconciliation" sub="Every H1 / X / NDPS movement from the stock ledger. Closing must equal physical stock; investigate any adjustment.">
        <ExportButtons title={title} rows={exportRows} />
      </PageHeader>
      <form className="flex flex-wrap items-center gap-2 text-sm">
        <label>From <input type="date" name="from" defaultValue={from} className="rounded border border-line bg-surface px-2 py-1" /></label>
        <label>To <input type="date" name="to" defaultValue={to} className="rounded border border-line bg-surface px-2 py-1" /></label>
        <button className="rounded border border-line bg-surface px-3 py-1.5">Show</button>
      </form>
      {error && <p className="text-danger">{error.message}</p>}
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr>{["Product", "Sch", "Opening", "Received", "Sold", "Cust. returns", "To supplier", "Adjusted", "Closing", "Register net"].map((h, i) =>
            <th key={h} className={`${thCls} ${i > 1 ? "text-right" : ""} ${i === 0 ? "px-3" : ""} ${i === 9 ? "pr-3" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.product} className="border-t border-line">
              <td className="px-3 py-1">{r.product} <span className="text-xs text-muted">({r.unit})</span></td><td>{r.schedule}</td>
              {[r.opening, r.received, r.sold, r.customer_returns, r.returned_to_supplier].map((v, i) => <td key={i} className="num text-right">{v}</td>)}
              <td className={`num text-right ${r.adjusted ? "font-semibold text-warn" : ""}`}>{r.adjusted}</td>
              <td className="num text-right font-semibold">{r.closing}</td>
              <td className="num pr-3 text-right">{r.register_qty}</td>
            </tr>))}
          {!rows.length && <tr><td colSpan={10} className="p-6 text-center text-muted">No H1 / X / NDPS movements yet.</td></tr>}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Register net = units recorded in the statutory register for the period (sales minus all returns). It can differ from “Sold − Cust. returns” when a returned item was damaged and not restocked.</p>
    </div>
  );
}
