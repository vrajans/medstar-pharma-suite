"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CREATABLE_GROUPS, GROUP_LABEL } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { inputCls } from "@/components/ui";

export function AddLedger({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [grp, setGrp] = useState("indirect_exp");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      const { error } = await supabaseBrowser()!.rpc("create_account", { p_org: orgId, p_name: name, p_grp: grp });
      if (error) { setMsg({ ok: false, text: error.message }); return; }
      setMsg({ ok: true, text: `Added “${name.trim()}”` }); setName(""); router.refresh();
    }}>
      <label className="w-64">New ledger name<input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HDFC current account, Staff welfare" className={inputCls} /></label>
      <label>Group<select value={grp} onChange={(e) => setGrp(e.target.value)} className={inputCls}>
        {CREATABLE_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></label>
      <button className="rounded bg-brand-700 px-3 py-1.5 text-white">Add ledger</button>
      {msg && <span className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</span>}
    </form>
  );
}

export function EditLedger({ id, name, active }: { id: string; name: string; active: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(name);
  const [err, setErr] = useState<string | null>(null);
  const save = async (nextActive: boolean) => {
    setErr(null);
    const { error } = await supabaseBrowser()!.rpc("update_account", { p_account: id, p_name: v, p_active: nextActive });
    if (error) setErr(error.message); else router.refresh();
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input aria-label="Ledger name" value={v} onChange={(e) => setV(e.target.value)} className="w-56 rounded border border-line px-1" />
      {v !== name && <button className="text-xs text-brand-700 underline" onClick={() => save(active)}>Save</button>}
      <button className="text-xs text-muted underline" onClick={() => save(!active)}>{active ? "Deactivate" : "Activate"}</button>
      {err && <span className="w-full text-xs text-danger">{err}</span>}
    </span>
  );
}
