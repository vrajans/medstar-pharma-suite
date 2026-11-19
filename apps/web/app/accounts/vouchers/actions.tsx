"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase";

export function ReverseVoucher({ id, no }: { id: string; no: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="text-xs text-danger underline" onClick={() => setOpen(true)}>Reverse</button>;
  return (
    <form className="flex flex-wrap items-center gap-1" onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      const { error } = await supabaseBrowser()!.rpc("reverse_voucher", { p_voucher: id, p_reason: reason, p_date: null });
      if (error) { setErr(error.message); return; }
      setOpen(false); router.refresh();
    }}>
      <input aria-label={`Reason to reverse ${no}`} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-40 rounded border border-line px-1 py-0.5 text-xs" />
      <button className="rounded bg-danger px-2 py-0.5 text-xs text-white">Reverse</button>
      <button type="button" className="text-xs text-muted" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="w-full text-xs text-danger">{err}</span>}
    </form>
  );
}

export function ViewAttachment({ path }: { path: string }) {
  const [err, setErr] = useState(false);
  return (
    <button className="text-xs text-brand-700 underline" onClick={async () => {
      const { data, error } = await supabaseBrowser()!.storage.from("documents").createSignedUrl(path, 120);
      if (error || !data) { setErr(true); return; }
      window.open(data.signedUrl, "_blank", "noopener");
    }}>{err ? "unavailable" : "bill"}</button>
  );
}
