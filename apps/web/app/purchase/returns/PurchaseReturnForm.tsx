"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateIN, formatINR, type DrugSchedule } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { ScheduleBadge } from "@/components/ScheduleBadge";

export interface ReturnableBatch {
  batchId: string; productName: string; schedule: DrugSchedule; batchNo: string; expiry: string; qtyOnHand: number; costPerUnitPaise: number;
  status: string; daysToExpiry: number; baseLabel: string; lastDistributorId: string | null;
}

const REASONS = [["expiry", "Expired"], ["near_expiry", "Near expiry"], ["breakage", "Breakage"], ["damaged", "Damaged"], ["recall", "Recall / NSQ"], ["excess", "Excess / wrong supply"], ["other", "Other"]] as const;

export function PurchaseReturnForm({ storeId, distributors, batches, defaultDistributor }: {
  storeId: string; distributors: Array<{ id: string; name: string }>; batches: ReturnableBatch[]; defaultDistributor?: string;
}) {
  const router = useRouter();
  const [dist, setDist] = useState(defaultDistributor ?? "");
  const [reason, setReason] = useState<string>("expiry");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const chosen = batches.map((b) => ({ b, q: Math.floor(Number(qty[b.batchId] || 0)) })).filter((x) => x.q > 0);
  const value = chosen.reduce((s, { b, q }) => s + Math.round(b.costPerUnitPaise * q), 0);
  const tooMany = chosen.find(({ b, q }) => q > b.qtyOnHand);
  const otherDist = chosen.filter(({ b }) => dist && b.lastDistributorId && b.lastDistributorId !== dist);

  const submit = async () => {
    setBusy(true); setMsg(null);
    const { data, error } = await supabaseBrowser()!.rpc("post_purchase_return", { p: {
      idempotencyKey: key, storeId, distributorId: dist, reason, note, lines: chosen.map(({ b, q }) => ({ batchId: b.batchId, qtyBase: q })),
    } });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setMsg({ ok: true, text: `Debit note ${data.debitNoteNo} · ${formatINR(Number(data.totalPaise))} (value ${formatINR(Number(data.valuePaise))} + GST ${formatINR(Number(data.taxPaise))}). Send the goods with a copy to the distributor.` });
    setQty({}); setKey(crypto.randomUUID()); router.refresh();
  };

  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <div className="overflow-auto">
        <table className="w-full">
          <thead className="text-left text-xs uppercase text-muted"><tr><th>Product</th><th>Batch</th><th>Expiry</th><th className="text-right">On hand</th><th className="text-right">Cost/unit</th><th className="text-right">Return qty</th></tr></thead>
          <tbody>{batches.map((b) => (
            <tr key={b.batchId} className="border-t border-line">
              <td className="py-1"><span className="flex items-center gap-2"><ScheduleBadge schedule={b.schedule} />{b.productName}</span>{b.status !== "active" && <span className="text-xs text-danger">{b.status}</span>}</td>
              <td className="font-mono">{b.batchNo}</td>
              <td className={b.daysToExpiry < 0 ? "text-danger" : b.daysToExpiry <= 90 ? "text-warn" : ""}>{formatDateIN(b.expiry)}</td>
              <td className="num text-right">{b.qtyOnHand} {b.baseLabel}</td>
              <td className="num text-right">{formatINR(Math.round(b.costPerUnitPaise))}</td>
              <td className="text-right"><input aria-label={`Return quantity for ${b.productName} ${b.batchNo}`} type="number" min={0} max={b.qtyOnHand} value={qty[b.batchId] ?? ""}
                onChange={(e) => setQty((x) => ({ ...x, [b.batchId]: e.target.value }))} className="w-20 rounded border border-line px-1 py-0.5 text-right" />
                <button type="button" className="ml-1 text-xs text-brand-700 underline" onClick={() => setQty((x) => ({ ...x, [b.batchId]: String(b.qtyOnHand) }))}>all</button></td>
            </tr>))}
          {!batches.length && <tr><td colSpan={6} className="py-3 text-muted">Nothing to return in this view.</td></tr>}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label>Distributor<select value={dist} onChange={(e) => setDist(e.target.value)} className="mt-1 block rounded border border-line px-2 py-1">
          <option value="">Select…</option>{distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block rounded border border-line px-2 py-1">
          {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="claim ref., courier…" className="mt-1 block w-56 rounded border border-line px-2 py-1" /></label>
        <span className="num pb-1">Value at cost {formatINR(value)} + GST</span>
        <button disabled={busy || !dist || !chosen.length || !!tooMany} onClick={() => void submit()} className="rounded-md bg-brand-700 px-4 py-1.5 text-white disabled:opacity-40">{busy ? "Posting…" : "Create debit note"}</button>
      </div>
      {otherDist.length > 0 && <p className="text-warn">{otherDist.map(({ b }) => b.productName).join(", ")} was last bought from a different distributor — check before sending.</p>}
      {tooMany && <p className="text-danger">{tooMany.b.productName} {tooMany.b.batchNo}: only {tooMany.b.qtyOnHand} on hand.</p>}
      {msg && <p role="status" className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</p>}
    </section>
  );
}
