"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  computePurchaseLine, computePurchaseTotals, expiryFromMonthYear, formatINR, invoiceMismatch, rupeesToPaise, type PurchaseLineResult,
} from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import type { PosProduct } from "@/lib/catalogue";
import { ProductPicker } from "@/components/ProductPicker";
import { ScheduleBadge } from "@/components/ScheduleBadge";
import { inputCls } from "@/components/ui";

interface Distributor { id: string; name: string; state_code: string; drug_licence_valid_to: string | null; credit_days: number }
interface Line { key: string; product: PosProduct; batchNo: string; expiry: string; mrp: string; ptr: string; qty: string; free: string; disc: string }

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function GrnForm({ storeId, storeState, scheme, distributors }: {
  storeId: string; storeState: string; scheme: "regular" | "composition"; distributors: Distributor[];
}) {
  const router = useRouter();
  const [distId, setDistId] = useState("");
  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState(new Date().toISOString().slice(0, 10));
  const [invTotal, setInvTotal] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; warnings?: string[] } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const dist = distributors.find((d) => d.id === distId);
  const interState = !!dist && dist.state_code !== storeState;
  const today = new Date().toISOString().slice(0, 10);

  const computed = useMemo(() => lines.map((l) => {
    const errors: string[] = [];
    let expiryIso = "";
    try { expiryIso = /^\d{4}-\d{2}-\d{2}$/.test(l.expiry) ? l.expiry : expiryFromMonthYear(l.expiry); } catch { errors.push("expiry MM/YY"); }
    if (!l.batchNo.trim()) errors.push("batch");
    const mrp = num(l.mrp), ptr = num(l.ptr), qty = num(l.qty), free = num(l.free || "0"), disc = num(l.disc || "0");
    if (!(mrp > 0)) errors.push("MRP"); if (!(ptr >= 0)) errors.push("PTR"); if (!(qty >= 0)) errors.push("qty"); if (!(free >= 0)) errors.push("free");
    if (qty + free <= 0) errors.push("qty or free > 0");
    if (l.product.gstRate < 0) errors.push("no GST rate for this HSN");
    let res: PurchaseLineResult | null = null;
    if (!errors.length) {
      try {
        res = computePurchaseLine({ packRatePaise: rupeesToPaise(ptr), packMrpPaise: rupeesToPaise(mrp), qtyPacks: qty, freePacks: free, discountPct: disc, gstRate: l.product.gstRate, unitsPerPack: l.product.unitsPerPack }, { scheme });
      } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    }
    const warnings = [...(res?.warnings ?? [])];
    if (expiryIso && expiryIso < today) errors.push("already expired");
    else if (expiryIso && Date.parse(expiryIso) - Date.parse(today) < 90 * 86_400_000) warnings.push("expires within 3 months");
    return { line: l, expiryIso, res, errors, warnings };
  }), [lines, scheme, today]);

  const totals = computePurchaseTotals(computed.flatMap((c) => (c.res ? [c.res] : [])), interState);
  const mismatch = invoiceMismatch(totals.totalPaise, invTotal ? (() => { try { return rupeesToPaise(invTotal); } catch { return null; } })() : null);
  const licenceExpired = !!dist?.drug_licence_valid_to && dist.drug_licence_valid_to < invDate;
  const ready = !!dist && !licenceExpired && invNo.trim() && lines.length > 0 && computed.every((c) => !c.errors.length);

  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const post = async () => {
    setBusy(true); setResult(null);
    const { data, error } = await supabaseBrowser()!.rpc("post_purchase", { p: {
      idempotencyKey: key, storeId, distributorId: distId, supplierInvoiceNo: invNo.trim(), supplierInvoiceDate: invDate,
      lines: computed.map((c) => ({
        productId: c.line.product.id, batchNo: c.line.batchNo.trim().toUpperCase(), expiry: c.expiryIso,
        packMrpPaise: rupeesToPaise(c.line.mrp), packRatePaise: rupeesToPaise(c.line.ptr), qtyPacks: Number(c.line.qty), freePacks: Number(c.line.free || 0),
        discountPct: Number(c.line.disc || 0),
      })),
    } });
    setBusy(false);
    if (error) { setResult({ ok: false, text: error.message }); return; }
    setResult({ ok: true, text: `GRN posted · ${formatINR(Number(data.totalPaise))}. Stock is now available at the counter.`, warnings: data.warnings });
    setLines([]); setInvNo(""); setInvTotal(""); setKey(crypto.randomUUID());
    router.refresh();
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-4 gap-3 rounded-lg border border-line bg-surface p-4">
        <label className="col-span-2">Distributor
          <select className={inputCls} value={distId} onChange={(e) => setDistId(e.target.value)}>
            <option value="">Select…</option>{distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {licenceExpired && <span className="text-danger">Drug licence expired — purchases from this distributor are blocked.</span>}
          {interState && <span className="text-muted">Inter-state supply → IGST</span>}
        </label>
        <label>Supplier invoice no.<input className={inputCls} value={invNo} onChange={(e) => setInvNo(e.target.value)} /></label>
        <label>Invoice date<input type="date" max={today} className={inputCls} value={invDate} onChange={(e) => setInvDate(e.target.value)} /></label>
        <label>Invoice total on paper (₹)<input className={inputCls} value={invTotal} onChange={(e) => setInvTotal(e.target.value)} placeholder="to cross-check" /></label>
        <div className="col-span-3 self-end"><ProductPicker storeId={storeId} placeholder="Add item: search name, salt or scan barcode"
          onPick={(p) => setLines((ls) => [...ls, { key: crypto.randomUUID(), product: p, batchNo: "", expiry: "", mrp: p.batches[0] ? String(p.batches[0].packMrpPaise / 100) : "", ptr: "", qty: "", free: "", disc: "" }])} /></div>
      </div>

      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full">
          <thead className="bg-canvas text-left text-xs uppercase text-muted">
            <tr><th className="p-2">Item</th><th>Batch</th><th>Expiry</th><th>MRP/pack</th><th>PTR/pack</th><th>Qty</th><th>Free</th><th>Disc%</th><th>GST</th><th className="text-right">Taxable</th><th className="pr-2 text-right">Margin</th><th /></tr>
          </thead>
          <tbody>{computed.map(({ line: l, res, errors, warnings }) => (
            <tr key={l.key} className="border-t border-line align-top">
              <td className="p-2"><div className="flex items-center gap-1"><ScheduleBadge schedule={l.product.schedule} coldChain={l.product.coldChain} />{l.product.name}</div>
                <div className="text-xs text-muted">{l.product.unitsPerPack} {l.product.baseLabel}/{l.product.packLabel}</div>
                {errors.length > 0 && <div className="text-xs text-danger">Check: {errors.join(", ")}</div>}
                {warnings.length > 0 && <div className="text-xs text-warn">{warnings.join("; ")}</div>}</td>
              <td><input aria-label="Batch" className="w-24 rounded border border-line px-1 py-1 uppercase" value={l.batchNo} onChange={(e) => update(l.key, { batchNo: e.target.value })} /></td>
              <td><input aria-label="Expiry" className="w-16 rounded border border-line px-1 py-1" placeholder="MM/YY" value={l.expiry} onChange={(e) => update(l.key, { expiry: e.target.value })} /></td>
              <td><input aria-label="MRP" className="w-20 rounded border border-line px-1 py-1 text-right" value={l.mrp} onChange={(e) => update(l.key, { mrp: e.target.value })} /></td>
              <td><input aria-label="PTR" className="w-20 rounded border border-line px-1 py-1 text-right" value={l.ptr} onChange={(e) => update(l.key, { ptr: e.target.value })} /></td>
              <td><input aria-label="Quantity" className="w-14 rounded border border-line px-1 py-1 text-right" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} /></td>
              <td><input aria-label="Free" className="w-12 rounded border border-line px-1 py-1 text-right" value={l.free} onChange={(e) => update(l.key, { free: e.target.value })} /></td>
              <td><input aria-label="Discount" className="w-12 rounded border border-line px-1 py-1 text-right" value={l.disc} onChange={(e) => update(l.key, { disc: e.target.value })} /></td>
              <td className="pt-2">{l.product.gstRate}%</td>
              <td className="num pt-2 text-right">{res ? formatINR(res.taxablePaise) : "—"}</td>
              <td className={`num pr-2 pt-2 text-right ${res && res.marginPct < 5 ? "text-warn" : ""}`}>{res ? `${res.marginPct.toFixed(1)}%` : "—"}</td>
              <td className="pt-1"><button aria-label="Remove line" className="px-2 text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td>
            </tr>))}
          {!lines.length && <tr><td colSpan={12} className="p-6 text-center text-muted">Add items from the distributor&apos;s invoice.</td></tr>}</tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
        <div className="num flex flex-wrap gap-4 text-muted">
          <span>Taxable {formatINR(totals.taxablePaise)}</span>
          {interState ? <span>IGST {formatINR(totals.igstPaise)}</span> : <><span>CGST {formatINR(totals.cgstPaise)}</span><span>SGST {formatINR(totals.sgstPaise)}</span></>}
          <span>Round-off {formatINR(totals.roundOffPaise)}</span>
          <span className="text-lg font-semibold text-ink">Total {formatINR(totals.totalPaise)}</span>
          {mismatch !== null && <span className="text-danger">Differs from paper invoice by {formatINR(mismatch)} — check rates, quantities and discounts</span>}
        </div>
        <button disabled={!ready || busy} onClick={() => void post()} className="rounded-md bg-brand-700 px-4 py-2 font-medium text-white disabled:opacity-40">{busy ? "Posting…" : "Post GRN"}</button>
      </div>
      {result && (
        <div role="status" className={`rounded-lg border p-3 ${result.ok ? "border-ok bg-ok/5 text-ok" : "border-danger bg-danger/5 text-danger"}`}>
          {result.text}{result.warnings?.map((w) => <div key={w} className="text-warn">⚠ {w}</div>)}
        </div>
      )}
    </div>
  );
}
