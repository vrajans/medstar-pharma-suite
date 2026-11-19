"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateIN } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import type { PosProduct } from "@/lib/catalogue";
import { ProductPicker } from "@/components/ProductPicker";

const REASONS = [["damage", "Damage"], ["breakage", "Breakage"], ["theft", "Theft / missing"], ["audit_difference", "Physical count difference"], ["expired_destroyed", "Expired — destroyed"], ["found", "Found / excess"], ["other", "Other"]] as const;
interface Line { key: string; product: PosProduct; batchId: string; delta: string }

export function AdjustmentForm({ storeId, autoApproves }: { storeId: string; autoApproves: boolean }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [reason, setReason] = useState<string>("damage");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = lines.length > 0 && lines.every((l) => l.batchId && Number.isInteger(Number(l.delta)) && Number(l.delta) !== 0);
  const needsNote = lines.some((l) => l.product.schedule === "X" || l.product.schedule === "NDPS");

  return (
    <div className="space-y-3 text-sm">
      <ProductPicker storeId={storeId} placeholder="Add a product to adjust"
        onPick={(p) => setLines((ls) => [...ls, { key: crypto.randomUUID(), product: p, batchId: p.batches[0]?.id ?? "", delta: reason === "found" ? "1" : "-1" }])} />
      {lines.map((l) => (
        <div key={l.key} className="flex flex-wrap items-center gap-2">
          <span className="w-64 truncate">{l.product.name}</span>
          <select aria-label="Batch" value={l.batchId} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, batchId: e.target.value } : x)))} className="rounded border border-line px-1 py-0.5">
            {!l.product.batches.length && <option value="">No stock batches</option>}
            {l.product.batches.map((b) => <option key={b.id} value={b.id}>{b.batchNo} · exp {formatDateIN(b.expiry)} · {b.qtyBase} {l.product.baseLabel} · {b.status}</option>)}
          </select>
          <input aria-label="Quantity change" value={l.delta} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, delta: e.target.value } : x)))}
            className="w-20 rounded border border-line px-1 py-0.5 text-right" title="Negative removes stock, positive adds" />
          <span className="text-xs text-muted">{l.product.baseLabel} (− remove / + add)</span>
          <button className="text-muted" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block rounded border border-line px-2 py-1">
          {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Note{needsNote && <span className="text-danger"> (required for Schedule X / NDPS)</span>}
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 block w-80 rounded border border-line px-2 py-1" placeholder="What happened, who checked" /></label>
        <button disabled={busy || !valid} className="rounded-md bg-brand-700 px-4 py-1.5 text-white disabled:opacity-40" onClick={async () => {
          setBusy(true); setMsg(null);
          const { data, error } = await supabaseBrowser()!.rpc("request_stock_adjustment", { p: { storeId, reason, note, lines: lines.map((l) => ({ batchId: l.batchId, qtyDelta: Number(l.delta) })) } });
          setBusy(false);
          if (error) { setMsg({ ok: false, text: error.message }); return; }
          setMsg({ ok: true, text: data.status === "approved" ? "Adjustment posted." : "Sent for owner/admin approval." });
          setLines([]); setNote(""); router.refresh();
        }}>{autoApproves ? "Post adjustment" : "Request approval"}</button>
      </div>
      {msg && <p role="status" className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</p>}
    </div>
  );
}

export function Decide({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = async (approve: boolean) => {
    const { error } = await supabaseBrowser()!.rpc("decide_stock_adjustment", { p_id: id, p_approve: approve, p_note: note || null });
    if (error) setErr(error.message); else router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input aria-label="Decision note" placeholder="note" value={note} onChange={(e) => setNote(e.target.value)} className="w-28 rounded border border-line px-1 py-0.5" />
      <button className="rounded bg-ok px-2 py-0.5 text-white" onClick={() => void go(true)}>Approve</button>
      <button className="rounded bg-danger px-2 py-0.5 text-white" onClick={() => void go(false)}>Reject</button>
      {err && <span className="w-full text-xs text-danger">{err}</span>}
    </div>
  );
}
