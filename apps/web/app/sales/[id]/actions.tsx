"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatINR, type DrugSchedule } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import type { StoreCtx } from "@/lib/types";
import { formatBillTime } from "@/components/pos/Receipt";
import { ScheduleBadge } from "@/components/ScheduleBadge";

export interface ReturnableLine { id: number; name: string; schedule: DrugSchedule; coldChain: boolean; batchNo: string; qtyBase: number; returnedQty: number; amountPaise: number; baseLabel: string }

export function CancelBill({ billId }: { billId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="rounded-md border border-danger px-3 py-1.5 text-sm text-danger" onClick={() => setOpen(true)}>Cancel bill</button>;
  return (
    <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      const { error } = await supabaseBrowser()!.rpc("cancel_sale", { p_bill: billId, p_reason: reason });
      if (error) { setErr(error.message); return; }
      setOpen(false); router.refresh();
    }}>
      <input autoFocus required minLength={5} placeholder="Reason (e.g. wrong item scanned)" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64 rounded border border-line px-2 py-1" />
      <button className="rounded bg-danger px-3 py-1 text-white">Confirm cancel</button>
      <button type="button" className="text-muted" onClick={() => setOpen(false)}>Keep bill</button>
      {err && <span className="w-full text-danger">{err}</span>}
    </form>
  );
}

interface CnPrint { no: string; at: Date; total: number; lines: Array<{ name: string; qty: number; label: string }>; mode: string; reason: string }

export function ReturnForm({ billId, lines, hasCustomer, composition, store, orgName, invoiceNo }: {
  billId: string; lines: ReturnableLine[]; hasCustomer: boolean; composition: boolean; store: StoreCtx; orgName: string; invoiceNo: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"cash" | "upi" | "card" | "account">(hasCustomer ? "account" : "cash");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [printed, setPrinted] = useState<CnPrint | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const chosen = lines.map((l) => ({ l, q: Math.floor(Number(qty[l.id] || 0)) })).filter((x) => x.q > 0);
  const estimate = chosen.reduce((s, { l, q }) => s + Math.round((l.amountPaise * q) / l.qtyBase), 0);
  const invalid = chosen.find(({ l, q }) => q > l.qtyBase - l.returnedQty);

  const submit = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabaseBrowser()!.rpc("post_sales_return", { p: {
      idempotencyKey: key, billId, reason, refundMode: mode,
      lines: chosen.map(({ l, q }) => ({ billLineId: l.id, qtyBase: q, restock: l.coldChain ? false : restock[l.id] ?? true })),
    } });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPrinted({ no: data.creditNoteNo, at: new Date(), total: Number(data.totalPaise), lines: chosen.map(({ l, q }) => ({ name: l.name, qty: q, label: l.baseLabel })), mode, reason });
    setQty({}); setReason(""); setKey(crypto.randomUUID());
    setTimeout(() => window.print(), 100);
    router.refresh();
  };

  return (
    <div className="space-y-3 text-sm">
      <table className="w-full">
        <thead className="text-left text-xs uppercase text-muted"><tr><th>Item</th><th>Batch</th><th className="text-right">Can return</th><th className="text-right">Return qty</th><th className="pl-4">Back on shelf?</th></tr></thead>
        <tbody>{lines.map((l) => {
          const left = l.qtyBase - l.returnedQty;
          return (
            <tr key={l.id} className="border-t border-line">
              <td className="py-1"><span className="flex items-center gap-2"><ScheduleBadge schedule={l.schedule} coldChain={l.coldChain} />{l.name}</span></td>
              <td className="font-mono">{l.batchNo}</td>
              <td className="num text-right">{left} {l.baseLabel}</td>
              <td className="text-right"><input aria-label={`Return quantity for ${l.name}`} disabled={!left} type="number" min={0} max={left} value={qty[l.id] ?? ""}
                onChange={(e) => setQty((x) => ({ ...x, [l.id]: e.target.value }))} className="w-20 rounded border border-line px-1 py-0.5 text-right" /></td>
              <td className="pl-4">{l.coldChain ? <span className="text-xs text-warn">No — cold chain, discard</span> :
                <label className="flex items-center gap-1"><input type="checkbox" checked={restock[l.id] ?? true} onChange={(e) => setRestock((x) => ({ ...x, [l.id]: e.target.checked }))} /> Restock (untick if damaged)</label>}</td>
            </tr>);
        })}</tbody>
      </table>
      <div className="flex flex-wrap items-end gap-3">
        <label>Reason<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. doctor changed prescription" className="mt-1 block w-72 rounded border border-line px-2 py-1" /></label>
        <label>Refund by<select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="mt-1 block rounded border border-line px-2 py-1">
          <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>{hasCustomer && <option value="account">Customer account (reduce udhaar)</option>}
        </select></label>
        <span className="num pb-1">≈ {formatINR(estimate)} (rounded to the rupee on the credit note)</span>
        <button disabled={busy || !chosen.length || !reason.trim() || !!invalid} onClick={() => void submit()} className="rounded-md bg-brand-700 px-4 py-1.5 text-white disabled:opacity-40">
          {busy ? "Saving…" : "Issue credit note"}</button>
      </div>
      {composition && <p className="text-xs text-muted">Composition store: the credit note carries no GST.</p>}
      {invalid && <p className="text-danger">{invalid.l.name}: only {invalid.l.qtyBase - invalid.l.returnedQty} left to return.</p>}
      {err && <p role="alert" className="text-danger">{err}</p>}
      {printed && <p role="status" className="text-ok">Credit note {printed.no} issued · {formatINR(printed.total)}. <button className="underline" onClick={() => window.print()}>Reprint</button></p>}
      {printed && (
        <div id="print-receipt" className="hidden font-mono text-[10px] leading-tight text-black print:block">
          <div className="text-center"><div className="text-[12px] font-bold">{orgName}</div><div>{store.name}</div><div>{store.address}</div>{store.gstin && <div>GSTIN: {store.gstin}</div>}
            <div className="mt-1 font-bold">CREDIT NOTE</div></div>
          <div>No: {printed.no} · {formatBillTime(printed.at)}</div>
          <div>Against invoice: {invoiceNo}</div>
          <hr className="my-1 border-black" />
          {printed.lines.map((l, i) => <div key={i}>{l.name} × {l.qty} {l.label}</div>)}
          <hr className="my-1 border-black" />
          <div className="flex justify-between text-[12px] font-bold"><span>REFUND</span><span>{formatINR(printed.total)}</span></div>
          <div>By {printed.mode === "account" ? "credit to customer account" : printed.mode.toUpperCase()} · {printed.reason}</div>
        </div>
      )}
    </div>
  );
}
