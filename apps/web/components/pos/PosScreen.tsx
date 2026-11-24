"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  allocateFefo, computeBill, formatINR, hasBlockingIssue, provisionalNo, requiresRegister, requiresRx,
  StockError, validateCounterSale, type Allocation, type ComplianceIssue, type LineInput, type PrescriptionInfo,
} from "@medstar/core";
import { DEMO_PHARMACIST, searchProducts as searchDemo } from "@/lib/demo-data";
import { decrementLocalStock, refreshCatalogue, searchLocal, searchRemote, type PosProduct } from "@/lib/catalogue";
import { postSaleNow, retryBill, syncOutbox, type OutboxBill } from "@/lib/outbox";
import { deviceCode, nextLocalSeq } from "@/lib/pos-db";
import { supabaseBrowser } from "@/lib/supabase";
import type { StoreCtx } from "@/lib/types";
import { ScheduleBadge } from "@/components/ScheduleBadge";
import { Receipt, type ReceiptData } from "./Receipt";
import { billWhatsAppLink, printA4Invoice } from "./share";
import { CustomerDialog, DoctorLookup, type PosCustomer } from "./PartyPickers";
import { ShiftPanel } from "./ShiftPanel";

export interface PosCtx {
  mode: "demo" | "live";
  orgId: string;
  orgName: string;
  store: StoreCtx;
  maxDiscountPct: number;
  pharmacists: Array<{ id: string; name: string; regNo: string }>;
  isManager?: boolean;
}

type Unit = "pack" | "base";
interface CartLine { key: string; product: PosProduct; qty: number; unit: Unit; discountPct: number }
type PayMode = "cash" | "upi" | "card" | "credit";
interface Approval { pharmacistId: string; name: string; regNo: string; approvalId?: string; offline?: boolean }

const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]/g, "_").slice(-60);

