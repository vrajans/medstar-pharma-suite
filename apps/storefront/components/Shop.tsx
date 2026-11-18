"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { formatINR, requiresRx, validateOnlineCart, hasBlockingIssue, type DrugSchedule } from "@medstar/core";

interface Item { id: string; name: string; composition: string; schedule: DrugSchedule; habitForming?: boolean; coldChain?: boolean; mrpPaise: number; pack: string; inStock: boolean }

// Demo catalogue — in production read from the `storefront_products` view (public, no cost data).
const CATALOGUE: Item[] = [
  { id: "b001", name: "Dolo 650 Tablet", composition: "Paracetamol 650mg", schedule: "OTC", mrpPaise: 3091, pack: "Strip of 15", inStock: true },
  { id: "b003", name: "Azithral 500 Tablet", composition: "Azithromycin 500mg", schedule: "H", mrpPaise: 11950, pack: "Strip of 3", inStock: true },
  { id: "b004", name: "Huminsulin R 40IU/ml", composition: "Human insulin", schedule: "H", coldChain: true, mrpPaise: 17500, pack: "Vial 10ml", inStock: true },
  { id: "b002", name: "Alprax 0.25 Tablet", composition: "Alprazolam 0.25mg", schedule: "H1", habitForming: true, mrpPaise: 2200, pack: "Strip of 10", inStock: true },
  { id: "b006", name: "Cetaphil Gentle Cleanser", composition: "Skin cleanser", schedule: "OTC", mrpPaise: 46500, pack: "125 ml", inStock: true },
];

export function Shop() {
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [fulfilment, setFulfilment] = useState<"delivery" | "pickup">("delivery");
  const [pincode, setPincode] = useState("");
  const [rxUploaded, setRxUploaded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);

  const list = CATALOGUE.filter((i) => !q || `${i.name} ${i.composition}`.toLowerCase().includes(q.toLowerCase()));
  const lines = Object.entries(cart).filter(([, n]) => n > 0).map(([id, n]) => ({ item: CATALOGUE.find((c) => c.id === id)!, n }));
  const total = lines.reduce((s, l) => s + l.item.mrpPaise * l.n, 0);
  const issues = useMemo(() => validateOnlineCart(lines.map((l) => ({ id: l.item.id, name: l.item.name, schedule: l.item.schedule, habitForming: l.item.habitForming })), { fulfilment, rxUploaded }), [lines, fulfilment, rxUploaded]);
  const serviceable = fulfilment === "pickup" || ["560038", "560008", "560071"].includes(pincode);
  const canOrder = lines.length > 0 && !hasBlockingIssue(issues) && serviceable && consent;

  if (placed) return (
    <div className="rounded-lg bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold">Order placed · {placed}</h1>
      <p className="mt-2 text-sm text-muted">{lines.some((l) => requiresRx(l.item)) ? "Our pharmacist is checking your prescription. You'll get a WhatsApp update in about 15 minutes." : "We're packing your order."}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <input aria-label="Search medicines" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search medicines, salts, wellness…" className="w-full rounded-lg border border-line bg-surface px-4 py-3" />
      <ul className="space-y-2">
        {list.map((i) => {
          const rx = requiresRx(i);
          const storeOnly = i.schedule === "X" || i.schedule === "NDPS" || i.habitForming;
          return (
            <li key={i.id} className="flex items-center justify-between rounded-lg bg-surface p-3">
              <div>
                <div className="font-medium">{i.name} {i.coldChain && <span title="Cold chain" className="text-cold">❄</span>}</div>
                <div className="text-xs text-muted">{i.composition} · {i.pack}</div>
                <div className="mt-1 flex gap-1 text-[11px]">
                  {rx && <span className="rounded border border-sch-h px-1 text-sch-h">Rx required</span>}
                  {storeOnly && <span className="rounded border border-sch-x px-1 text-sch-x">Store pickup only</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="num font-semibold">{formatINR(i.mrpPaise)}</div>
                <div className="mt-1 flex items-center gap-2">
                  <button aria-label={`Remove one ${i.name}`} className="h-11 w-11 rounded-full border border-line" onClick={() => setCart((c) => ({ ...c, [i.id]: Math.max(0, (c[i.id] ?? 0) - 1) }))}>−</button>
                  <span className="num w-4 text-center">{cart[i.id] ?? 0}</span>
                  <button aria-label={`Add one ${i.name}`} className="h-11 w-11 rounded-full bg-brand-700 text-white" onClick={() => setCart((c) => ({ ...c, [i.id]: (c[i.id] ?? 0) + 1 }))}>+</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <section id="cart" className="space-y-3 rounded-lg bg-surface p-4">
        <h2 className="font-semibold">Your cart · <span className="num">{formatINR(total)}</span></h2>
        <div role="radiogroup" aria-label="Fulfilment" className="flex gap-2 text-sm">
          {(["delivery", "pickup"] as const).map((f) => (
            <button key={f} role="radio" aria-checked={fulfilment === f} onClick={() => setFulfilment(f)} className={`min-h-11 flex-1 rounded border px-3 ${fulfilment === f ? "border-brand-700 bg-brand-50" : "border-line"}`}>
              {f === "delivery" ? "Home delivery" : "Store pickup"}</button>))}
        </div>
        {fulfilment === "delivery" && (
          <label className="block text-sm">Pincode
            <input inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full rounded border border-line px-3 py-2" />
            {pincode.length === 6 && !serviceable && <span className="text-danger">We don't deliver to {pincode} yet — choose store pickup.</span>}
          </label>
        )}
        {lines.some((l) => requiresRx(l.item)) && (
          <div className="rounded border border-sch-h/40 bg-sch-h/5 p-3 text-sm">
            <p>Your cart has prescription medicines. <Link href="/upload-rx" className="underline">Upload a prescription</Link> or attach from your Rx vault.</p>
            <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={rxUploaded} onChange={(e) => setRxUploaded(e.target.checked)} /> I have uploaded a valid prescription (demo)</label>
          </div>
        )}
        {issues.map((i) => <p key={i.code + (i.productId ?? "")} className={i.severity === "block" ? "text-sm text-danger" : "text-sm text-warn"}>{i.message}</p>)}
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
          I agree to MedStar processing my order and prescription data to fulfil this order, as described in the privacy notice. (Marketing messages are a separate choice.)
        </label>
        <button disabled={!canOrder} onClick={() => setPlaced("WEB-" + Math.random().toString(36).slice(2, 8).toUpperCase())} className="min-h-12 w-full rounded-lg bg-brand-700 font-medium text-white disabled:opacity-40">
          Place order · pay online / COD</button>
      </section>
    </div>
  );
}
