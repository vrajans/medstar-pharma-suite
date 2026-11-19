"use client";
import { useEffect, useState } from "react";
import { formatINR } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { CustomerForm } from "@/app/customers/forms";
import { DoctorForm, type DoctorRow } from "@/app/doctors/DoctorForm";

export interface PosCustomer { id: string; name: string | null; phone: string; address: string | null; creditLimitPaise: number; outstandingPaise: number }

const clean = (s: string) => s.replace(/[%,()]/g, "").trim();

/** F4 at the counter: find by mobile/name, or quick-add (UC-CRM-01). */
export function CustomerDialog({ orgId, onPick, onClose }: { orgId: string; onPick: (c: PosCustomer) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PosCustomer[]>([]);
  const [adding, setAdding] = useState(false);
  const online = typeof navigator === "undefined" || navigator.onLine;

  useEffect(() => {
    const s = clean(q);
    if (s.length < 3) { setRows([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser()!.from("v_customer_balances").select("customer_id, name, phone, credit_limit_paise, outstanding_paise")
        .eq("org_id", orgId).eq("is_active", true).or(`phone.ilike.%${s}%,name.ilike.%${s}%`).limit(8);
      type BalRow = { customer_id: string; name: string | null; phone: string; credit_limit_paise: number; outstanding_paise: number };
      const bal = (data ?? []) as BalRow[];
      const ids = bal.map((d) => d.customer_id);
      const addr = ids.length ? ((await supabaseBrowser()!.from("customers").select("id, address").in("id", ids)).data ?? []) as Array<{ id: string; address: string | null }> : [];
      if (!cancelled) setRows(bal.map((d) => ({
        id: d.customer_id, name: d.name, phone: d.phone, address: addr.find((a) => a.id === d.customer_id)?.address ?? null,
        creditLimitPaise: Number(d.credit_limit_paise), outstandingPaise: Number(d.outstanding_paise),
      })));
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, orgId]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Customer" className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 print:hidden">
      <div className="w-[560px] space-y-3 rounded-lg bg-surface p-4 shadow-xl">
        <h2 className="font-semibold">Customer</h2>
        {!online && <p className="text-sm text-warn">Offline — customer lookup needs the internet. Bill as walk-in and attach the customer later.</p>}
        {!adding ? <>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mobile number or name (min 3 characters)"
            onKeyDown={(e) => { if (e.key === "Enter" && rows[0]) { e.preventDefault(); onPick(rows[0]); } }}
            className="w-full rounded border border-line px-3 py-2" />
          <ul className="divide-y divide-line text-sm">
            {rows.map((c) => (
              <li key={c.id}><button className="flex w-full items-center justify-between px-2 py-2 text-left hover:bg-brand-50" onClick={() => onPick(c)}>
                <span>{c.name ?? "—"} <span className="font-mono text-muted">{c.phone}</span></span>
                <span className={`num text-xs ${c.outstandingPaise > 0 ? "text-warn" : "text-muted"}`}>
                  {c.creditLimitPaise > 0 ? `Due ${formatINR(c.outstandingPaise)} / limit ${formatINR(c.creditLimitPaise)}` : "No credit"}</span>
              </button></li>))}
            {clean(q).length >= 3 && !rows.length && <li className="py-2 text-muted">No match.</li>}
          </ul>
          <div className="flex justify-between">
            <button className="text-brand-700 underline" onClick={() => setAdding(true)}>+ New customer</button>
            <button className="rounded border border-line px-3 py-1" onClick={onClose}>Close (walk-in)</button>
          </div>
        </> : <>
          <CustomerForm orgId={orgId} compact onCreated={(c) => onPick({ id: c.id, name: c.name, phone: c.phone, address: null, creditLimitPaise: 0, outstandingPaise: 0 })} />
          <button className="text-sm text-muted underline" onClick={() => setAdding(false)}>Back to search</button>
        </>}
      </div>
    </div>
  );
}

/** Doctor lookup inside the Rx dialog — fills prescriber name, registration no. and address. */
export function DoctorLookup({ orgId, onPick }: { orgId: string; onPick: (d: DoctorRow) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DoctorRow[]>([]);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const s = clean(q);
    if (s.length < 2) { setRows([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser()!.from("doctors").select("id, name, reg_no, address, qualification").eq("org_id", orgId)
        .or(`name.ilike.%${s}%,reg_no.ilike.%${s}%`).limit(6);
      if (!cancelled) setRows((data ?? []) as DoctorRow[]);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, orgId]);
  if (adding) return (
    <div className="rounded border border-line p-2">
      <DoctorForm orgId={orgId} compact onCreated={(d) => { onPick(d); setAdding(false); }} />
      <button type="button" className="text-xs text-muted underline" onClick={() => setAdding(false)}>Cancel</button>
    </div>
  );
  return (
    <div className="relative text-sm">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find doctor by name or reg. no." className="flex-1 rounded border border-line px-2 py-1" />
        <button type="button" className="text-brand-700 underline" onClick={() => setAdding(true)}>+ New doctor</button>
      </div>
      {rows.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded border border-line bg-surface shadow">
          {rows.map((d) => (
            <li key={d.id}><button type="button" className="w-full px-2 py-1 text-left hover:bg-brand-50" onClick={() => { onPick(d); setQ(""); setRows([]); }}>
              {d.name}{d.qualification && `, ${d.qualification}`} <span className="font-mono text-muted">{d.reg_no ?? "no reg. no."}</span></button></li>))}
        </ul>
      )}
    </div>
  );
}
