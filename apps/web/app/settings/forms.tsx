"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase";
import { ROLE_LABEL, type Role } from "@/lib/types";

const input = "mt-1 w-full rounded border border-line px-2 py-1.5";

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try {
      const ok = await fn();
      setMsg({ kind: "ok", text: ok || "Saved" });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const note = msg && <p role="status" className={`col-span-full text-sm ${msg.kind === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</p>;
  return { busy, run, note };
}

function sb() {
  const c = supabaseBrowser();
  if (!c) throw new Error("Demo mode — configure Supabase first");
  return c;
}

export function PharmacistForm({ orgId, disabled }: { orgId: string; disabled?: boolean }) {
  const { busy, run, note } = useSubmit();
  const [f, setF] = useState({ name: "", council: "", regNo: "", validTo: "", pin: "", pin2: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid grid-cols-3 gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); void run(async () => {
      if (!/^[0-9]{4,6}$/.test(f.pin)) throw new Error("PIN must be 4–6 digits");
      if (f.pin !== f.pin2) throw new Error("PINs do not match");
      const { error } = await sb().rpc("add_pharmacist", { p_org: orgId, p_name: f.name, p_council: f.council, p_reg_no: f.regNo, p_reg_valid_to: f.validTo || null, p_pin: f.pin });
      if (error) throw error;
      setF({ name: "", council: "", regNo: "", validTo: "", pin: "", pin2: "" });
      return "Pharmacist registered";
    }); }}>
      <label>Name<input required className={input} value={f.name} onChange={set("name")} /></label>
      <label>State Pharmacy Council<input required className={input} value={f.council} onChange={set("council")} placeholder="Maharashtra State Pharmacy Council" /></label>
      <label>Registration no.<input required className={input} value={f.regNo} onChange={set("regNo")} /></label>
      <label>Registration valid to<input type="date" className={input} value={f.validTo} onChange={set("validTo")} /></label>
      <label>Approval PIN<input required type="password" inputMode="numeric" maxLength={6} className={input} value={f.pin} onChange={set("pin")} /></label>
      <label>Confirm PIN<input required type="password" inputMode="numeric" maxLength={6} className={input} value={f.pin2} onChange={set("pin2")} /></label>
      <button disabled={busy || disabled} className="col-span-full justify-self-start rounded bg-brand-700 px-3 py-1.5 text-white disabled:opacity-50">Add pharmacist</button>
      {note}
    </form>
  );
}

export function LicenceForm({ orgId, stores, disabled }: { orgId: string; stores: Array<{ id: string; label: string }>; disabled?: boolean }) {
  const { busy, run, note } = useSubmit();
  const [f, setF] = useState({ storeId: stores[0]?.id ?? "", kind: "Form 20 (retail, non-Schedule C/C1)", number: "", validFrom: "", validTo: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid grid-cols-5 gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); void run(async () => {
      const { error } = await sb().from("licences").insert({ org_id: orgId, store_id: f.storeId, kind: f.kind, number: f.number.trim(), valid_from: f.validFrom || null, valid_to: f.validTo || null });
      if (error) throw error;
      setF((x) => ({ ...x, number: "", validFrom: "", validTo: "" }));
      return "Licence added";
    }); }}>
      <label>Store<select className={input} value={f.storeId} onChange={set("storeId")}>{stores.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label>Type<select className={input} value={f.kind} onChange={set("kind")}>
        {["Form 20 (retail, non-Schedule C/C1)", "Form 21 (retail, Schedule C/C1)", "Form 20F (Schedule X)", "Form 20B / 21B (wholesale)", "FSSAI", "Shop & Establishment", "Other"].map((k) => <option key={k}>{k}</option>)}
      </select></label>
      <label>Number<input required className={input} value={f.number} onChange={set("number")} /></label>
      <label>Valid from<input type="date" className={input} value={f.validFrom} onChange={set("validFrom")} /></label>
      <label>Valid to<input type="date" required className={input} value={f.validTo} onChange={set("validTo")} /></label>
      <button disabled={busy || disabled} className="col-span-full justify-self-start rounded bg-brand-700 px-3 py-1.5 text-white disabled:opacity-50">Add licence</button>
      {note}
    </form>
  );
}

const INVITABLE: Role[] = ["admin", "pharmacist", "billing", "purchase", "accountant", "rider", "auditor"];

export function InviteForm({ orgId, stores, canInviteOwner, disabled }: { orgId: string; stores: Array<{ id: string; label: string }>; canInviteOwner: boolean; disabled?: boolean }) {
  const { busy, run, note } = useSubmit();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("billing");
  const [storeId, setStoreId] = useState<string>("all");
  const [disc, setDisc] = useState("5");
  const [link, setLink] = useState<string | null>(null);
  return (
    <form className="grid grid-cols-5 gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); void run(async () => {
      const { data, error } = await sb().rpc("invite_member", { p_org: orgId, p_email: email, p_role: role, p_store_ids: storeId === "all" ? null : [storeId], p_max_discount: Number(disc) || 0 });
      if (error) throw error;
      setLink(`${window.location.origin}/invite/${data}`);
      setEmail("");
      return "Invitation created — share the link below";
    }); }}>
      <label className="col-span-2">Email<input type="email" required className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Role<select className={input} value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {(canInviteOwner ? (["owner", ...INVITABLE] as Role[]) : INVITABLE).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select></label>
      <label>Store access<select className={input} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
        <option value="all">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select></label>
      <label>Max discount %<input type="number" min={0} max={100} className={input} value={disc} onChange={(e) => setDisc(e.target.value)} /></label>
      <button disabled={busy || disabled} className="col-span-full justify-self-start rounded bg-brand-700 px-3 py-1.5 text-white disabled:opacity-50">Invite</button>
      {note}
      {link && <p className="col-span-full flex items-center gap-2"><code className="rounded bg-canvas px-2 py-1 text-xs">{link}</code>
        <button type="button" className="text-brand-700 underline" onClick={() => navigator.clipboard.writeText(link)}>Copy</button>
        <span className="text-xs text-muted">Valid 7 days. Email/WhatsApp delivery arrives with the notifications Edge Function.</span></p>}
    </form>
  );
}

export function MemberToggle({ orgId, userId, active }: { orgId: string; userId: string; active: boolean }) {
  const { busy, run } = useSubmit();
  return (
    <button disabled={busy} className="text-xs text-brand-700 underline disabled:opacity-50"
      onClick={() => void run(async () => {
        const { error } = await sb().rpc("set_member_active", { p_org: orgId, p_user: userId, p_active: !active });
        if (error) throw error;
      })}>{active ? "Deactivate" : "Reactivate"}</button>
  );
}
