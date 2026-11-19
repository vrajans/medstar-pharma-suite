"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isValidGstin } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { selectStore } from "@/lib/actions";
import { GST_STATES, PAN_RE, PINCODE_RE } from "@/lib/india";

export function OnboardingForm() {
  const router = useRouter();
  const [f, setF] = useState({ legalName: "", tradeName: "", pan: "", code: "", storeName: "", gstScheme: "regular", gstin: "", stateCode: "", address: "", pincode: "", phone: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: k === "pan" || k === "gstin" || k === "code" ? e.target.value.toUpperCase() : e.target.value }));

  const validate = (): string | null => {
    if (!f.legalName.trim()) return "Legal name is required";
    if (f.pan && !PAN_RE.test(f.pan)) return "PAN format looks wrong (e.g. ABCPS1234D)";
    if (!/^[A-Z0-9]{1,5}$/.test(f.code)) return "Store code: 1–5 letters/digits, used on invoice numbers (e.g. PUN1)";
    if (!f.stateCode) return "Choose the store's state";
    if (f.gstScheme === "regular" && !f.gstin) return "Regular GST dealers need a GSTIN";
    if (f.gstin && !isValidGstin(f.gstin)) return "GSTIN is not valid (checksum failed)";
    if (f.gstin && f.gstin.slice(0, 2) !== f.stateCode) return "GSTIN state code does not match the selected state";
    if (f.gstin && f.pan && f.gstin.slice(2, 12) !== f.pan) return "GSTIN does not contain this PAN";
    if (!f.address.trim()) return "Address is required";
    if (!PINCODE_RE.test(f.pincode)) return "Pincode must be 6 digits";
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);
    const { data, error } = await supabaseBrowser()!.rpc("create_organization", {
      p: {
        legalName: f.legalName, tradeName: f.tradeName || f.legalName, pan: f.pan || null,
        store: { code: f.code, name: f.storeName || f.tradeName || f.legalName, gstScheme: f.gstScheme, gstin: f.gstin || null,
                 stateCode: f.stateCode, address: f.address, pincode: f.pincode, phone: f.phone || null },
      },
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await selectStore(data.storeId);
    router.replace("/settings?welcome=1");
    router.refresh();
  };

  const input = "mt-1 w-full rounded border border-line px-3 py-2";
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 text-sm">
      <label className="col-span-2">Legal name (as on GST / drug licence)<input className={input} value={f.legalName} onChange={set("legalName")} /></label>
      <label>Trade name<input className={input} value={f.tradeName} onChange={set("tradeName")} /></label>
      <label>PAN<input className={input} value={f.pan} onChange={set("pan")} maxLength={10} /></label>
      <h2 className="col-span-2 pt-2 font-semibold">First store</h2>
      <label>Store code (invoice prefix)<input className={input} value={f.code} onChange={set("code")} maxLength={5} placeholder="PUN1" /></label>
      <label>Store name<input className={input} value={f.storeName} onChange={set("storeName")} /></label>
      <label>State
        <select className={input} value={f.stateCode} onChange={set("stateCode")}>
          <option value="">Select…</option>
          {GST_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
        </select>
      </label>
      <label>GST scheme
        <select className={input} value={f.gstScheme} onChange={set("gstScheme")}>
          <option value="regular">Regular (Tax Invoice)</option>
          <option value="composition">Composition (Bill of Supply)</option>
        </select>
      </label>
      <label className="col-span-2">GSTIN<input className={input} value={f.gstin} onChange={set("gstin")} maxLength={15} placeholder="27ABCPS1234D1Z5" /></label>
      <label className="col-span-2">Address<textarea className={input} rows={2} value={f.address} onChange={set("address")} /></label>
      <label>Pincode<input className={input} value={f.pincode} onChange={set("pincode")} inputMode="numeric" maxLength={6} /></label>
      <label>Phone<input className={input} value={f.phone} onChange={set("phone")} inputMode="tel" /></label>
      {err && <p role="alert" className="col-span-2 text-danger">{err}</p>}
      <button disabled={busy} className="col-span-2 rounded-md bg-brand-700 py-2 font-medium text-white disabled:opacity-50">{busy ? "Creating…" : "Create pharmacy"}</button>
      <p className="col-span-2 text-xs text-muted">Next you'll add your drug licences, registered pharmacists and staff. You become the Owner of this pharmacy.</p>
    </form>
  );
}
