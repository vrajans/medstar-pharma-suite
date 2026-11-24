"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { escapeHtml as e, printHtml } from "@/lib/print";

export interface Suggestion {
  productId: string; name: string; manufacturer: string | null; packLabel: string; unitsPerPack: number; schedule: string; rack: string | null;
  stockBase: number; soldBase: number; reorderLevel: number; suggestedPacks: number; distributorId: string | null; distributor: string | null; lastRatePaise: number | null;
}
export interface Supplier { id: string; name: string; phone: string | null; licenceOk: boolean }
export interface PoPrint { no: string; at: string; store: { code: string; name: string; address?: string | null; gstin?: string | null; phone?: string | null; drugLicences?: string[] };
  orgName: string; supplier: { name: string }; lines: Array<{ name: string; manufacturer: string | null; packs: number; packLabel: string; ratePaise: number | null }> }

export function printPo(po: PoPrint) {
  const total = po.lines.reduce((s, l) => s + (l.ratePaise ?? 0) * l.packs, 0);
  printHtml(`Purchase order ${po.no}`, `
    <div class="head"><div><h1>PURCHASE ORDER</h1><div><b>${e(po.orgName)}</b> · ${e(po.store.name)}</div><div class="muted">${e(po.store.address ?? "")}</div>
      <div class="muted">${po.store.gstin ? `GSTIN ${e(po.store.gstin)} · ` : ""}${po.store.drugLicences?.length ? `DL ${e(po.store.drugLicences.join(", "))}` : ""}${po.store.phone ? ` · Ph ${e(po.store.phone)}` : ""}</div></div>
      <div><b>${e(po.no)}</b><br>${e(new Date(po.at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }))}<br>To: <b>${e(po.supplier.name)}</b></div></div>
    <table><tr><th>#</th><th>Item</th><th>Company</th><th class="r">Qty</th><th class="r">Last rate</th><th class="r">Approx. value</th></tr>
      ${po.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${e(l.name)}</td><td>${e(l.manufacturer ?? "")}</td><td class="r">${l.packs} ${e(l.packLabel)}</td>
        <td class="r">${l.ratePaise ? e(formatINR(l.ratePaise)) : ""}</td><td class="r">${l.ratePaise ? e(formatINR(l.ratePaise * l.packs)) : ""}</td></tr>`).join("")}
    </table><p>Approximate order value (before scheme / GST): <b>${e(formatINR(total))}</b></p>
    <p class="muted">Please supply with batch number, expiry and MRP on the invoice. Short-expiry stock (under 6 months) will not be accepted.</p>
    <div class="sign"><div></div><div>Authorised signatory<br><br>______________________</div></div>`, "a4-portrait");
}

export function poWhatsAppText(po: PoPrint) {
  return [`*Purchase order ${po.no}* — ${po.orgName}, ${po.store.name}`, ...po.lines.map((l, i) => `${i + 1}. ${l.name} — ${l.packs} ${l.packLabel}`),
    "Please confirm availability and expected delivery. Thank you."].join("\n");
}

export const waLink = (phone: string | null | undefined, text: string) => {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^0/, "");
  const to = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
};

export function ShortList({ storeId, suggestions, suppliers, store, orgName }: {
  storeId: string; suggestions: Suggestion[]; suppliers: Supplier[]; store: PoPrint["store"]; orgName: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, { on: boolean; packs: number; supplier: string }>>(() =>
    Object.fromEntries(suggestions.map((s) => [s.productId, { on: true, packs: s.suggestedPacks, supplier: s.distributorId ?? "" }])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string; wa?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const g = new Map<string, Suggestion[]>();
    for (const s of suggestions) { const sup = picked[s.productId]?.supplier ?? ""; g.set(sup, [...(g.get(sup) ?? []), s]); }
    return [...g].sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1));
  }, [suggestions, picked]);
  const supName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "Choose a supplier";

  const placeOrder = async (supplierId: string, items: Suggestion[]) => {
    const lines = items.filter((s) => picked[s.productId]?.on && (picked[s.productId]?.packs ?? 0) > 0);
    if (!lines.length) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabaseBrowser()!.rpc("create_purchase_order", { p: {
      idempotencyKey: crypto.randomUUID(), storeId, distributorId: supplierId,
      lines: lines.map((s) => ({ productId: s.productId, qtyPacks: picked[s.productId]!.packs, expectedRatePaise: s.lastRatePaise })),
    } });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    const sup = suppliers.find((s) => s.id === supplierId)!;
    const po: PoPrint = { no: data.poNo, at: new Date().toISOString(), store, orgName, supplier: { name: sup.name },
      lines: lines.map((s) => ({ name: s.name, manufacturer: s.manufacturer, packs: picked[s.productId]!.packs, packLabel: s.packLabel, ratePaise: s.lastRatePaise })) };
    printPo(po);
    setMsg({ ok: true, text: `Order ${data.poNo} created for ${sup.name}.`, wa: waLink(sup.phone, poWhatsAppText(po)) });
    router.refresh();
  };

  if (!suggestions.length) return <p className="rounded border border-line bg-surface p-4 text-sm text-muted">Nothing to reorder: every item is above its reorder level and its last 30 days of sales. Set reorder levels on products to get a fuller list.</p>;
  return (
    <div className="space-y-4 text-sm">
      {msg && <p role="status" className={msg.ok ? "text-ok" : "text-danger"}>{msg.text} {msg.wa && <a className="ml-2 rounded bg-[#25D366] px-2 py-1 text-white" href={msg.wa} target="_blank" rel="noopener">Send on WhatsApp</a>}</p>}
      {groups.map(([sup, items]) => (
        <section key={sup || "none"} className="rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="font-semibold">{sup ? supName(sup) : "No supplier yet — pick one per item"} <span className="font-normal text-muted">({items.length})</span></h2>
            {sup && <button disabled={busy || !suppliers.find((s) => s.id === sup)?.licenceOk} onClick={() => placeOrder(sup, items)}
              className="rounded bg-brand-700 px-3 py-1 text-white disabled:opacity-50">{suppliers.find((s) => s.id === sup)?.licenceOk ? "Create order & print" : "Supplier licence expired"}</button>}
          </div>
          <table className="w-full">
            <thead className="text-left text-xs uppercase text-muted"><tr><th className="w-8 px-3" /><th>Item</th><th className="text-right">In stock</th><th className="text-right">Sold 30 d</th><th className="text-right">Reorder at</th><th className="w-28 text-right">Order</th><th className="px-3">Supplier</th></tr></thead>
            <tbody>{items.map((s) => {
              const pk = picked[s.productId]!;
              const set = (patch: Partial<typeof pk>) => setPicked((p) => ({ ...p, [s.productId]: { ...pk, ...patch } }));
              const packs = (u: number) => `${Math.floor(u / s.unitsPerPack)}${u % s.unitsPerPack ? `+${u % s.unitsPerPack}` : ""}`;
              return (
                <tr key={s.productId} className="border-t border-line">
                  <td className="px-3"><input type="checkbox" aria-label={`Order ${s.name}`} checked={pk.on} onChange={(ev) => set({ on: ev.target.checked })} /></td>
                  <td className="py-1">{s.name}<div className="text-xs text-muted">{s.manufacturer}{s.rack && ` · Rack ${s.rack}`}{s.lastRatePaise ? ` · last ${formatINR(s.lastRatePaise)}/${s.packLabel}` : ""}</div></td>
                  <td className={`num text-right ${s.stockBase === 0 ? "text-danger" : ""}`}>{packs(s.stockBase)}</td>
                  <td className="num text-right">{packs(s.soldBase)}</td>
                  <td className="num text-right">{s.reorderLevel || "—"}</td>
                  <td className="text-right"><input aria-label={`Packs of ${s.name}`} type="number" min={0} value={pk.packs} onChange={(ev) => set({ packs: Number(ev.target.value) })} className="w-16 rounded border border-line px-1 text-right" /> {s.packLabel}</td>
                  <td className="px-3"><select aria-label={`Supplier for ${s.name}`} value={pk.supplier} onChange={(ev) => set({ supplier: ev.target.value })} className="max-w-[12rem] rounded border border-line px-1 py-0.5">
                    <option value="">—</option>{suppliers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td>
                </tr>);
            })}</tbody>
          </table>
        </section>))}
    </div>
  );
}

export function PoActions({ id, po, phone }: { id: string; po: PoPrint; phone: string | null }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const set = async (status: "received" | "cancelled") => {
    const { error } = await supabaseBrowser()!.rpc("set_purchase_order_status", { p_po: id, p_status: status });
    if (error) setErr(error.message); else router.refresh();
  };
  return (
    <span className="space-x-2 text-xs">
      {err && <span className="text-danger">{err}</span>}
      <button className="text-brand-700 underline" onClick={() => printPo(po)}>Print</button>
      <a className="text-brand-700 underline" href={waLink(phone, poWhatsAppText(po))} target="_blank" rel="noopener">WhatsApp</a>
      <button className="text-ok underline" onClick={() => set("received")}>Mark received</button>
      <button className="text-danger underline" onClick={() => set("cancelled")}>Cancel</button>
    </span>
  );
}
