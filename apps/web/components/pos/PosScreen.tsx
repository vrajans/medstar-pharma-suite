"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allocateFefo, computeBill, formatINR, hasBlockingIssue, provisionalNo, requiresRegister, requiresRx,
  StockError, validateCounterSale, type Allocation, type ComplianceIssue, type LineInput, type PrescriptionInfo,
} from "@medstar/core";
import { DEMO_PHARMACIST, DEMO_STORE, searchProducts, type PosProduct } from "@/lib/demo-data";
import { enqueueBill, nextLocalSeq, syncOutbox } from "@/lib/outbox";
import { DEMO_MODE } from "@/lib/supabase";
import { ScheduleBadge } from "@/components/ScheduleBadge";

type Unit = "pack" | "base";
interface CartLine { key: string; product: PosProduct; qty: number; unit: Unit; discountPct: number }
type PayMode = "cash" | "upi" | "card" | "credit";

const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export function PosScreen() {
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [rx, setRx] = useState<PrescriptionInfo>({});
  const [showRx, setShowRx] = useState(false);
  const [approved, setApproved] = useState(false);
  const [pin, setPin] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [tendered, setTendered] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [lastReceipt, setLastReceipt] = useState<{ no: string; total: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const today = todayIST();

  const results = useMemo(() => searchProducts(query), [query]);

  // line → FEFO allocations
  const priced = useMemo(() => cart.map((l) => {
    const qtyBase = l.unit === "pack" ? l.qty * l.product.unitsPerPack : l.qty;
    try {
      return { line: l, qtyBase, allocs: allocateFefo(l.product.batches, qtyBase, today) as Allocation[], error: null as string | null };
    } catch (e) {
      return { line: l, qtyBase, allocs: [] as Allocation[], error: e instanceof StockError ? e.message : String(e) };
    }
  }), [cart, today]);

  const bill = useMemo(() => {
    const inputs: LineInput[] = priced.flatMap((p) => p.allocs.map((a) => ({
      packMrpPaise: a.packMrpPaise, unitsPerPack: p.line.product.unitsPerPack, qtyBase: a.qtyBase,
      discountPct: p.line.discountPct, gstRate: p.line.product.gstRate, hsn: p.line.product.hsn,
    })));
    return inputs.length ? computeBill(inputs, { scheme: DEMO_STORE.scheme }) : null;
  }, [priced]);

  const issues: ComplianceIssue[] = useMemo(() => validateCounterSale(
    cart.map((l) => ({ id: l.product.id, name: l.product.name, schedule: l.product.schedule, habitForming: l.product.habitForming })),
    { rx, pharmacistOnDuty: true, pharmacistApproved: approved, today, policy: { pharmacistPresence: "hard", rxValidityDays: 180 } },
  ), [cart, rx, approved, today]);

  const needsRx = cart.some((l) => requiresRx(l.product));
  const needsRegister = cart.some((l) => requiresRegister(l.product));
  const stockErrors = priced.filter((p) => p.error);
  const canSave = !!bill && !hasBlockingIssue(issues) && stockErrors.length === 0;

  const flash = (kind: "ok" | "err", text: string) => { setToast({ kind, text }); setTimeout(() => setToast(null), 3500); };

  const addProduct = useCallback((p: PosProduct) => {
    const sellable = p.batches.some((b) => b.status === "active" && b.expiry >= today && b.qtyBase > 0);
    if (!sellable) { flash("err", `${p.name}: no sellable batch (expired / recalled / out of stock)`); return; }
    setCart((c) => {
      const existing = c.find((l) => l.product.id === p.id && l.unit === "pack");
      if (existing) return c.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key: crypto.randomUUID(), product: p, qty: 1, unit: "pack", discountPct: 0 }];
    });
    setQuery(""); setHi(0);
    if (requiresRx(p)) setApproved(false);
    searchRef.current?.focus();
  }, [today]);

  const reset = () => { setCart([]); setRx({}); setApproved(false); setPin(""); setTendered(""); setPayMode("cash"); searchRef.current?.focus(); };

  const save = useCallback(async () => {
    if (!bill || !canSave) { flash("err", issues.find((i) => i.severity === "block")?.message ?? stockErrors[0]?.error ?? "Nothing to save"); return; }
    if (payMode === "cash" && tendered && Number(tendered) * 100 < bill.totalPaise) { flash("err", "Cash tendered is less than bill total"); return; }
    const seq = await nextLocalSeq();
    const billUuid = crypto.randomUUID();
    const prov = provisionalNo("POS1", seq);
    await enqueueBill({
      billUuid, provisionalNo: prov, totalPaise: bill.totalPaise,
      payload: {
        billUuid, storeId: DEMO_STORE.id, deviceCode: "POS1", provisionalNo: prov, billedAt: new Date().toISOString(), offline: !navigator.onLine,
        billDiscountPct: 0,
        lines: priced.flatMap((p) => p.allocs.map((a) => ({ productId: p.line.product.id, qtyBase: a.qtyBase, batchId: a.batchId, discountPct: p.line.discountPct }))),
        payments: [{ mode: payMode, amountPaise: bill.totalPaise }],
        prescription: needsRx ? { ...rx, rxDate: rx.rxDate || undefined } : undefined,
        pharmacistId: needsRx ? DEMO_PHARMACIST.id : undefined,
      },
    });
    setLastReceipt({ no: prov, total: bill.totalPaise });
    flash("ok", `Saved ${prov} · ${formatINR(bill.totalPaise)}${DEMO_MODE ? " (demo — stored locally)" : ""}`);
    setPending((await syncOutbox()).pending);
    reset();
  }, [bill, canSave, issues, stockErrors, payMode, tendered, priced, needsRx, rx]);

  // keyboard-first (UC-POS-13)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "F8") { e.preventDefault(); setPayMode((m) => (["cash", "upi", "card", "credit"] as PayMode[])[(["cash", "upi", "card", "credit"].indexOf(m) + 1) % 4]!); }
      else if (e.key === "F10") { e.preventDefault(); void save(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "r") { e.preventDefault(); setShowRx(true); }
      else if (e.key === "Escape") { setShowRx(false); setQuery(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd(); window.addEventListener("online", upd); window.addEventListener("offline", upd);
    void syncOutbox().then((r) => setPending(r.pending));
    return () => { window.removeEventListener("online", upd); window.removeEventListener("offline", upd); };
  }, []);

  const change = payMode === "cash" && bill && tendered ? Math.round(Number(tendered) * 100) - bill.totalPaise : null;

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-[1400px] flex-col gap-2 p-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <strong>{DEMO_STORE.name}</strong>
          <span className="text-muted">Pharmacist on duty: {DEMO_PHARMACIST.name} ({DEMO_PHARMACIST.regNo}) ✅</span>
        </div>
        <div className="flex items-center gap-3">
          {pending > 0 && <span className="rounded bg-warn/10 px-2 py-0.5 text-warn">{pending} bill(s) waiting to sync</span>}
          <span className={online ? "text-ok" : "text-danger"}>● {online ? "Online" : "Offline — billing continues"}</span>
          {DEMO_MODE && <span className="rounded bg-brand-100 px-2 py-0.5 text-brand-900">Demo data</span>}
        </div>
      </div>

      {/* search */}
      <div className="relative">
        <label className="sr-only" htmlFor="pos-search">Search product or scan barcode</label>
        <input id="pos-search" ref={searchRef} autoFocus value={query} autoComplete="off"
          onChange={(e) => { setQuery(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === "Enter" && results[hi]) addProduct(results[hi]!);
          }}
          placeholder="F2 · Search brand / salt / barcode (try: dolo, azith, alpra, insulin, pan, codeine)"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base shadow-sm" />
        {results.length > 0 && (
          <ul role="listbox" className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-surface shadow-lg">
            {results.map((p, i) => {
              const stock = p.batches.filter((b) => b.status === "active" && b.expiry >= today).reduce((s, b) => s + b.qtyBase, 0);
              return (
                <li key={p.id} role="option" aria-selected={i === hi} onMouseDown={() => addProduct(p)}
                  className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${i === hi ? "bg-brand-50" : ""}`}>
                  <span className="flex items-center gap-2"><ScheduleBadge schedule={p.schedule} coldChain={p.coldChain} /> {p.name}
                    <span className="text-muted">· {p.composition} · {p.manufacturer}</span></span>
                  <span className="num text-muted">Stock {Math.floor(stock / p.unitsPerPack)} {p.packLabel} · Rack {p.rack}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* cart */}
      <div className="flex-1 overflow-auto rounded-md border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-canvas text-left text-xs uppercase text-muted">
            <tr><th className="p-2">#</th><th>Item</th><th>Batch · Exp</th><th>Unit</th><th className="text-right">Qty</th><th className="text-right">MRP</th><th className="text-right">Disc %</th><th className="text-right">GST</th><th className="p-2 text-right">Amount</th><th /></tr>
          </thead>
          <tbody>
            {priced.map(({ line, allocs, error }, idx) => {
              const amount = bill?.lines.slice(priced.slice(0, idx).reduce((s, p) => s + p.allocs.length, 0)).slice(0, allocs.length).reduce((s, l) => s + l.amountPaise, 0) ?? 0;
              return (
                <tr key={line.key} className="border-t border-line align-top">
                  <td className="p-2 text-muted">{idx + 1}</td>
                  <td className="py-2"><div className="flex items-center gap-2"><ScheduleBadge schedule={line.product.schedule} coldChain={line.product.coldChain} />{line.product.name}</div>
                    {error && <div className="text-xs text-danger">{error}</div>}</td>
                  <td className="py-2 num text-xs">{allocs.map((a) => (
                    <div key={a.batchId} className={a.nearExpiry ? "text-warn" : ""}>{a.batchNo} · {a.expiry.slice(5, 7)}/{a.expiry.slice(2, 4)}{a.nearExpiry && " ⚠ near expiry"} ({a.qtyBase})</div>))}</td>
                  <td className="py-2">
                    <select aria-label="Unit" value={line.unit} className="rounded border border-line px-1"
                      onChange={(e) => setCart((c) => c.map((x) => (x.key === line.key ? { ...x, unit: e.target.value as Unit } : x)))}>
                      <option value="pack">{line.product.packLabel}</option>
                      {line.product.unitsPerPack > 1 && <option value="base">{line.product.baseLabel}</option>}
                    </select>
                  </td>
                  <td className="py-2 text-right"><input aria-label="Quantity" type="number" min={1} value={line.qty} className="num w-16 rounded border border-line px-1 text-right"
                    onChange={(e) => setCart((c) => c.map((x) => (x.key === line.key ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} /></td>
                  <td className="num py-2 text-right">{formatINR(allocs[0]?.packMrpPaise ?? line.product.batches[0]!.packMrpPaise)}</td>
                  <td className="py-2 text-right"><input aria-label="Discount percent" type="number" min={0} max={20} value={line.discountPct} className="num w-14 rounded border border-line px-1 text-right"
                    onChange={(e) => setCart((c) => c.map((x) => (x.key === line.key ? { ...x, discountPct: Math.min(20, Math.max(0, Number(e.target.value) || 0)) } : x)))} /></td>
                  <td className="num py-2 text-right">{line.product.gstRate}%</td>
                  <td className="num p-2 text-right font-medium">{formatINR(amount)}</td>
                  <td className="py-2"><button aria-label={`Remove ${line.product.name}`} className="px-2 text-muted hover:text-danger"
                    onClick={() => setCart((c) => c.filter((x) => x.key !== line.key))}>✕</button></td>
                </tr>
              );
            })}
            {!cart.length && <tr><td colSpan={10} className="p-8 text-center text-muted">Scan a barcode or press F2 to search</td></tr>}
          </tbody>
        </table>
      </div>

      {/* compliance */}
      {needsRx && (
        <div className={`flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm ${hasBlockingIssue(issues) ? "border-sch-h1 bg-sch-h1/5" : "border-ok bg-ok/5"}`}>
          <span className="font-medium">{needsRegister ? "Schedule H1 / X / NDPS — register entry required" : "Prescription medicine"}</span>
          {issues.map((i) => <span key={i.code + (i.productId ?? "")} className={i.severity === "block" ? "text-danger" : "text-warn"}>• {i.message}</span>)}
          <button className="rounded border border-line bg-surface px-2 py-1" onClick={() => setShowRx(true)}><kbd>Ctrl+R</kbd> Add Rx</button>
          {!approved && (
            <span className="flex items-center gap-1">
              <input aria-label="Pharmacist PIN" type="password" inputMode="numeric" placeholder="Pharmacist PIN" value={pin} onChange={(e) => setPin(e.target.value)} className="w-32 rounded border border-line px-2 py-1" />
              <button className="rounded bg-brand-700 px-2 py-1 text-white" onClick={() => { if (pin === DEMO_PHARMACIST.pin) { setApproved(true); setPin(""); } else flash("err", "Wrong PIN"); }}>Approve</button>
              <span className="text-xs text-muted">(demo PIN 1234)</span>
            </span>
          )}
          {approved && <span className="text-ok">✓ Approved by {DEMO_PHARMACIST.name}</span>}
        </div>
      )}

      {/* totals & payment */}
      <div className="flex items-center justify-between rounded-md border border-line bg-surface p-3">
        <div className="num flex gap-5 text-sm text-muted">
          <span>Items {cart.length}</span>
          <span>Taxable {formatINR(bill?.taxablePaise ?? 0)}</span>
          <span>CGST {formatINR(bill?.cgstPaise ?? 0)}</span>
          <span>SGST {formatINR(bill?.sgstPaise ?? 0)}</span>
          <span>Discount {formatINR(bill?.discountPaise ?? 0)}</span>
          <span>Round-off {formatINR(bill?.roundOffPaise ?? 0)}</span>
        </div>
        <div className="flex items-center gap-3">
          <div role="radiogroup" aria-label="Payment mode" className="flex overflow-hidden rounded border border-line text-sm">
            {(["cash", "upi", "card", "credit"] as PayMode[]).map((m) => (
              <button key={m} role="radio" aria-checked={payMode === m} onClick={() => setPayMode(m)}
                className={`px-3 py-1 uppercase ${payMode === m ? "bg-brand-700 text-white" : "bg-surface"}`}>{m}</button>))}
          </div>
          {payMode === "cash" && <input aria-label="Cash tendered" placeholder="Tendered ₹" value={tendered} onChange={(e) => setTendered(e.target.value)} className="num w-24 rounded border border-line px-2 py-1 text-right" />}
          {change !== null && change >= 0 && <span className="num text-sm">Change {formatINR(change)}</span>}
          <span className="num text-2xl font-semibold">{formatINR(bill?.totalPaise ?? 0)}</span>
          <button disabled={!canSave} onClick={() => void save()} className="rounded-md bg-brand-700 px-4 py-2 font-medium text-white disabled:opacity-40">
            <kbd className="mr-1 bg-transparent text-white">F10</kbd> Save & Print
          </button>
        </div>
      </div>
      <div className="text-xs text-muted"><kbd>F2</kbd> search · <kbd>↑↓</kbd> pick · <kbd>Enter</kbd> add · <kbd>F8</kbd> payment mode · <kbd>Ctrl+R</kbd> prescription · <kbd>F10</kbd> save · <kbd>Esc</kbd> close
        {lastReceipt && <span className="ml-4">Last bill {lastReceipt.no} · {formatINR(lastReceipt.total)}</span>}</div>

      {toast && <div role="status" className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md px-4 py-2 text-white shadow-lg ${toast.kind === "ok" ? "bg-ok" : "bg-danger"}`}>{toast.text}</div>}

      {showRx && (
        <div role="dialog" aria-modal="true" aria-label="Prescription details" className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <form className="w-[520px] space-y-2 rounded-lg bg-surface p-4 shadow-xl" onSubmit={(e) => { e.preventDefault(); setShowRx(false); searchRef.current?.focus(); }}>
            <h2 className="font-semibold">Prescription details</h2>
            {([
              ["patientName", "Patient name"], ["patientAddress", "Patient address"], ["prescriberName", "Doctor name"],
              ["prescriberRegNo", "Doctor registration no. (e.g. KMC-12345)"], ["prescriberAddress", "Doctor / clinic address"], ["rxDate", "Prescription date"],
            ] as Array<[keyof PrescriptionInfo, string]>).map(([k, label]) => (
              <label key={k} className="block text-sm">{label}
                <input type={k === "rxDate" ? "date" : "text"} value={rx[k] ?? ""} onChange={(e) => setRx((r) => ({ ...r, [k]: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-line px-2 py-1" />
              </label>))}
            <label className="block text-sm">Prescription copy (required for Schedule X / NDPS)
              <input type="file" accept="image/*,application/pdf" capture="environment" className="mt-0.5 block w-full text-sm"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setRx((r) => ({ ...r, rxImagePath: `prescriptions/${DEMO_STORE.id}/${crypto.randomUUID()}-${f.name}` })); }} />
            </label>
            {rx.rxImagePath && <p className="text-xs text-ok">✓ Copy attached — uploaded to the private prescriptions bucket on sync</p>}
            <p className="text-xs text-muted">Stored privately; access is logged (DPDP).</p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="rounded border border-line px-3 py-1" onClick={() => setShowRx(false)}>Cancel</button>
              <button className="rounded bg-brand-700 px-3 py-1 text-white">Done</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
