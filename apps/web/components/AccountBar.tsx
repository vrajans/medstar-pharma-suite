"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { selectStore } from "@/lib/actions";
import { supabaseBrowser } from "@/lib/supabase";
import { clearOfflineShell } from "./ServiceWorker";
import { ROLE_LABEL, type AppCtx } from "@/lib/types";

export function AccountBar({ ctx }: { ctx: AppCtx }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!ctx.email) return null;
  const options = ctx.orgs.flatMap((o) => o.stores.map((s) => ({ id: s.id, label: `${o.orgName} · ${s.code} ${s.name}` })));

  return (
    <div className="ml-auto flex items-center gap-3 text-sm">
      {options.length > 1 ? (
        <select aria-label="Store" disabled={pending} value={ctx.store?.id ?? ""} className="rounded bg-brand-700 px-2 py-1 text-white"
          onChange={(e) => start(async () => { await selectStore(e.target.value); router.refresh(); })}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : ctx.store && <span className="text-brand-100">{ctx.store.code} · {ctx.store.name}</span>}
      {ctx.org && <span className="rounded bg-brand-700 px-2 py-0.5 text-xs">{ROLE_LABEL[ctx.org.role]}</span>}
      <span className="text-brand-100">{ctx.email}</span>
      {ctx.mode === "live" && (
        <button className="rounded px-2 py-1 text-brand-100 hover:bg-brand-700 hover:text-white"
          onClick={async () => { await supabaseBrowser()?.auth.signOut(); await clearOfflineShell(); router.replace("/login"); router.refresh(); }}>Sign out</button>
      )}
    </div>
  );
}
