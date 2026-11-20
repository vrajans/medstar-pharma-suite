"use client";
import { useState } from "react";
import { ScheduleBadge } from "@/components/ScheduleBadge";
import type { DrugSchedule } from "@medstar/core";

interface QueueItem {
  id: string; orderNo: string; customer: string; placedAt: string; pincode: string;
  items: Array<{ name: string; schedule: DrugSchedule; qty: string }>;
  rx: { doctor: string; regNo: string; date: string; patient: string };
}

const QUEUE: QueueItem[] = [
  { id: "o1", orderNo: "WEB-261117-A1B2C3", customer: "Meena R · 98xxxx0001", placedAt: "10:42", pincode: "560038",
    items: [{ name: "Azithral 500 Tablet", schedule: "H", qty: "1 Strip" }, { name: "Dolo 650 Tablet", schedule: "OTC", qty: "2 Strip" }],
    rx: { doctor: "Dr. S. Kumar, MBBS", regNo: "KMC-12345", date: "2026-11-15", patient: "Meena R" } },
  { id: "o2", orderNo: "WEB-261117-D4E5F6", customer: "Arjun P · 97xxxx1188", placedAt: "10:55", pincode: "560008",
    items: [{ name: "Huminsulin R 40IU/ml Vial", schedule: "H", qty: "2 Vial" }],
    rx: { doctor: "Dr. L. Iyer, MD", regNo: "KMC-88310", date: "2025-12-01", patient: "Arjun P" } },
];

const CHECKS = ["Doctor name & qualification legible", "Doctor registration number present", "Prescription date within validity", "Patient name matches order", "Doctor signature / stamp present", "Medicines & quantities match Rx"];

export default function RxVerifyPage() {
  const [sel, setSel] = useState<QueueItem>(QUEUE[0]!);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Record<string, "approved" | "rejected">>({});
  const [reason, setReason] = useState("");
  const ageDays = Math.floor((Date.now() - Date.parse(sel.rx.date)) / 86_400_000);
  const allChecked = CHECKS.every((c) => checked[`${sel.id}:${c}`]);

  return (
    <div className="grid h-[calc(100vh-3rem)] grid-cols-[280px_1fr_380px]">
      <aside className="overflow-auto border-r border-line bg-surface">
        <h1 className="p-3 text-sm font-semibold">Rx verification queue</h1>
        {QUEUE.map((q) => (
          <button key={q.id} onClick={() => { setSel(q); setReason(""); }} className={`block w-full border-t border-line p-3 text-left text-sm ${sel.id === q.id ? "bg-brand-50" : ""}`}>
            <div className="font-medium">{q.orderNo}</div>
            <div className="text-muted">{q.customer} · {q.placedAt}</div>
            {done[q.id] && <div className={done[q.id] === "approved" ? "text-ok" : "text-danger"}>{done[q.id]}</div>}
          </button>
        ))}
      </aside>

      <section className="flex items-center justify-center bg-ink/90 p-6 text-white">
        <div className="aspect-[3/4] h-full max-h-[80vh] rounded bg-white/10 p-6 text-sm">
          <p className="opacity-70">Prescription image (signed URL, 5-minute expiry, access logged)</p>
          <p className="mt-6 text-lg">{sel.rx.doctor}</p>
          <p>Reg. No. {sel.rx.regNo}</p>
          <p>Date: {sel.rx.date}</p>
          <p className="mt-4">Patient: {sel.rx.patient}</p>
          <ul className="mt-4 list-disc pl-5">{sel.items.map((i) => <li key={i.name}>{i.name}</li>)}</ul>
        </div>
      </section>

      <aside className="space-y-3 overflow-auto bg-surface p-4 text-sm">
        <h2 className="font-semibold">Order items</h2>
        <ul className="space-y-1">{sel.items.map((i) => (
          <li key={i.name} className="flex items-center justify-between"><span className="flex items-center gap-2"><ScheduleBadge schedule={i.schedule} />{i.name}</span><span>{i.qty}</span></li>))}
        </ul>
        {ageDays > 180 && <p className="rounded bg-warn/10 p-2 text-warn">Prescription is {ageDays} days old (store policy: 180).</p>}
        <h2 className="pt-2 font-semibold">Checklist</h2>
        {CHECKS.map((c) => (
          <label key={c} className="flex items-center gap-2">
            <input type="checkbox" checked={!!checked[`${sel.id}:${c}`]} onChange={(e) => setChecked((x) => ({ ...x, [`${sel.id}:${c}`]: e.target.checked }))} /> {c}
          </label>))}
        <textarea aria-label="Rejection reason" placeholder="Reason (required to reject)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-20 w-full rounded border border-line p-2" />
        <div className="flex gap-2">
          <button disabled={!allChecked || !!done[sel.id]} onClick={() => setDone((d) => ({ ...d, [sel.id]: "approved" }))} className="flex-1 rounded bg-ok py-2 text-white disabled:opacity-40">Approve</button>
          <button disabled={!reason.trim() || !!done[sel.id]} onClick={() => setDone((d) => ({ ...d, [sel.id]: "rejected" }))} className="flex-1 rounded bg-danger py-2 text-white disabled:opacity-40">Reject</button>
        </div>
        <p className="text-xs text-muted">Approve calls <code>verify_online_rx()</code>; the database refuses to move an Rx order to picking without it.</p>
      </aside>
    </div>
  );
}
