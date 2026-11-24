import { formatINR } from "@medstar/core";
import type { DrugSchedule } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader } from "@/components/ui";
import { CancelTransfer, NewTransfer, ReceiveTransfer, ReprintChallan, type BatchOpt, type Branch } from "./forms";

export const metadata = { title: "Branch transfers · MedStar" };

interface TRow {
  id: string; transfer_no: string; status: string; note: string | null; value_paise: number; created_at: string; received_at: string | null;
  receive_note: string | null; cancel_reason: string | null; from_store_id: string; to_store_id: string;
  stock_transfer_lines: Array<{ id: number; qty_base: number; received_qty: number | null; batch_no: string; expiry: string; pack_mrp_paise: number;
    products: { name: string; schedule: string; base_unit_label: string } | null }>;
}

export default async function TransfersPage() {
  const ctx = await requireArea("/inventory");
  const canMove = ["owner", "admin", "pharmacist", "purchase"].includes(ctx.org.role);
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Branch transfers" /><LiveOnly what="Branch transfers" /></div>;
  const sb = await supabaseServer();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [stores, batches, transfers] = await Promise.all([
    sb.from("stores").select("id, code, name, gstin, address").eq("org_id", ctx.org.orgId).order("code"),
    sb.from("batches").select("id, batch_no, expiry, qty_on_hand, pack_mrp_paise, products(name, schedule, units_per_pack, pack_label, base_unit_label)")
      .eq("store_id", ctx.store.id).eq("status", "active").gt("qty_on_hand", 0).gte("expiry", today).order("expiry").limit(3000),
    sb.from("stock_transfers").select("id, transfer_no, status, note, value_paise, created_at, received_at, receive_note, cancel_reason, from_store_id, to_store_id, stock_transfer_lines(id, qty_base, received_qty, batch_no, expiry, pack_mrp_paise, products(name, schedule, base_unit_label))")
      .or(`from_store_id.eq.${ctx.store.id},to_store_id.eq.${ctx.store.id}`).order("created_at", { ascending: false }).limit(100),
  ]);
  const branches = (stores.data ?? []) as Branch[];
  const byId = new Map(branches.map((b) => [b.id, b]));
  const me = byId.get(ctx.store.id) ?? { id: ctx.store.id, code: ctx.store.code, name: ctx.store.name, gstin: ctx.store.gstin ?? null, address: ctx.store.address ?? null };
  const opts: BatchOpt[] = (batches.data ?? []).map((b) => {
    const p = b.products as unknown as { name: string; schedule: DrugSchedule; units_per_pack: number; pack_label: string; base_unit_label: string };
    return { id: b.id, productName: p.name, schedule: p.schedule, batchNo: b.batch_no, expiry: b.expiry, qty: b.qty_on_hand, unitsPerPack: p.units_per_pack,
      packLabel: p.pack_label, baseLabel: p.base_unit_label, packMrpPaise: Number(b.pack_mrp_paise) };
  }).sort((a, b) => a.productName.localeCompare(b.productName));
  const rows = (transfers.data ?? []) as unknown as TRow[];
  const incoming = rows.filter((t) => t.to_store_id === ctx.store.id && t.status === "in_transit");
  const challan = (t: TRow) => ({
    no: t.transfer_no, at: t.created_at, from: byId.get(t.from_store_id)!, to: byId.get(t.to_store_id)!, orgName: ctx.org.orgName, note: t.note, valuePaise: Number(t.value_paise),
    lines: t.stock_transfer_lines.map((l) => ({ name: l.products?.name ?? "", schedule: l.products?.schedule ?? "", batchNo: l.batch_no, expiry: l.expiry, qty: l.qty_base, label: l.products?.base_unit_label ?? "", mrpPaise: Number(l.pack_mrp_paise) })),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader title="Branch transfers" sub={`${ctx.store.code} · send stock to another branch with a delivery challan; the other branch receives it here`} />
      {incoming.length > 0 && (
        <section className="rounded-lg border border-brand-600 bg-surface p-4">
          <h2 className="font-semibold">Arriving at {ctx.store.code} ({incoming.length})</h2>
          {incoming.map((t) => (
            <div key={t.id} className="mt-3 border-t border-line pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><b className="font-mono">{t.transfer_no}</b> from {byId.get(t.from_store_id)?.code} · {new Date(t.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}{t.note && ` · ${t.note}`}</span>
                <ReprintChallan {...challan(t)} />
              </div>
              {canMove ? <ReceiveTransfer id={t.id} lines={t.stock_transfer_lines.map((l) => ({ id: l.id, name: `${l.products?.name} · ${l.batch_no}`, qty: l.qty_base, label: l.products?.base_unit_label ?? "" }))} />
                : <p className="text-sm text-muted">The pharmacist or owner receives this.</p>}
            </div>))}
        </section>)}
      {canMove && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-2 font-semibold">Send stock</h2>
          <NewTransfer fromStore={me} branches={branches} batches={opts} orgName={ctx.org.orgName} />
        </section>)}
      <section>
        <h2 className="mb-2 font-semibold">History</h2>
        <div className="overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-canvas text-left text-xs uppercase text-muted"><tr><th className="px-3 py-2">Challan</th><th>Direction</th><th>Items</th><th className="text-right">Value</th><th>Status</th><th className="px-3" /></tr></thead>
            <tbody>{rows.map((t) => {
              const out = t.from_store_id === ctx.store.id;
              const short = t.stock_transfer_lines.reduce((s, l) => s + (l.received_qty !== null ? l.qty_base - l.received_qty : 0), 0);
              return (
                <tr key={t.id} className="border-t border-line align-top">
                  <td className="px-3 py-1.5 font-mono">{t.transfer_no}<div className="font-sans text-xs text-muted">{new Date(t.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</div></td>
                  <td>{out ? `→ ${byId.get(t.to_store_id)?.code}` : `← ${byId.get(t.from_store_id)?.code}`}</td>
                  <td>{t.stock_transfer_lines.length} item(s){short > 0 && <span className="text-warn"> · {short} short</span>}</td>
                  <td className="num text-right">{formatINR(Number(t.value_paise))}</td>
                  <td>{t.status === "in_transit" ? "In transit" : t.status === "received" ? "Received" : "Cancelled"}
                    {(t.receive_note || t.cancel_reason) && <div className="text-xs text-muted">{t.receive_note ?? t.cancel_reason}</div>}</td>
                  <td className="space-x-2 px-3 text-right"><ReprintChallan {...challan(t)} />{out && t.status === "in_transit" && canMove && <CancelTransfer id={t.id} />}</td>
                </tr>);
            })}
            {!rows.length && <tr><td colSpan={6} className="p-6 text-center text-muted">No transfers yet.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
