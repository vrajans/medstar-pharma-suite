"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {err && <p role="alert" className="mb-3 text-sm text-danger">{err}</p>}
      <button disabled={busy} className="w-full rounded-md bg-brand-700 py-2 font-medium text-white disabled:opacity-50"
        onClick={async () => {
          const sb = supabaseBrowser();
          if (!sb) { setErr("Demo mode"); return; }
          setBusy(true);
          const { error } = await sb.rpc("accept_invitation", { p_token: token });
          setBusy(false);
          if (error) setErr(error.message);
          else { router.replace("/"); router.refresh(); }
        }}>
        {busy ? "Joining…" : "Accept invitation"}
      </button>
    </>
  );
}
