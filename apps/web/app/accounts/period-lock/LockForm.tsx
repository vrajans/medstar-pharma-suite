"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateIN } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { inputCls } from "@/components/ui";

/** Suggest the last day of the previous month. */
const lastMonthEnd = () => {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10);
};

export function LockForm({ orgId, current, isOwner }: { orgId: string; current: string | null; isOwner: boolean }) {
  const router = useRouter();
  const [until, setUntil] = useState(current && current >= lastMonthEnd() ? current : lastMonthEnd());
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const unlocking = !!current && (until === "" || until < current);
  const submit = async (value: string | null) => {
    setMsg(null);
    const { error } = await supabaseBrowser()!.rpc("set_period_lock", { p_org: orgId, p_until: value, p_reason: reason || null });
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setMsg({ ok: true, text: value ? `Books locked up to ${formatDateIN(value)}` : "Lock removed" }); setReason(""); router.refresh();
  };
  return (
    <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); void submit(until || null); }}>
      <div className="flex flex-wrap items-end gap-3">
        <label>Lock all entries up to and including<input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={inputCls} /></label>
        <label className="w-80">Reason {unlocking ? "(required to unlock)" : "(optional)"}<input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={unlocking ? "e.g. CA asked to correct a purchase entry" : "e.g. October GST filed"} className={inputCls} /></label>
        <button className={`rounded px-3 py-1.5 text-white ${unlocking ? "bg-danger" : "bg-brand-700"}`}>{unlocking ? "Unlock to this date" : "Lock books"}</button>
        {current && isOwner && <button type="button" className="rounded border border-danger px-3 py-1.5 text-danger" onClick={() => submit(null)}>Remove lock</button>}
      </div>
      {unlocking && !isOwner && <p className="text-warn">Only the owner can move the lock back.</p>}
      {msg && <p role="status" className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</p>}
    </form>
  );
}
