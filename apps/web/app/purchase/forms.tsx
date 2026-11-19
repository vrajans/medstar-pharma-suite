"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatINR, isValidGstin, rupeesToPaise } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { GST_STATES } from "@/lib/india";
import { inputCls } from "@/components/ui";

export function DistributorForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", gstin: "", stateCode: "", licence: "", licenceTo: "", creditDays: "30", phone: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: k === "gstin" ? e.target.value.toUpperCase() : e.target.value }));
  return (
    <form className="grid grid-cols-4 gap-2 text-sm" onSubmit={async (e) => {
      e.preventDefault();
      if (f.gstin && !isValidGstin(f.gstin)) { setMsg({ ok: false, text: "GSTIN is not valid" }); return; }
      const state = f.gstin ? f.gstin.slice(0, 2) : f.stateCode;
      if (!state) { setMsg({ ok: false, text: "Choose the distributor's state (or enter a GSTIN)" }); return; }
      const { error } = await supabaseBrowser()!.from("distributors").insert({
        org_id: orgId, name: f.name.trim(), gstin: f.gstin || null, state_code: state, drug_licence_no: f.licence.trim(),
        drug_licence_valid_to: f.licenceTo || null, credit_days: Number(f.creditDays) || 0, phone: f.phone || null,
      });
      if (error) { setMsg({ ok: false, text: error.message }); return; }
      setF({ name: "", gstin: "", stateCode: "", licence: "", licenceTo: "", creditDays: "30", phone: "" });
      setMsg({ ok: true, text: "Distributor added" });
      router.refresh();
    }}>
      <label className="col-span-2">Name<input required className={inputCls} value={f.name} onChange={set("name")} /></label>
      <label>GSTIN<input className={inputCls} value={f.gstin} onChange={set("gstin")} maxLength={15} /></label>
      <label>State (if no GSTIN)<select className={inputCls} value={f.gstin ? f.gstin.slice(0, 2) : f.stateCode} disabled={!!f.gstin} onChange={set("stateCode")}>
        <option value="">Select…</option>{GST_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></label>
      <label>Drug licence no. (20B/21B)<input required className={inputCls} value={f.licence} onChange={set("licence")} /></label>
      <label>Licence valid to<input type="date" className={inputCls} value={f.licenceTo} onChange={set("licenceTo")} /></label>
      <label>Credit days<input type="number" min={0} className={inputCls} value={f.creditDays} onChange={set("creditDays")} /></label>
      <label>Phone<input className={inputCls} value={f.phone} onChange={set("phone")} /></label>
      <button className="col-span-4 justify-self-start rounded bg-brand-700 px-3 py-1.5 text-white">Add distributor</button>
      {msg && <p className={`col-span-4 ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </form>
  );
}

export function SupplierPayment({ storeId, distributorId, name, duePaise }: { storeId: string; distributorId: string; name: string; duePaise: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("bank");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  if (!open) return <button className="text-brand-700 underline" onClick={() => setOpen(true)}>Record payment</button>;
  return (
    <form className="flex flex-wrap items-center gap-1" onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      let paise: number;
      try { paise = rupeesToPaise(amount); } catch { setErr("Enter an amount"); return; }
      const { error } = await supabaseBrowser()!.rpc("post_supplier_payment", { p: { idempotencyKey: key, storeId, distributorId, amountPaise: paise, mode, reference: ref } });
      if (error) { setErr(error.message); return; }
      setOpen(false); router.refresh();
    }}>
      <input aria-label={`Amount paid to ${name}`} placeholder={`max ${formatINR(duePaise)}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 rounded border border-line px-1 py-0.5" />
      <select aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value)} className="rounded border border-line px-1 py-0.5"><option value="bank">Bank/NEFT</option><option value="upi">UPI</option><option value="cash">Cash</option></select>
      <input aria-label="Reference" placeholder="UTR / cheque no." value={ref} onChange={(e) => setRef(e.target.value)} className="w-28 rounded border border-line px-1 py-0.5" />
      <button className="rounded bg-brand-700 px-2 py-0.5 text-white">Save</button>
      <button type="button" className="text-muted" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="w-full text-danger">{err}</span>}
    </form>
  );
}
