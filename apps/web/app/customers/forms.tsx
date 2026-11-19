"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatINR, isValidGstin, rupeesToPaise } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { inputCls } from "@/components/ui";

export function CustomerForm({ orgId, onCreated, compact }: { orgId: string; onCreated?: (c: { id: string; name: string | null; phone: string }) => void; compact?: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", phone: "", address: "", gstin: "", consent: false });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: "name" | "phone" | "address" | "gstin") => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: k === "gstin" ? e.target.value.toUpperCase() : e.target.value }));
  return (
    <form className={`grid gap-2 text-sm ${compact ? "grid-cols-2" : "grid-cols-4"}`} onSubmit={async (e) => {
      e.preventDefault();
      if (!/^[0-9]{10}$/.test(f.phone)) { setMsg({ ok: false, text: "Mobile must be 10 digits" }); return; }
      if (f.gstin && !isValidGstin(f.gstin)) { setMsg({ ok: false, text: "GSTIN is not valid" }); return; }
      if (!f.consent) { setMsg({ ok: false, text: "Confirm the customer was shown the privacy notice" }); return; }
      const sb = supabaseBrowser()!;
      const { data, error } = await sb.from("customers").insert({ org_id: orgId, name: f.name.trim() || null, phone: f.phone, address: f.address.trim() || null, gstin: f.gstin || null })
        .select("id, name, phone").single();
      if (error) { setMsg({ ok: false, text: error.code === "23505" ? "A customer with this mobile already exists" : error.message }); return; }
      await sb.from("consents").insert({ org_id: orgId, customer_id: data.id, purpose: "service", notice_version: "2026-11", granted: true, channel: "counter" });
      setF({ name: "", phone: "", address: "", gstin: "", consent: false });
      setMsg({ ok: true, text: "Customer added" });
      onCreated?.(data);
      router.refresh();
    }}>
      <label>Mobile<input required inputMode="numeric" maxLength={10} className={inputCls} value={f.phone} onChange={set("phone")} /></label>
      <label>Name<input className={inputCls} value={f.name} onChange={set("name")} /></label>
      <label className={compact ? "col-span-2" : ""}>Address (needed for H1/X sales)<input className={inputCls} value={f.address} onChange={set("address")} /></label>
      {!compact && <label>GSTIN (clinics / B2B)<input className={inputCls} value={f.gstin} onChange={set("gstin")} maxLength={15} /></label>}
      <label className={`flex items-center gap-1 ${compact ? "col-span-2" : "col-span-4"}`}><input type="checkbox" checked={f.consent} onChange={(e) => setF((x) => ({ ...x, consent: e.target.checked }))} />
        Customer has seen the privacy notice and agrees to their details being kept for billing (DPDP)</label>
      <button className={`justify-self-start rounded bg-brand-700 px-3 py-1.5 text-white ${compact ? "col-span-2" : "col-span-4"}`}>Add customer</button>
      {msg && <p className={`${compact ? "col-span-2" : "col-span-4"} ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </form>
  );
}

export function CreditLimitEdit({ customerId, limitPaise }: { customerId: string; limitPaise: number }) {
  const router = useRouter();
  const [v, setV] = useState(String(limitPaise / 100));
  const [state, setState] = useState<"idle" | "saving" | "err">("idle");
  return (
    <span className="inline-flex items-center gap-1">
      ₹<input aria-label="Credit limit" value={v} onChange={(e) => setV(e.target.value)} className="w-20 rounded border border-line px-1 text-right" />
      {v !== String(limitPaise / 100) && <button className="text-xs text-brand-700 underline" onClick={async () => {
        setState("saving");
        let paise: number; try { paise = rupeesToPaise(v || "0"); } catch { setState("err"); return; }
        const { error } = await supabaseBrowser()!.from("customers").update({ credit_limit_paise: paise }).eq("id", customerId);
        setState(error ? "err" : "idle"); if (!error) router.refresh();
      }}>{state === "saving" ? "…" : "Save"}</button>}
      {state === "err" && <span className="text-xs text-danger">failed</span>}
    </span>
  );
}

export function CustomerReceipt({ storeId, customerId, outstandingPaise }: { storeId: string; customerId: string; outstandingPaise: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("cash");
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  if (!open) return <button className="text-brand-700 underline" onClick={() => setOpen(true)}>Receive payment</button>;
  return (
    <form className="flex flex-wrap items-center gap-1" onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      let paise: number; try { paise = rupeesToPaise(amount); } catch { setErr("Enter an amount"); return; }
      const { error } = await supabaseBrowser()!.rpc("post_customer_receipt", { p: { idempotencyKey: key, storeId, customerId, amountPaise: paise, mode } });
      if (error) { setErr(error.message); return; }
      setOpen(false); setAmount(""); setKey(crypto.randomUUID()); router.refresh();
    }}>
      <input aria-label="Amount received" placeholder={`max ${formatINR(outstandingPaise)}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 rounded border border-line px-1 py-0.5" />
      <select aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value)} className="rounded border border-line px-1 py-0.5">
        <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank">Bank</option></select>
      <button className="rounded bg-brand-700 px-2 py-0.5 text-white">Save</button>
      <button type="button" className="text-muted" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="w-full text-danger">{err}</span>}
    </form>
  );
}
