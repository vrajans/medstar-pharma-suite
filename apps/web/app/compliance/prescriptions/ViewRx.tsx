"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

/** Logs the view first (audit), then opens a 5-minute signed link to the private image. */
export function ViewRx({ id }: { id: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button className="text-brand-700 underline" onClick={async () => {
        setErr(null);
        const tab = window.open("about:blank", "_blank"); // open synchronously so popup blockers allow it
        const sb = supabaseBrowser()!;
        const { data: path, error } = await sb.rpc("log_rx_view", { p_prescription: id });
        if (error || !path) { tab?.close(); setErr(error?.message ?? "No image"); return; }
        const { data, error: e2 } = await sb.storage.from("prescriptions").createSignedUrl(path as string, 300);
        if (e2 || !data) { tab?.close(); setErr(e2?.message ?? "Image not found in storage"); return; }
        if (tab) tab.location.href = data.signedUrl; else window.location.href = data.signedUrl;
      }}>View</button>
      {err && <span className="ml-1 text-xs text-danger">{err}</span>}
    </>
  );
}
