"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateIN, formatINR } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { escapeHtml as e, printHtml } from "@/lib/print";
import { inputCls } from "@/components/ui";
import { ScheduleBadge } from "@/components/ScheduleBadge";
import type { DrugSchedule } from "@medstar/core";

export interface BatchOpt {
  id: string; productName: string; schedule: DrugSchedule; batchNo: string; expiry: string; qty: number;
  unitsPerPack: number; packLabel: string; baseLabel: string; packMrpPaise: number;
}
export interface Branch { id: string; code: string; name: string; gstin: string | null; address: string | null }
export interface ChallanLine { name: string; schedule: string; batchNo: string; expiry: string; qty: number; label: string; mrpPaise: number }

/** Delivery challan: goods moved between branches of one GSTIN are not a supply — no tax invoice, a challan travels with them. */
export function printChallan(c: { no: string; at: string; from: Branch; to: Branch; orgName: string; note?: string | null; lines: ChallanLine[]; valuePaise: number }) {
  const controlled = c.lines.some((l) => ["H1", "X", "NDPS"].includes(l.schedule));
  printHtml(`Delivery challan ${c.no}`, `
    <div class="head"><div><h1>DELIVERY CHALLAN</h1><div>${e(c.orgName)}</div><div class="muted">Stock transfer between branches · not a sale</div></div>
      <div><b>${e(c.no)}</b><br>${e(new Date(c.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}${c.from.gstin ? `<br>GSTIN ${e(c.from.gstin)}` : ""}</div></div>
    <table><tr><th>From</th><th>To</th></tr><tr><td><b>${e(c.from.code)}</b> ${e(c.from.name)}<br>${e(c.from.address ?? "")}</td>
      <td><b>${e(c.to.code)}</b> ${e(c.to.name)}<br>${e(c.to.address ?? "")}</td></tr></table><br>
    <table><tr><th>#</th><th>Item</th><th>Sch.</th><th>Batch</th><th>Expiry</th><th class="r">Qty</th><th class="r">MRP / pack</th></tr>
      ${c.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${e(l.name)}</td><td>${e(l.schedule)}</td><td>${e(l.batchNo)}</td><td>${e(formatDateIN(l.expiry))}</td>
        <td class="r">${l.qty} ${e(l.label)}</td><td class="r">${e(formatINR(l.mrpPaise))}</td></tr>`).join("")}</table>
    <p>Value at cost: <b>${e(formatINR(c.valuePaise))}</b>${c.note ? ` · Note: ${e(c.note)}` : ""}</p>
    ${controlled ? "<p><b>Contains Schedule H1 / X / NDPS items</b> — receiving pharmacist to check quantities against this challan and sign.</p>" : ""}
    <div class="sign"><div>Sent by (name & signature)<br><br>______________________</div><div>Received by (name & signature)<br><br>______________________</div></div>`, "a4-portrait");
}

interface Line { batch: BatchOpt; packs: number; loose: number }

export function NewTransfer({ fromStore, branches, batches, orgName }: { fromStore: Branch; branches: Branch[]; batches: BatchOpt[]; orgName: string }) {
  const router = useRouter();
  const eligible = branches.filter((b) => b.id !== fromStore.id && (b.gstin ?? "") === (fromStore.gstin ?? ""));
  const [to, setTo] = useState(eligible[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return batches.filter((b) => !lines.some((l) => l.batch.id === b.id) && `${b.productName} ${b.batchNo}`.toLowerCase().includes(s)).slice(0, 12);
  }, [q, batches, lines]);
  const qtyOf = (l: Line) => l.packs * l.batch.unitsPerPack + l.loose;

  if (!eligible.length) {
    return <p className="rounded border border-warn bg-warn/10 p-3 text-sm">No other branch shares this branch&apos;s GSTIN{fromStore.gstin ? ` (${fromStore.gstin})` : ""}. Transfers are only between branches under one GSTIN; add the second branch in Settings with the same GSTIN.</p>;
  }
  return (
    <form className="space-y-3 text-sm" onSubmit={async (ev) => {
      ev.preventDefault(); setMsg(null);
      const bad = lines.find((l) => qtyOf(l) <= 0 || qtyOf(l) > l.batch.qty);
      if (!lines.length || bad) { setMsg({ ok: false, text: bad ? `Check the quantity for ${bad.batch.productName}` : "Add at least one item" }); return; }
      setBusy(true);
      const { data, error } = await supabaseBrowser()!.rpc("post_stock_transfer", { p: {
        idempotencyKey: key, fromStoreId: fromStore.id, toStoreId: to, note: note || null,
        lines: lines.map((l) => ({ batchId: l.batch.id, qtyBase: qtyOf(l) })),
      } });
      setBusy(false);
      if (error) { setMsg({ ok: false, text: error.message }); return; }
      const toB = eligible.find((b) => b.id === to)!;
      printChallan({ no: data.transferNo, at: new Date().toISOString(), from: fromStore, to: toB, orgName, note, valuePaise: Number(data.valuePaise ?? 0),
        lines: lines.map((l) => ({ name: l.batch.productName, schedule: l.batch.schedule, batchNo: l.batch.batchNo, expiry: l.batch.expiry, qty: qtyOf(l), label: l.batch.baseLabel, mrpPaise: l.batch.packMrpPaise })) });
      setMsg({ ok: true, text: `Sent ${data.transferNo} to ${toB.code}. The challan is printing; ${toB.code} receives it from this screen.` });
      setLines([]); setNote(""); setKey(crypto.randomUUID()); router.refresh();
    }}>
      <div className="grid grid-cols-3 gap-3">
        <label>From<input disabled value={`${fromStore.code} · ${fromStore.name}`} className={inputCls} /></label>
        <label>To branch<select value={to} onChange={(ev) => setTo(ev.target.value)} className={inputCls}>
          {eligible.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></label>
        <label>Note<input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. weekend top-up, sent with Ravi" className={inputCls} /></label>
      </div>
      <div className="relative">
        <input aria-label="Search item to send" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search item or batch to send…" className={inputCls} />
        {hits.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded border border-line bg-surface shadow">
            {hits.map((b) => (
              <li key={b.id}><button type="button" className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-canvas"
                onClick={() => { setLines((ls) => [...ls, { batch: b, packs: 0, loose: 0 }]); setQ(""); }}>
                <span className="flex items-center gap-2"><ScheduleBadge schedule={b.schedule} />{b.productName} <span className="font-mono text-xs">{b.batchNo}</span></span>
                <span className="text-muted">exp {formatDateIN(b.expiry)} · {Math.floor(b.qty / b.unitsPerPack)} {b.packLabel}{b.qty % b.unitsPerPack ? ` + ${b.qty % b.unitsPerPack} ${b.baseLabel}` : ""}</span>
              </button></li>))}
          </ul>)}
      </div>
      {lines.length > 0 && (
        <table className="w-full">
          <thead><tr className="text-left text-xs uppercase text-muted"><th>Item</th><th>Batch</th><th>In stock</th><th className="w-24">Packs</th><th className="w-24">Loose</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={l.batch.id} className="border-t border-line">
              <td className="py-1"><span className="flex items-center gap-2"><ScheduleBadge schedule={l.batch.schedule} />{l.batch.productName}</span></td>
              <td className="font-mono text-xs">{l.batch.batchNo} · {formatDateIN(l.batch.expiry)}</td>
              <td className="text-muted">{l.batch.qty} {l.batch.baseLabel}</td>
              <td><input aria-label="Packs" type="number" min={0} value={l.packs} onChange={(ev) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, packs: Number(ev.target.value) } : x))} className="w-20 rounded border border-line px-1" /> {l.batch.packLabel}</td>
              <td><input aria-label="Loose units" type="number" min={0} value={l.loose} onChange={(ev) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, loose: Number(ev.target.value) } : x))} className="w-20 rounded border border-line px-1" /> {l.batch.baseLabel}</td>
              <td><button type="button" aria-label="Remove" className="text-muted" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button></td>
            </tr>))}</tbody>
        </table>)}
      <div className="flex items-center gap-3">
        <button disabled={busy || !lines.length} className="rounded-md bg-brand-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Sending…" : "Send & print challan"}</button>
        {msg && <span role="status" className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</span>}
      </div>
    </form>
  );
}

export function ReceiveTransfer({ id, lines }: { id: string; lines: Array<{ id: number; name: string; qty: number; label: string }> }) {
  const router = useRouter();
  const [rq, setRq] = useState<Record<number, number>>(() => Object.fromEntries(lines.map((l) => [l.id, l.qty])));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const short = lines.some((l) => (rq[l.id] ?? l.qty) < l.qty);
  return (
    <form className="mt-2 space-y-2 text-sm" onSubmit={async (ev) => {
      ev.preventDefault(); setErr(null);
      const { error } = await supabaseBrowser()!.rpc("receive_stock_transfer", { p_transfer: id, p_lines: lines.map((l) => ({ lineId: l.id, receivedQty: rq[l.id] ?? l.qty })), p_note: note || null });
      if (error) setErr(error.message); else router.refresh();
    }}>
      <table className="w-full"><tbody>{lines.map((l) => (
        <tr key={l.id} className="border-t border-line"><td className="py-1">{l.name}</td><td className="text-muted">sent {l.qty} {l.label}</td>
          <td className="text-right">received <input aria-label={`Received ${l.name}`} type="number" min={0} max={l.qty} value={rq[l.id] ?? l.qty}
            onChange={(ev) => setRq((r) => ({ ...r, [l.id]: Number(ev.target.value) }))} className="w-20 rounded border border-line px-1 text-right" /></td></tr>))}</tbody></table>
      {short && <input required minLength={5} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What happened to the missing items?" className={inputCls} />}
      <button className="rounded bg-ok px-3 py-1.5 text-white">{short ? "Receive with shortage" : "Receive all"}</button>
      {err && <p className="text-danger">{err}</p>}
    </form>
  );
}

export function CancelTransfer({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="text-xs text-danger underline" onClick={() => setOpen(true)}>Cancel transfer</button>;
  return (
    <form className="flex flex-wrap gap-1" onSubmit={async (ev) => {
      ev.preventDefault();
      const { error } = await supabaseBrowser()!.rpc("cancel_stock_transfer", { p_transfer: id, p_reason: reason });
      if (error) setErr(error.message); else router.refresh();
    }}>
      <input required minLength={5} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Reason" className="rounded border border-line px-1 text-xs" />
      <button className="rounded bg-danger px-2 text-xs text-white">Cancel & put stock back</button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </form>
  );
}

export function ReprintChallan(props: Parameters<typeof printChallan>[0]) {
  return <button className="text-xs text-brand-700 underline" onClick={() => printChallan(props)}>Print challan</button>;
}
