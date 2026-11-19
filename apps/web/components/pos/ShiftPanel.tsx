"use client";
import { useCallback, useEffect, useState } from "react";
import { formatINR, rupeesToPaise } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { deviceCode } from "@/lib/pos-db";
import { escapeHtml, printHtml } from "@/lib/print";
import type { StoreCtx } from "@/lib/types";
import { formatBillTime } from "./Receipt";

export interface ShiftSummary {
  shiftId: string; status: string; openedAt: string; closedAt: string | null; deviceCode: string | null; openingPaise: number; cashNetPaise: number;
  upiPaise: number; cardPaise: number; walletPaise: number; creditNetPaise: number; bills: number; salesPaise: number; cancelledBills: number;
  reviewBills: number; returns: number; refundsPaise: number; expectedCashPaise: number; countedPaise: number | null; differencePaise: number | null;
  closeNote: string | null; movements: Array<{ kind: string; amountPaise: number; note: string; at: string }>;
}

const DENOMS = ["500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;
const KIND_LABEL: Record<string, string> = { float_in: "Cash added (float)", expense: "Petty expense", bank_deposit: "Deposited to bank", owner_drawing: "Owner withdrawal" };

export function printShiftReport(s: ShiftSummary, store: StoreCtx, orgName: string, kind: "X" | "Z") {
  const row = (l: string, v: string) => `<tr><td>${escapeHtml(l)}</td><td class="r">${escapeHtml(v)}</td></tr>`;
  printHtml(`${kind} report`, `
    <h1>${escapeHtml(orgName)}<br>${escapeHtml(store.code)} · ${escapeHtml(store.name)}</h1>
    <div style="text-align:center;font-weight:bold">${kind === "Z" ? "Z REPORT (SHIFT CLOSED)" : "X REPORT (SHIFT RUNNING)"}</div>
    <div>From ${escapeHtml(formatBillTime(new Date(s.openedAt)))}<br>To ${escapeHtml(formatBillTime(new Date(s.closedAt ?? Date.now())))}${s.deviceCode ? `<br>Counter ${escapeHtml(s.deviceCode)}` : ""}</div><hr>
    <table>${row("Bills", String(s.bills))}${row("Sales", formatINR(s.salesPaise))}${row("Cancelled bills", String(s.cancelledBills))}
      ${row("Returns", `${s.returns} · ${formatINR(s.refundsPaise)}`)}${s.reviewBills ? row("Flagged for review", String(s.reviewBills)) : ""}</table><hr>
    <table>${row("UPI", formatINR(s.upiPaise))}${row("Card", formatINR(s.cardPaise))}${row("Credit (udhaar) net", formatINR(s.creditNetPaise))}</table><hr>
    <table>${row("Opening cash", formatINR(s.openingPaise))}${row("Cash movement (net)", formatINR(s.cashNetPaise))}
      ${s.movements.map((m) => row(`  ${KIND_LABEL[m.kind] ?? m.kind}: ${m.note}`, formatINR(m.kind === "float_in" ? m.amountPaise : -m.amountPaise))).join("")}
      ${row("Expected in drawer", formatINR(s.expectedCashPaise))}
      ${s.countedPaise != null ? row("Counted", formatINR(s.countedPaise)) + row(s.differencePaise! < 0 ? "SHORT" : s.differencePaise! > 0 ? "EXCESS" : "Difference", formatINR(s.differencePaise!)) : ""}</table>
    ${s.closeNote ? `<hr><div>Note: ${escapeHtml(s.closeNote)}</div>` : ""}<hr><div>Cashier signature: ____________</div>`);
}

/** Till shift bar on the POS (UC-POS-14). Cashiers count blind; owners/admins also see the expected drawer cash. */
export function ShiftPanel({ store, orgName, isManager, refreshKey, onMessage }: {
  store: StoreCtx; orgName: string; isManager: boolean; refreshKey: number; onMessage: (kind: "ok" | "err" | "warn", text: string) => void;
}) {
  const [shift, setShift] = useState<ShiftSummary | null | undefined>(undefined);
  const [dialog, setDialog] = useState<null | "open" | "move" | "close">(null);

  const load = useCallback(async () => {
    if (!navigator.onLine) return;
    const { data, error } = await supabaseBrowser()!.rpc("my_open_shift", { p_store: store.id });
    if (!error) setShift((data as ShiftSummary | null) ?? null);
  }, [store.id]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  if (shift === undefined) return null;
  return (
    <>
      {shift ? (
        <span className="flex items-center gap-2 rounded border border-line bg-surface px-2 py-0.5">
          Shift since {new Date(shift.openedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
          {isManager && <span className="num text-muted">· drawer {formatINR(shift.expectedCashPaise)}</span>}
          <button className="text-brand-700 underline" onClick={() => setDialog("move")}>Cash in/out</button>
          <button className="text-brand-700 underline" onClick={async () => { await load(); if (shift) printShiftReport(shift, store, orgName, "X"); }}>X report</button>
          <button className="text-danger underline" onClick={() => setDialog("close")}>Close shift</button>
        </span>
      ) : (
        <button className="rounded border border-warn bg-warn/10 px-2 py-0.5 text-warn" onClick={() => setDialog("open")}>No open shift — Open shift</button>
      )}
      {dialog === "open" && <OpenDialog store={store} onClose={() => setDialog(null)} onDone={(w) => { setDialog(null); void load(); onMessage(w ? "warn" : "ok", w ?? "Shift opened"); }} />}
      {dialog === "move" && shift && <MoveDialog shiftId={shift.shiftId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); onMessage("ok", "Cash movement recorded"); }} />}
      {dialog === "close" && shift && <CloseDialog shiftId={shift.shiftId} onClose={() => setDialog(null)}
        onDone={(z) => { setDialog(null); setShift(null); printShiftReport(z, store, orgName, "Z"); onMessage(z.differencePaise ? "warn" : "ok", z.differencePaise ? `Shift closed — ${z.differencePaise < 0 ? "short" : "excess"} ${formatINR(Math.abs(z.differencePaise))}` : "Shift closed — cash tallies"); }} />}
    </>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 print:hidden" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="w-[440px] space-y-3 rounded-lg bg-surface p-4 text-sm shadow-xl">
        <h2 className="font-semibold">{title}</h2>{children}
      </div>
    </div>
  );
}

function OpenDialog({ store, onClose, onDone }: { store: StoreCtx; onClose: () => void; onDone: (warning?: string) => void }) {
  const [amt, setAmt] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Open shift" onClose={onClose}>
      <label className="block">Cash in drawer now (₹)<input autoFocus inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1" /></label>
      {err && <p className="text-danger">{err}</p>}
      <div className="flex justify-end gap-2">
        <button className="rounded border border-line px-3 py-1" onClick={onClose}>Cancel</button>
        <button className="rounded bg-brand-700 px-3 py-1 text-white" onClick={async () => {
          let paise: number; try { paise = rupeesToPaise(amt || "0"); } catch { setErr("Enter an amount"); return; }
          const { data, error } = await supabaseBrowser()!.rpc("open_shift", { p_store: store.id, p_device: await deviceCode(), p_opening_paise: paise });
          if (error) setErr(error.message); else onDone(data.warning ? `${data.warning} (last count ${formatINR(Number(data.lastClosingPaise))})` : undefined);
        }}>Open shift</button>
      </div>
    </Modal>
  );
}

function MoveDialog({ shiftId, onClose, onDone }: { shiftId: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState("expense");
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Cash in / out" onClose={onClose}>
      <label className="block">Type<select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1">
        {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="block">Amount (₹)<input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1" /></label>
      <label className="block">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. tea, courier, change from bank" className="mt-1 w-full rounded border border-line px-2 py-1" /></label>
      {err && <p className="text-danger">{err}</p>}
      <div className="flex justify-end gap-2">
        <button className="rounded border border-line px-3 py-1" onClick={onClose}>Cancel</button>
        <button className="rounded bg-brand-700 px-3 py-1 text-white" onClick={async () => {
          let paise: number; try { paise = rupeesToPaise(amt); } catch { setErr("Enter an amount"); return; }
          const { error } = await supabaseBrowser()!.rpc("record_cash_movement", { p_shift: shiftId, p_kind: kind, p_amount_paise: paise, p_note: note });
          if (error) setErr(error.message); else onDone();
        }}>Save</button>
      </div>
    </Modal>
  );
}

function CloseDialog({ shiftId, onClose, onDone }: { shiftId: string; onClose: () => void; onDone: (z: ShiftSummary) => void }) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [coins, setCoins] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const coinsPaise = (() => { try { return coins ? rupeesToPaise(coins) : 0; } catch { return 0; } })();
  const counted = DENOMS.reduce((s, d) => s + Number(d) * 100 * (Math.max(0, Math.floor(Number(counts[d] || 0)))), 0) + coinsPaise;
  return (
    <Modal title="Close shift — count the drawer" onClose={onClose}>
      <p className="text-xs text-muted">Count every note before you see the system total (blind count).</p>
      <div className="grid grid-cols-3 gap-2">
        {DENOMS.map((d) => (
          <label key={d} className="flex items-center gap-1">₹{d} ×<input aria-label={`Count of ₹${d}`} inputMode="numeric" value={counts[d] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value }))}
            className="w-14 rounded border border-line px-1 py-0.5 text-right" /></label>))}
        <label className="col-span-3 flex items-center gap-1">Loose coins (₹)<input inputMode="decimal" value={coins} onChange={(e) => setCoins(e.target.value)} className="w-20 rounded border border-line px-1 py-0.5 text-right" /></label>
      </div>
      <p className="num text-base font-semibold">Counted {formatINR(counted)}</p>
      <label className="block">Note (required if the difference is over ₹100)<input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1" /></label>
      {err && <p className="text-danger">{err}</p>}
      <div className="flex justify-end gap-2">
        <button className="rounded border border-line px-3 py-1" onClick={onClose}>Cancel</button>
        <button disabled={busy} className="rounded bg-danger px-3 py-1 text-white disabled:opacity-50" onClick={async () => {
          setBusy(true); setErr(null);
          const denoms: Record<string, number> = Object.fromEntries(DENOMS.map((d) => [d, Math.max(0, Math.floor(Number(counts[d] || 0)))]).filter(([, n]) => (n as number) > 0));
          if (coinsPaise) denoms.coins_paise = coinsPaise;
          const { data, error } = await supabaseBrowser()!.rpc("close_shift", { p_shift: shiftId, p_denoms: denoms, p_note: note || null });
          setBusy(false);
          if (error) setErr(error.message); else onDone(data as ShiftSummary);
        }}>Close shift & print Z report</button>
      </div>
    </Modal>
  );
}
