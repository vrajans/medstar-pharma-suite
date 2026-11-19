"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SCHEDULE_INFO, type DrugSchedule } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { inputCls } from "@/components/ui";

export interface ProductFormValue {
  id?: string; name: string; manufacturer: string; composition: string; dosage_form: string; category: string; hsn: string;
  schedule: DrugSchedule; rx_required: boolean; habit_forming: boolean; cold_chain: boolean; pack_label: string; base_unit_label: string;
  units_per_pack: number; allow_loose: boolean; reorder_level: number; rack: string; gst_rate_override: string; listed_online: boolean;
  is_active: boolean; blocked_reason: string; barcodes: string[];
}

export const EMPTY_PRODUCT: ProductFormValue = {
  name: "", manufacturer: "", composition: "", dosage_form: "Tablet", category: "Rx", hsn: "30049099", schedule: "OTC", rx_required: false,
  habit_forming: false, cold_chain: false, pack_label: "Strip", base_unit_label: "Tab", units_per_pack: 10, allow_loose: true, reorder_level: 0,
  rack: "", gst_rate_override: "", listed_online: false, is_active: true, blocked_reason: "", barcodes: [],
};

export function ProductForm({ orgId, initial, canEdit }: { orgId: string; initial: ProductFormValue; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [newCode, setNewCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const set = <K extends keyof ProductFormValue>(k: K, v: ProductFormValue[K]) => setF((x) => ({ ...x, [k]: v }));
  const txt = (k: keyof ProductFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, e.target.value as never);
  const chk = (k: keyof ProductFormValue) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.checked as never);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{4,8}$/.test(f.hsn)) { setMsg({ kind: "err", text: "HSN must be 4–8 digits" }); return; }
    if (f.gst_rate_override !== "" && !(Number(f.gst_rate_override) >= 0 && Number(f.gst_rate_override) <= 40)) { setMsg({ kind: "err", text: "GST override must be 0–40" }); return; }
    const sb = supabaseBrowser()!;
    setBusy(true); setMsg(null);
    const row = {
      org_id: orgId, name: f.name.trim(), manufacturer: f.manufacturer.trim() || null, composition: f.composition.trim() || null,
      dosage_form: f.dosage_form || null, category: f.category, hsn: f.hsn, schedule: f.schedule, rx_required: f.rx_required,
      habit_forming: f.habit_forming, cold_chain: f.cold_chain, pack_label: f.pack_label, base_unit_label: f.base_unit_label,
      units_per_pack: Number(f.units_per_pack), allow_loose: f.allow_loose, reorder_level: Number(f.reorder_level), rack: f.rack || null,
      gst_rate_override: f.gst_rate_override === "" ? null : Number(f.gst_rate_override), listed_online: f.listed_online, is_active: f.is_active,
      blocked_reason: f.blocked_reason.trim() || null, updated_at: new Date().toISOString(),
    };
    const res = f.id ? await sb.from("products").update(row).eq("id", f.id).select("id").single() : await sb.from("products").insert(row).select("id").single();
    setBusy(false);
    if (res.error) { setMsg({ kind: "err", text: res.error.message }); return; }
    const id = res.data.id as string;
    // barcodes: add new, remove deleted
    const before = new Set(initial.barcodes), after = new Set(f.barcodes);
    const add = [...after].filter((b) => !before.has(b)).map((barcode) => ({ org_id: orgId, product_id: id, barcode }));
    const del = [...before].filter((b) => !after.has(b));
    if (add.length) { const r = await sb.from("product_barcodes").insert(add); if (r.error) { setMsg({ kind: "err", text: `Saved, but barcode: ${r.error.message}` }); return; } }
    if (del.length) await sb.from("product_barcodes").delete().eq("product_id", id).in("barcode", del);
    setMsg({ kind: "ok", text: "Saved" });
    if (!f.id) router.replace(`/products/${id}`);
    router.refresh();
  };

  const rxImplied = SCHEDULE_INFO[f.schedule].rx;
  return (
    <form onSubmit={save} className="grid grid-cols-3 gap-3 text-sm">
      <fieldset disabled={!canEdit || busy} className="contents">
        <label className="col-span-2">Brand name<input required className={inputCls} value={f.name} onChange={txt("name")} /></label>
        <label>Manufacturer<input className={inputCls} value={f.manufacturer} onChange={txt("manufacturer")} /></label>
        <label className="col-span-2">Composition / salt (with strength)<input className={inputCls} value={f.composition} onChange={txt("composition")} placeholder="Paracetamol 650mg" /></label>
        <label>Dosage form<select className={inputCls} value={f.dosage_form} onChange={txt("dosage_form")}>
          {["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Drops", "Cream", "Ointment", "Inhaler", "Powder", "Device", "Other"].map((d) => <option key={d}>{d}</option>)}</select></label>

        <label>Category<select className={inputCls} value={f.category} onChange={txt("category")}>
          {["Rx", "OTC", "Wellness", "FMCG", "Surgical", "Ayurveda", "Devices"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Drug schedule<select className={inputCls} value={f.schedule} onChange={txt("schedule")}>
          {(Object.keys(SCHEDULE_INFO) as DrugSchedule[]).map((s) => <option key={s} value={s}>{SCHEDULE_INFO[s].label}</option>)}</select></label>
        <label>HSN<input required className={inputCls} value={f.hsn} onChange={txt("hsn")} inputMode="numeric" maxLength={8} /></label>

        <div className="col-span-3 flex flex-wrap gap-4 rounded border border-line p-2">
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.rx_required || rxImplied} disabled={rxImplied} onChange={chk("rx_required")} /> Prescription required{rxImplied && " (by schedule)"}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.habit_forming} onChange={chk("habit_forming")} /> Habit-forming (never delivered online)</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.cold_chain} onChange={chk("cold_chain")} /> Cold chain (2–8 °C)</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.listed_online} onChange={chk("listed_online")} /> Show on storefront</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.is_active} onChange={chk("is_active")} /> Active</label>
        </div>

        <label>Pack (MRP printed on)<input className={inputCls} value={f.pack_label} onChange={txt("pack_label")} placeholder="Strip / Bottle / Box" /></label>
        <label>Base unit<input className={inputCls} value={f.base_unit_label} onChange={txt("base_unit_label")} placeholder="Tab / ml / Piece" /></label>
        <label>Base units per pack<input type="number" min={1} required className={inputCls} value={f.units_per_pack} onChange={(e) => set("units_per_pack", Number(e.target.value))} /></label>
        <label className="flex items-center gap-1 self-end pb-2"><input type="checkbox" checked={f.allow_loose} onChange={chk("allow_loose")} /> Allow loose sale (cut strips)</label>
        <label>Reorder level (packs)<input type="number" min={0} className={inputCls} value={f.reorder_level} onChange={(e) => set("reorder_level", Number(e.target.value))} /></label>
        <label>Rack / shelf<input className={inputCls} value={f.rack} onChange={txt("rack")} /></label>

        <label>GST override %<input className={inputCls} value={f.gst_rate_override} onChange={txt("gst_rate_override")} placeholder="blank = use HSN rate" />
          <span className="text-xs text-muted">Use 0 for notified Nil-rated life-saving drugs (CA to confirm).</span></label>
        <label className="col-span-2">Blocked reason (banned FDC / NSQ — blocks sale)<input className={inputCls} value={f.blocked_reason} onChange={txt("blocked_reason")} /></label>

        <div className="col-span-3">
          <span>Barcodes</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {f.barcodes.map((b) => (
              <span key={b} className="flex items-center gap-1 rounded bg-canvas px-2 py-0.5 font-mono text-xs">{b}
                <button type="button" aria-label={`Remove barcode ${b}`} onClick={() => set("barcodes", f.barcodes.filter((x) => x !== b))}>✕</button></span>))}
            <input value={newCode} onChange={(e) => setNewCode(e.target.value.trim())} placeholder="Scan or type, then Enter" className="w-56 rounded border border-line px-2 py-1"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newCode && !f.barcodes.includes(newCode)) set("barcodes", [...f.barcodes, newCode]); setNewCode(""); } }} />
          </div>
        </div>
      </fieldset>
      {msg && <p role="status" className={`col-span-3 ${msg.kind === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      {canEdit && <button disabled={busy} className="col-span-3 justify-self-start rounded-md bg-brand-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Saving…" : "Save product"}</button>}
    </form>
  );
}
