"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase";
import { formatBillTime } from "@/components/pos/Receipt";

export function RecallForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [f, setF] = useState({ productName: "", manufacturer: "", batchNo: "", reason: "", source: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const cls = "mt-1 block w-full rounded border border-line px-2 py-1";
  return (
    <form className="grid grid-cols-3 gap-2 text-sm" onSubmit={async (e) => {
      e.preventDefault();
      const { data, error } = await supabaseBrowser()!.rpc("create_recall", { p_org: orgId, p: f });
      if (error) { setMsg({ ok: false, text: error.message }); return; }
      setMsg({ ok: true, text: data.quarantined ? `${data.quarantined} batch(es) quarantined.` : "Recorded — no matching batch in stock right now (future GRNs are not auto-blocked; check before receiving)." });
      setF({ productName: "", manufacturer: "", batchNo: "", reason: "", source: "" });
      router.refresh();
    }}>
      <label>Product name (as on pack)<input required className={cls} value={f.productName} onChange={set("productName")} /></label>
      <label>Manufacturer<input className={cls} value={f.manufacturer} onChange={set("manufacturer")} /></label>
      <label>Batch no.<input required className={cls} value={f.batchNo} onChange={set("batchNo")} /></label>
      <label className="col-span-2">Reason<input required className={cls} value={f.reason} onChange={set("reason")} placeholder="e.g. Not of Standard Quality — dissolution" /></label>
      <label>Source<input className={cls} value={f.source} onChange={set("source")} placeholder="CDSCO NSQ list, manufacturer letter…" /></label>
      <button className="col-span-3 justify-self-start rounded bg-danger px-3 py-1.5 text-white">Record recall & quarantine</button>
      {msg && <p className={`col-span-3 ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </form>
  );
}

interface Impact { batches: Array<{ batchId: string; store: string; product: string; batchNo: string; qtyOnHand: number; status: string }>; buyers: Array<{ invoiceNo: string; billedAt: string; customer: string | null; phone: string | null; qtyBase: number }> }

export function RecallImpact({ recallId, canRelease }: { recallId: string; canRelease: boolean }) {
  const router = useRouter();
  const [imp, setImp] = useState<Impact | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    const { data, error } = await supabaseBrowser()!.rpc("recall_impact", { p_recall: recallId });
    if (error) setErr(error.message); else setImp(data as Impact);
  };
  useEffect(() => { void load(); }, [recallId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <p className="text-danger">{err}</p>;
  if (!imp) return <p className="text-muted">Loading impact…</p>;
  return (
    <div className="mt-2 grid grid-cols-2 gap-4">
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted">Batches</h3>
        {imp.batches.map((b) => (
          <div key={b.batchId} className="flex items-center gap-2">{b.store} · {b.product} · {b.qtyOnHand} on hand · <span className={b.status === "recalled" ? "text-danger" : ""}>{b.status}</span>
            {canRelease && b.status === "recalled" && <button className="text-xs text-brand-700 underline" onClick={async () => {
              const reason = window.prompt("Why release this batch? (e.g. manufacturer withdrew the alert)");
              if (!reason) return;
              const { error } = await supabaseBrowser()!.rpc("set_batch_status", { p_batch: b.batchId, p_status: "active", p_reason: reason });
              if (error) setErr(error.message); else { await load(); router.refresh(); }
            }}>release</button>}
          </div>))}
        {!imp.batches.length && <p className="text-muted">None in stock.</p>}
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted">Customers who bought it</h3>
        {imp.buyers.map((b, i) => <div key={i}>{b.customer ?? "Walk-in"} {b.phone && <a className="font-mono text-brand-700" href={`tel:${b.phone}`}>{b.phone}</a>} · {b.qtyBase} · {b.invoiceNo} · {formatBillTime(new Date(b.billedAt))}</div>)}
        {!imp.buyers.length && <p className="text-muted">No sales of these batches.</p>}
      </div>
    </div>
  );
}