export function PosScreen({ ctx }: { ctx: PosCtx }) {
  const router = useRouter();
  const live = ctx.mode === "live";
  const store = ctx.store;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosProduct[]>([]);
  const [hi, setHi] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [rx, setRx] = useState<PrescriptionInfo>({});
  const [rxFile, setRxFile] = useState<File | null>(null);
  const [showRx, setShowRx] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [pin, setPin] = useState("");
  const [pinPharmacist, setPinPharmacist] = useState(store.onDuty[0]?.id ?? "");
  const [dutyDialog, setDutyDialog] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [tendered, setTendered] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [sync, setSync] = useState<{ pending: number; failed: OutboxBill[] }>({ pending: 0, failed: [] });
  const [catalogueInfo, setCatalogueInfo] = useState<string>("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [autoPrint, setAutoPrint] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [paidNow, setPaidNow] = useState("");
  const [shiftRefresh, setShiftRefresh] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const today = todayIST();
  const pharmacistOnDuty = !live || store.onDuty.length > 0;
  const hasCredit = !!customer && customer.creditLimitPaise > 0;
  const PAY_MODES = useMemo<PayMode[]>(() => (hasCredit ? ["cash", "upi", "card", "credit"] : ["cash", "upi", "card"]), [hasCredit]);

  const flash = useCallback((kind: "ok" | "err" | "warn", text: string) => { setToast({ kind, text }); setTimeout(() => setToast(null), 5000); }, []);

  // ── catalogue cache & sync status ──
  const refreshAll = useCallback(async () => {
    if (!live) return;
    try {
      const n = await refreshCatalogue(store.id);
      setCatalogueInfo(`${n} stocked items · updated ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (e) {
      setCatalogueInfo(`catalogue refresh failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [live, store.id]);

  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener("online", upd); window.addEventListener("offline", upd);
    try { setAutoPrint(localStorage.getItem("ms_autoprint") !== "0"); } catch { /* storage unavailable */ }
    void refreshAll();
    void syncOutbox().then((r) => setSync(r));
    const t = setInterval(() => { void syncOutbox().then(setSync); }, 30_000);
    const c = setInterval(() => void refreshAll(), 10 * 60_000);
    return () => { window.removeEventListener("online", upd); window.removeEventListener("offline", upd); clearInterval(t); clearInterval(c); };
  }, [refreshAll]);

  // ── search: local cache first (instant, offline-safe), then server when online ──
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    let cancelled = false;
    void (async () => {
      const local = live ? await searchLocal(store.id, q) : searchDemo(q);
      if (!cancelled) setResults(local);
      if (live && navigator.onLine && q.length >= 2) {
        await new Promise((r) => setTimeout(r, 180));
        if (cancelled) return;
        const remote = await searchRemote(store.id, q);
        if (!cancelled && remote.length) {
          const seen = new Set(local.map((p) => p.id));
          setResults([...local, ...remote.filter((p) => !seen.has(p.id))].slice(0, 8));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [query, live, store.id]);

  // ── pricing ──
  const priced = useMemo(() => cart.map((l) => {
    const qtyBase = l.unit === "pack" ? l.qty * l.product.unitsPerPack : l.qty;
    if (l.product.gstRate < 0) return { line: l, qtyBase, allocs: [] as Allocation[], error: `No GST rate configured for HSN ${l.product.hsn}` };
    try {
      return { line: l, qtyBase, allocs: allocateFefo(l.product.batches, qtyBase, today, { nearExpiryDays: store.nearExpiryDays }), error: null as string | null };
    } catch (e) {
      return { line: l, qtyBase, allocs: [] as Allocation[], error: e instanceof StockError ? e.message : String(e) };
    }
  }), [cart, today, store.nearExpiryDays]);

  const bill = useMemo(() => {
    const inputs: LineInput[] = priced.flatMap((p) => p.allocs.map((a) => ({
      packMrpPaise: a.packMrpPaise, unitsPerPack: p.line.product.unitsPerPack, qtyBase: a.qtyBase,
      discountPct: p.line.discountPct, gstRate: p.line.product.gstRate, hsn: p.line.product.hsn,
    })));
    return inputs.length ? computeBill(inputs, { scheme: store.gstScheme }) : null;
  }, [priced, store.gstScheme]);

  const issues: ComplianceIssue[] = useMemo(() => validateCounterSale(
    cart.map((l) => ({ id: l.product.id, name: l.product.name, schedule: l.product.schedule, rxRequired: l.product.rxRequired, habitForming: l.product.habitForming })),
    { rx: { ...rx, rxImagePath: rxFile ? "pending-upload" : rx.rxImagePath }, pharmacistOnDuty, pharmacistApproved: !!approval, today,
      policy: { pharmacistPresence: store.pharmacistPresence, rxValidityDays: store.rxValidityDays } },
  ), [cart, rx, rxFile, approval, pharmacistOnDuty, today, store.pharmacistPresence, store.rxValidityDays]);

  const needsRx = cart.some((l) => requiresRx(l.product));
  const needsRegister = cart.some((l) => requiresRegister(l.product));
  const stockErrors = priced.filter((p) => p.error);
  const canSave = !!bill && !busy && !hasBlockingIssue(issues) && stockErrors.length === 0;

  const addProduct = useCallback((p: PosProduct) => {
    if (p.blockedReason) { flash("err", `${p.name} is blocked: ${p.blockedReason}`); return; }
    const sellable = p.batches.some((b) => b.status === "active" && b.expiry >= today && b.qtyBase > 0);
    if (!sellable) { flash("err", `${p.name}: no sellable batch (expired / recalled / out of stock)`); return; }
    setCart((c) => {
      const existing = c.find((l) => l.product.id === p.id && l.unit === "pack");
      if (existing) return c.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key: crypto.randomUUID(), product: p, qty: 1, unit: "pack", discountPct: 0 }];
    });
    setQuery(""); setResults([]); setHi(0);
    if (requiresRx(p)) setApproval(null);
    searchRef.current?.focus();
  }, [today, flash]);

  const reset = () => {
    setCart([]); setRx({}); setRxFile(null); setApproval(null); setPin(""); setTendered(""); setPayMode("cash"); setCustomer(null); setPaidNow("");
    searchRef.current?.focus();
  };

  // ── pharmacist PIN approval (UC-POS-06) ──
  const approve = async () => {
    const ph = ctx.pharmacists.find((p) => p.id === pinPharmacist) ?? store.onDuty.find((p) => p.id === pinPharmacist);
    if (!ph) { flash("err", "Choose the pharmacist"); return; }
    if (!live) {
      if (pin === DEMO_PHARMACIST.pin) { setApproval({ pharmacistId: ph.id, name: ph.name, regNo: ph.regNo }); setPin(""); }
      else flash("err", "Wrong PIN (demo PIN is 1234)");
      return;
    }
    if (!navigator.onLine) {
      setApproval({ pharmacistId: ph.id, name: ph.name, regNo: ph.regNo, offline: true }); setPin("");
      flash("warn", "Offline: PIN can't be verified now — the bill will be flagged for review when it syncs");
      return;
    }
    const { data, error } = await supabaseBrowser()!.rpc("approve_rx_with_pin", { p_store: store.id, p_pharmacist: ph.id, p_pin: pin });
    setPin("");
    if (error) { flash("err", error.message); return; }
    if (!data) { flash("err", "Wrong PIN"); return; }
    setApproval({ pharmacistId: ph.id, name: ph.name, regNo: ph.regNo, approvalId: data as string });
  };

  const startDuty = async (pharmacistId: string, dutyPin: string) => {
    const { data, error } = await supabaseBrowser()!.rpc("start_pharmacist_shift", { p_store: store.id, p_pharmacist: pharmacistId, p_pin: dutyPin });
    if (error) { flash("err", error.message); return false; }
    if (!data) { flash("err", "Wrong PIN"); return false; }
    setPinPharmacist(pharmacistId);
    flash("ok", "Pharmacist on duty");
    router.refresh();
    return true;
  };

  // ── save ──
  const save = useCallback(async () => {
    if (!bill || !canSave) { flash("err", issues.find((i) => i.severity === "block")?.message ?? stockErrors[0]?.error ?? "Nothing to save"); return; }
    if (payMode === "cash" && tendered && Math.round(Number(tendered) * 100) < bill.totalPaise) { flash("err", "Cash tendered is less than the bill total"); return; }
    const paidNowPaise = payMode === "credit" ? Math.min(bill.totalPaise, Math.max(0, Math.round((Number(paidNow) || 0) * 100))) : 0;
    const creditPaise = payMode === "credit" ? bill.totalPaise - paidNowPaise : 0;
    if (creditPaise > 0 && customer && customer.outstandingPaise + creditPaise > customer.creditLimitPaise && navigator.onLine) {
      flash("err", `Credit limit exceeded: due ${formatINR(customer.outstandingPaise)} + this bill ${formatINR(creditPaise)} > limit ${formatINR(customer.creditLimitPaise)}`); return;
    }
    const payments = payMode === "credit"
      ? [{ mode: "cash" as const, amountPaise: paidNowPaise }, { mode: "credit" as const, amountPaise: creditPaise }].filter((x) => x.amountPaise > 0)
      : [{ mode: payMode, amountPaise: bill.totalPaise }];
    setBusy(true);
    try {
      const [seq, dev] = await Promise.all([nextLocalSeq(), deviceCode()]);
      const billUuid = crypto.randomUUID();
      const prov = provisionalNo(dev, seq);
      const rxImagePath = rxFile ? `${ctx.orgId}/rx/${billUuid}/${safeName(rxFile.name)}` : rx.rxImagePath;
      const lines = priced.flatMap((p) => p.allocs.map((a) => ({ productId: p.line.product.id, qtyBase: a.qtyBase, batchId: a.batchId, discountPct: p.line.discountPct })));
      const payload = {
        billUuid, storeId: store.id, deviceCode: dev, provisionalNo: prov, billedAt: new Date().toISOString(), offline: !!approval?.offline,
        billDiscountPct: 0, lines, payments, customerId: customer?.id,
        prescription: needsRx ? { ...rx, rxDate: rx.rxDate || undefined, rxImagePath } : undefined,
        pharmacistId: needsRx ? approval?.pharmacistId : undefined,
        pharmacistApprovalId: needsRx ? approval?.approvalId : undefined,
      };

      let number = prov, provisional = true;
      if (live) {
        const res = await postSaleNow({ billUuid, storeId: store.id, provisionalNo: prov, totalPaise: bill.totalPaise, payload, rxFile: rxFile ?? undefined });
        if (res.status === "rejected") { flash("err", `Not saved: ${res.message}`); if (/approval/i.test(res.message)) setApproval(null); return; }
        if (res.status === "posted") { number = res.invoiceNo; provisional = false; if (res.needsReview) flash("warn", `Saved ${number} — flagged for manager review`); else flash("ok", `Saved ${number} · ${formatINR(bill.totalPaise)}`); }
        else flash("warn", `Saved offline as ${prov} (${res.reason}). It will sync automatically.`);
        await decrementLocalStock(store.id, lines.map((l) => ({ productId: l.productId, batchId: l.batchId!, qtyBase: l.qtyBase })));
      } else {
        flash("ok", `Saved ${prov} · ${formatINR(bill.totalPaise)} (demo — not sent to a server)`);
      }

      const lineMeta = priced.flatMap((p) => p.allocs.map((a) => ({ p, a })));
      setReceipt({
        number, provisional, at: new Date(), store, orgName: ctx.orgName, bill,
        paymentMode: payMode === "credit" ? `credit${paidNowPaise ? ` (paid ${formatINR(paidNowPaise)} cash)` : ""} · due now ${formatINR((customer?.outstandingPaise ?? 0) + creditPaise)}` : payMode,
        customer: customer ? `${customer.name ?? ""} ${customer.phone}`.trim() : undefined,
        customerPhone: customer?.phone,
        pharmacist: needsRx && approval ? { name: approval.name, regNo: approval.regNo } : null,
        patient: needsRegister ? rx.patientName : undefined,
        prescriber: needsRx && rx.prescriberName ? `${rx.prescriberName}${rx.prescriberRegNo ? ` (${rx.prescriberRegNo})` : ""}` : undefined,
        lines: lineMeta.map(({ p, a }, i) => ({
          name: p.line.product.name, hsn: p.line.product.hsn, batchNo: a.batchNo, expiry: a.expiry, schedule: p.line.product.schedule,
          qtyLabel: a.qtyBase % p.line.product.unitsPerPack === 0 ? `${a.qtyBase / p.line.product.unitsPerPack} ${p.line.product.packLabel}` : `${a.qtyBase} ${p.line.product.baseLabel}`,
          packMrpPaise: a.packMrpPaise, discountPct: p.line.discountPct, amountPaise: bill.lines[i]?.amountPaise ?? 0,
        })),
      });
      if (autoPrint) setTimeout(() => window.print(), 100);
      reset();
      setShiftRefresh((n) => n + 1);
      setSync(await syncOutbox());
    } finally {
      setBusy(false);
    }
  }, [bill, canSave, issues, stockErrors, payMode, tendered, paidNow, customer, priced, needsRx, needsRegister, rx, rxFile, approval, live, store, ctx.orgId, ctx.orgName, autoPrint, flash]);

  // ── keyboard-first (UC-POS-13) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "F8") { e.preventDefault(); setPayMode((m) => PAY_MODES[(PAY_MODES.indexOf(m) + 1) % PAY_MODES.length]!); }
      else if (e.key === "F4") { e.preventDefault(); if (live) setShowCustomer(true); else flash("warn", "Customer accounts need the live database (demo mode)"); }
      else if (e.key === "F10") { e.preventDefault(); void save(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "r") { e.preventDefault(); setShowRx(true); }
      else if (e.key === "Escape") { setShowRx(false); setDutyDialog(false); setQuery(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, PAY_MODES, live, flash]);

  const change = payMode === "cash" && bill && tendered ? Math.round(Number(tendered) * 100) - bill.totalPaise : null;
  const lineAmount = (idx: number, n: number) => {
    const start = priced.slice(0, idx).reduce((s, p) => s + p.allocs.length, 0);
    return bill?.lines.slice(start, start + n).reduce((s, l) => s + l.amountPaise, 0) ?? 0;
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-[1400px] flex-col gap-2 p-3">
      {/* status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm print:hidden">
        <div className="flex items-center gap-3">
          <strong>{store.code} · {store.name}</strong>
          <button className="rounded border border-line bg-surface px-2 py-0.5" onClick={() => (live ? setShowCustomer(true) : flash("warn", "Customer accounts need the live database (demo mode)"))}>
            <kbd>F4</kbd> {customer ? `${customer.name ?? customer.phone}${customer.creditLimitPaise > 0 ? ` · due ${formatINR(customer.outstandingPaise)}` : ""}` : "Walk-in customer"}</button>
          {live && <ShiftPanel store={store} orgName={ctx.orgName} isManager={!!ctx.isManager} refreshKey={shiftRefresh} onMessage={flash} />}
          {customer && <button aria-label="Remove customer" className="text-muted" onClick={() => { setCustomer(null); if (payMode === "credit") setPayMode("cash"); }}>✕</button>}
          {store.onDuty.length > 0 || !live
            ? <span className="text-ok">Pharmacist on duty: {(live ? store.onDuty : [DEMO_PHARMACIST]).map((p) => `${p.name} (${p.regNo})`).join(", ")}</span>
            : <span className="text-danger">No pharmacist on duty — prescription medicines {store.pharmacistPresence === "hard" ? "cannot" : "should not"} be billed</span>}
          {live && <button className="rounded border border-line bg-surface px-2 py-0.5" onClick={() => setDutyDialog(true)}>Start duty</button>}
        </div>
        <div className="flex items-center gap-3">
          {catalogueInfo && <span className="text-xs text-muted">{catalogueInfo}</span>}
          {sync.pending > 0 && <span className="rounded bg-warn/10 px-2 py-0.5 text-warn">{sync.pending} bill(s) waiting to sync</span>}
          {sync.failed.length > 0 && <span className="rounded bg-danger/10 px-2 py-0.5 text-danger">{sync.failed.length} bill(s) rejected — see below</span>}
          <span className={online ? "text-ok" : "text-danger"}>● {online ? "Online" : "Offline — billing continues"}</span>
          {!live && <span className="rounded bg-brand-100 px-2 py-0.5 text-brand-900">Demo data</span>}
        </div>
      </div>

      {sync.failed.length > 0 && (
        <div className="rounded-md border border-danger bg-danger/5 p-2 text-sm print:hidden">
          <strong>Offline bills the server rejected</strong> — the sale happened; a manager must fix the cause (e.g. receive stock) and retry.
          <ul className="mt-1 space-y-0.5">{sync.failed.map((b) => (
            <li key={b.billUuid} className="flex items-center gap-2"><code>{b.provisionalNo}</code> {formatINR(b.totalPaise)} — {b.error}
              <button className="text-brand-700 underline" onClick={() => void retryBill(b.billUuid).then(setSync)}>Retry</button></li>))}
          </ul>
        </div>
      )}

      {/* search */}
      <div className="relative print:hidden">
        <label className="sr-only" htmlFor="pos-search">Search product or scan barcode</label>
        <input id="pos-search" ref={searchRef} autoFocus value={query} autoComplete="off"
          onChange={(e) => { setQuery(e.target.value); setHi(0); }}
          onKeyDown={async (e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === "Enter") {
              e.preventDefault();
              if (results[hi]) { addProduct(results[hi]!); return; }
              if (live && /^\d{8,14}$/.test(query.trim())) { // scanner beat the debounce
                const r = await searchRemote(store.id, query.trim());
                if (r[0]) addProduct(r[0]); else flash("err", `Barcode ${query} not found`);
              }
            }
          }}
          placeholder={live ? "F2 · Search brand / salt / barcode" : "F2 · Search brand / salt / barcode (try: dolo, azith, alpra, insulin, pan, codeine)"}
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
                  <span className={`num ${stock ? "text-muted" : "text-danger"}`}>{stock ? `Stock ${Math.floor(stock / p.unitsPerPack)} ${p.packLabel}` : "Out of stock"}{p.rack && ` · Rack ${p.rack}`}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* cart */}
      <div className="flex-1 overflow-auto rounded-md border border-line bg-surface print:hidden">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-canvas text-left text-xs uppercase text-muted">
            <tr><th className="p-2">#</th><th>Item</th><th>Batch · Exp</th><th>Unit</th><th className="text-right">Qty</th><th className="text-right">MRP</th><th className="text-right">Disc %</th><th className="text-right">GST</th><th className="p-2 text-right">Amount</th><th /></tr>
          </thead>
          <tbody>
            {priced.map(({ line, allocs, error }, idx) => (
              <tr key={line.key} className="border-t border-line align-top">
                <td className="p-2 text-muted">{idx + 1}</td>
                <td className="py-2"><div className="flex items-center gap-2"><ScheduleBadge schedule={line.product.schedule} coldChain={line.product.coldChain} />{line.product.name}</div>
                  {error && <div className="text-xs text-danger">{error}</div>}</td>
                <td className="num py-2 text-xs">{allocs.map((a) => (
                  <div key={a.batchId} className={a.nearExpiry ? "text-warn" : ""}>{a.batchNo} · {a.expiry.slice(5, 7)}/{a.expiry.slice(2, 4)}{a.nearExpiry && " ⚠ near expiry"} ({a.qtyBase})</div>))}</td>
                <td className="py-2">
                  <select aria-label="Unit" value={line.unit} className="rounded border border-line px-1"
                    onChange={(e) => setCart((c) => c.map((x) => (x.key === line.key ? { ...x, unit: e.target.value as Unit } : x)))}>
                    <option value="pack">{line.product.packLabel}</option>
                    {line.product.unitsPerPack > 1 && line.product.allowLoose !== false && <option value="base">{line.product.baseLabel}</option>}
                  </select>
                </td>
                <td className="py-2 text-right"><input aria-label="Quantity" type="number" min={1} value={line.qty} className="num w-16 rounded border border-line px-1 text-right"
                  onChange={(e) => setCart((c) => c.map((x) => (x.key === line.key ? { ...x, qty: Math.max(1, Math.floor(Number(e.target.value)) || 1) } : x)))} /></td>
                <td className="num py-2 text-right">{formatINR(allocs[0]?.packMrpPaise ?? line.product.batches[0]?.packMrpPaise ?? 0)}</td>
                <td className="py-2 text-right"><input aria-label="Discount percent" type="number" min={0} max={ctx.maxDiscountPct} value={line.discountPct} className="num w-14 rounded border border-line px-1 text-right"
                  title={`Your limit: ${ctx.maxDiscountPct}%`}
                  onChange={(e) => setCart((c) => c.map((x) => (x.key === line.key ? { ...x, discountPct: Math.min(ctx.maxDiscountPct, Math.max(0, Number(e.target.value) || 0)) } : x)))} /></td>
                <td className="num py-2 text-right">{store.gstScheme === "composition" ? "—" : `${line.product.gstRate}%`}</td>
                <td className="num p-2 text-right font-medium">{formatINR(lineAmount(idx, allocs.length))}</td>
                <td className="py-2"><button aria-label={`Remove ${line.product.name}`} className="px-2 text-muted hover:text-danger"
                  onClick={() => setCart((c) => c.filter((x) => x.key !== line.key))}>✕</button></td>
              </tr>
            ))}
            {!cart.length && <tr><td colSpan={10} className="p-8 text-center text-muted">Scan a barcode or press F2 to search</td></tr>}
          </tbody>
        </table>
      </div>

      {/* compliance */}
      {needsRx && (
        <div className={`flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm print:hidden ${hasBlockingIssue(issues) ? "border-sch-h1 bg-sch-h1/5" : "border-ok bg-ok/5"}`}>
          <span className="font-medium">{needsRegister ? "Schedule H1 / X / NDPS — register entry required" : "Prescription medicine"}</span>
          {issues.map((i) => <span key={i.code + (i.productId ?? "")} className={i.severity === "block" ? "text-danger" : "text-warn"}>• {i.message}</span>)}
          <button className="rounded border border-line bg-surface px-2 py-1" onClick={() => setShowRx(true)}><kbd>Ctrl+R</kbd> Add Rx</button>
          {!approval ? (
            <span className="flex items-center gap-1">
              <select aria-label="Approving pharmacist" value={pinPharmacist} onChange={(e) => setPinPharmacist(e.target.value)} className="rounded border border-line px-1 py-1">
                <option value="">Pharmacist…</option>
                {(live ? (store.onDuty.length ? store.onDuty : ctx.pharmacists) : [DEMO_PHARMACIST]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input aria-label="Pharmacist PIN" type="password" inputMode="numeric" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void approve(); } }} className="w-20 rounded border border-line px-2 py-1" />
              <button className="rounded bg-brand-700 px-2 py-1 text-white" onClick={() => void approve()}>Approve</button>
              {!live && <span className="text-xs text-muted">(demo PIN 1234)</span>}
            </span>
          ) : (
            <span className={approval.offline ? "text-warn" : "text-ok"}>✓ Approved by {approval.name}{approval.offline && " (offline — review on sync)"}
              <button className="ml-2 text-xs text-muted underline" onClick={() => setApproval(null)}>change</button></span>
          )}
        </div>
      )}

      {/* totals & payment */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface p-3 print:hidden">
        <div className="num flex flex-wrap gap-5 text-sm text-muted">
          <span>Items {cart.length}</span>
          {store.gstScheme === "regular" ? <>
            <span>Taxable {formatINR(bill?.taxablePaise ?? 0)}</span>
            <span>CGST {formatINR(bill?.cgstPaise ?? 0)}</span>
            <span>SGST {formatINR(bill?.sgstPaise ?? 0)}</span>
          </> : <span>Bill of Supply (composition)</span>}
          <span>Discount {formatINR(bill?.discountPaise ?? 0)}</span>
          <span>Round-off {formatINR(bill?.roundOffPaise ?? 0)}</span>
        </div>
        <div className="flex items-center gap-3">
          <div role="radiogroup" aria-label="Payment mode" className="flex overflow-hidden rounded border border-line text-sm">
            {PAY_MODES.map((m) => (
              <button key={m} role="radio" aria-checked={payMode === m} onClick={() => setPayMode(m)}
                className={`px-3 py-1 uppercase ${payMode === m ? "bg-brand-700 text-white" : "bg-surface"}`}>{m}</button>))}
          </div>
          {payMode === "credit" && <input aria-label="Paid now in cash" placeholder="Paid now ₹" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} className="num w-24 rounded border border-line px-2 py-1 text-right" />}
          {payMode === "cash" && <input aria-label="Cash tendered" placeholder="Tendered ₹" value={tendered} onChange={(e) => setTendered(e.target.value)} className="num w-24 rounded border border-line px-2 py-1 text-right" />}
          {change !== null && change >= 0 && <span className="num text-sm">Change {formatINR(change)}</span>}
          <span className="num text-2xl font-semibold">{formatINR(bill?.totalPaise ?? 0)}</span>
          <button disabled={!canSave} onClick={() => void save()} className="rounded-md bg-brand-700 px-4 py-2 font-medium text-white disabled:opacity-40">
            <kbd className="mr-1 bg-transparent text-white">F10</kbd> {busy ? "Saving…" : "Save & Print"}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted print:hidden">
        <span><kbd>F2</kbd> search · <kbd>↑↓</kbd> pick · <kbd>Enter</kbd> add · <kbd>F4</kbd> customer · <kbd>F8</kbd> payment mode · <kbd>Ctrl+R</kbd> prescription · <kbd>F10</kbd> save · <kbd>Esc</kbd> close</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={autoPrint} onChange={(e) => { setAutoPrint(e.target.checked); try { localStorage.setItem("ms_autoprint", e.target.checked ? "1" : "0"); } catch { /* ignore */ } }} /> Print after save</label>
        {receipt && <span>Last bill {receipt.number}{receipt.provisional && " (provisional)"} · {formatINR(receipt.bill.totalPaise)} <button className="underline" onClick={() => window.print()}>Reprint</button>{" · "}<button className="underline" onClick={() => printA4Invoice(receipt)}>A4</button>{receipt.customerPhone && <>{" · "}<a className="underline" href={billWhatsAppLink(receipt, receipt.customerPhone)} target="_blank" rel="noopener">WhatsApp</a></>}</span>}
      </div>

      {toast && <div role="status" className={`fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-md px-4 py-2 text-white shadow-lg print:hidden ${toast.kind === "ok" ? "bg-ok" : toast.kind === "warn" ? "bg-warn" : "bg-danger"}`}>{toast.text}</div>}

      {showRx && (
        <div role="dialog" aria-modal="true" aria-label="Prescription details" className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 print:hidden">
          <form className="w-[520px] space-y-2 rounded-lg bg-surface p-4 shadow-xl" onSubmit={(e) => { e.preventDefault(); setShowRx(false); searchRef.current?.focus(); }}>
            <h2 className="font-semibold">Prescription details</h2>
            {live && <DoctorLookup orgId={ctx.orgId} onPick={(d) => setRx((r) => ({ ...r, prescriberName: d.name + (d.qualification ? `, ${d.qualification}` : ""), prescriberRegNo: d.reg_no ?? "", prescriberAddress: d.address ?? "" }))} />}
            {([
              ["patientName", "Patient name"], ["patientAddress", "Patient address"], ["prescriberName", "Doctor name"],
              ["prescriberRegNo", "Doctor registration no. (e.g. KMC-12345)"], ["prescriberAddress", "Doctor / clinic address"], ["rxDate", "Prescription date"],
            ] as Array<[keyof PrescriptionInfo, string]>).map(([k, label]) => (
              <label key={k} className="block text-sm">{label}
                <input type={k === "rxDate" ? "date" : "text"} max={k === "rxDate" ? today : undefined} value={rx[k] ?? ""} onChange={(e) => setRx((r) => ({ ...r, [k]: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-line px-2 py-1" />
              </label>))}
            <label className="block text-sm">Prescription copy (required for Schedule X / NDPS)
              <input type="file" accept="image/*,application/pdf" capture="environment" className="mt-0.5 block w-full text-sm"
                onChange={(e) => setRxFile(e.target.files?.[0] ?? null)} />
            </label>
            {rxFile && <p className="text-xs text-ok">✓ {rxFile.name} — stored in the private prescriptions bucket{live ? "" : " (demo: kept in this browser only)"}</p>}
            <p className="text-xs text-muted">Access to prescription images is logged (DPDP).</p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="rounded border border-line px-3 py-1" onClick={() => setShowRx(false)}>Cancel</button>
              <button className="rounded bg-brand-700 px-3 py-1 text-white">Done</button>
            </div>
          </form>
        </div>
      )}

      {showCustomer && <CustomerDialog orgId={ctx.orgId} onClose={() => { setShowCustomer(false); searchRef.current?.focus(); }}
        onPick={(c) => { setCustomer(c); setShowCustomer(false); setRx((r) => ({ ...r, patientName: r.patientName || c.name || "", patientAddress: r.patientAddress || c.address || "" })); searchRef.current?.focus(); }} />}
      {dutyDialog && <DutyDialog pharmacists={ctx.pharmacists} onClose={() => setDutyDialog(false)} onStart={startDuty} />}
      {receipt && <Receipt r={receipt} />}
    </div>
  );
}

function DutyDialog({ pharmacists, onClose, onStart }: {
  pharmacists: PosCtx["pharmacists"]; onClose: () => void; onStart: (id: string, pin: string) => Promise<boolean>;
}) {
  const [id, setId] = useState(pharmacists[0]?.id ?? "");
  const [pin, setPin] = useState("");
  return (
    <div role="dialog" aria-modal="true" aria-label="Start pharmacist duty" className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 print:hidden">
      <form className="w-96 space-y-3 rounded-lg bg-surface p-4 shadow-xl" onSubmit={async (e) => { e.preventDefault(); if (await onStart(id, pin)) onClose(); setPin(""); }}>
        <h2 className="font-semibold">Start pharmacist duty</h2>
        {pharmacists.length === 0 ? <p className="text-sm text-danger">No pharmacists registered. An owner/admin can add them in Settings.</p> : <>
          <label className="block text-sm">Pharmacist
            <select className="mt-1 w-full rounded border border-line px-2 py-1" value={id} onChange={(e) => setId(e.target.value)}>
              {pharmacists.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.regNo})</option>)}
            </select>
          </label>
          <label className="block text-sm">PIN<input autoFocus type="password" inputMode="numeric" className="mt-1 w-full rounded border border-line px-2 py-1" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        </>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border border-line px-3 py-1" onClick={onClose}>Cancel</button>
          <button disabled={!pharmacists.length} className="rounded bg-brand-700 px-3 py-1 text-white disabled:opacity-50">Start duty</button>
        </div>
      </form>
    </div>
  );
}
