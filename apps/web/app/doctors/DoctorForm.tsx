"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase";
import { inputCls } from "@/components/ui";

export interface DoctorRow { id: string; name: string; reg_no: string | null; address: string | null; qualification: string | null }

export function DoctorForm({ orgId, onCreated, compact }: { orgId: string; onCreated?: (d: DoctorRow) => void; compact?: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", qualification: "", council: "", regNo: "", address: "", phone: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const span = compact ? "col-span-2" : "col-span-3";
  return (
    <form className={`grid gap-2 text-sm ${compact ? "grid-cols-2" : "grid-cols-3"}`} onSubmit={async (e) => {
      e.preventDefault();
      const { data, error } = await supabaseBrowser()!.from("doctors").insert({
        org_id: orgId, name: f.name.trim(), qualification: f.qualification.trim() || null, council: f.council.trim() || null,
        reg_no: f.regNo.trim().toUpperCase() || null, address: f.address.trim() || null, phone: f.phone.trim() || null,
      }).select("id, name, reg_no, address, qualification").single();
      if (error) { setMsg({ ok: false, text: error.code === "23505" ? "A doctor with this registration number already exists" : error.message }); return; }
      setF({ name: "", qualification: "", council: "", regNo: "", address: "", phone: "" });
      setMsg({ ok: true, text: "Doctor added" });
      onCreated?.(data);
      router.refresh();
    }}>
      <label>Name<input required className={inputCls} value={f.name} onChange={set("name")} placeholder="Dr. S. Kumar" /></label>
      <label>Qualification<input className={inputCls} value={f.qualification} onChange={set("qualification")} placeholder="MBBS, MD" /></label>
      <label>Registration no.<input className={inputCls} value={f.regNo} onChange={set("regNo")} placeholder="KMC-12345" /></label>
      <label>Medical council<input className={inputCls} value={f.council} onChange={set("council")} placeholder="Karnataka Medical Council" /></label>
      <label className={compact ? "col-span-2" : ""}>Clinic address<input className={inputCls} value={f.address} onChange={set("address")} /></label>
      {!compact && <label>Phone<input className={inputCls} value={f.phone} onChange={set("phone")} /></label>}
      <button className={`${span} justify-self-start rounded bg-brand-700 px-3 py-1.5 text-white`}>Add doctor</button>
      {msg && <p className={`${span} ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </form>
  );
}
