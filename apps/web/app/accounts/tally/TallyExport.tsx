"use client";
import { useState } from "react";
import { buildTallyMastersXml, buildTallyVouchersXml, type TallyEntry } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { inputCls } from "@/components/ui";

const download = (name: string, text: string, type: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
};

export function TallyExport({ orgId, storeId, defaultCompany, from: f0, to: t0 }: { orgId: string; storeId: string; defaultCompany: string; from: string; to: string }) {
  const [from, setFrom] = useState(f0);
  const [to, setTo] = useState(t0);
  const [company, setCompany] = useState(defaultCompany);
  const [scope, setScope] = useState<"org" | "store">("org");
  const [state, setState] = useState<{ busy?: boolean; err?: string; done?: string }>({});
  return (
    <form className="space-y-3 text-sm" onSubmit={async (e) => {
      e.preventDefault(); setState({ busy: true });
      const { data, error } = await supabaseBrowser()!.rpc("tally_export", { p_org: orgId, p_from: from, p_to: to, p_store: scope === "store" ? storeId : null });
      if (error) { setState({ err: error.message }); return; }
      const entries = (data ?? []) as TallyEntry[];
      if (!entries.length) { setState({ err: "Nothing posted in this period." }); return; }
      const tag = `${from}_to_${to}`;
      download(`medstar-tally-masters-${tag}.xml`, buildTallyMastersXml(company, entries), "application/xml");
      setTimeout(() => download(`medstar-tally-vouchers-${tag}.xml`, buildTallyVouchersXml(company, entries), "application/xml"), 400);
      setState({ done: `${entries.length} vouchers exported${entries.length === 20000 ? " (limit reached — export a shorter period too)" : ""}` });
    }}>
      <div className="grid grid-cols-4 gap-3">
        <label>From<input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></label>
        <label>To<input type="date" required value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></label>
        <label>Scope<select value={scope} onChange={(e) => setScope(e.target.value as "org" | "store")} className={inputCls}><option value="org">All stores</option><option value="store">This store</option></select></label>
        <label>Company name in Tally<input required value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} /></label>
      </div>
      <button disabled={state.busy} className="rounded-md bg-brand-700 px-4 py-2 text-white disabled:opacity-50">{state.busy ? "Preparing…" : "Download Tally XML (masters + vouchers)"}</button>
      {state.err && <p className="text-danger">{state.err}</p>}
      {state.done && <p className="text-ok">{state.done}</p>}
    </form>
  );
}
