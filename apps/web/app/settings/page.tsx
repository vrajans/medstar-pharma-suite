import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { formatDateIN } from "@medstar/core";
import { InviteForm, LicenceForm, MemberToggle, PharmacistForm } from "./forms";

export const metadata = { title: "Settings · MedStar" };

interface Member { user_id: string; role: Role; active: boolean; store_ids: string[] | null; max_discount_pct: number }
interface Invite { id: string; email: string; role: Role; accepted_by: string | null; accepted_at: string | null; revoked: boolean; expires_at: string; token: string }

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const ctx = await requireArea("/settings");
  const { welcome } = await searchParams;
  const org = ctx.org;

  let members: Member[] = [], invites: Invite[] = [];
  let pharmacists: Array<{ id: string; name: string; council: string; reg_no: string; reg_valid_to: string | null }> = [];
  let licences: Array<{ id: string; store_id: string; kind: string; number: string; valid_to: string | null }> = [];
  if (ctx.mode === "live") {
    const sb = await supabaseServer();
    const [m, i, p, l] = await Promise.all([
      sb.from("memberships").select("user_id, role, active, store_ids, max_discount_pct").eq("org_id", org.orgId),
      sb.from("invitations").select("id, email, role, accepted_by, accepted_at, revoked, expires_at, token").eq("org_id", org.orgId).order("created_at", { ascending: false }),
      sb.from("pharmacists").select("id, name, council, reg_no, reg_valid_to").eq("org_id", org.orgId).order("name"),
      sb.from("licences").select("id, store_id, kind, number, valid_to").eq("org_id", org.orgId).order("valid_to"),
    ]);
    members = (m.data ?? []) as Member[]; invites = (i.data ?? []) as Invite[];
    pharmacists = p.data ?? []; licences = l.data ?? [];
  }
  const emailOf = (uid: string) => invites.find((x) => x.accepted_by === uid)?.email ?? (uid === ctx.userId ? ctx.email : uid.slice(0, 8) + "…");
  const storeName = (id: string) => org.stores.find((s) => s.id === id)?.code ?? "—";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Settings · {org.orgName}</h1>
      {welcome && (
        <div className="rounded-md border border-ok bg-ok/5 p-3 text-sm">
          Your pharmacy is set up. Before billing prescription medicines: add your drug licences, register at least one pharmacist (with a PIN), then invite your staff.
        </div>
      )}
      {ctx.mode === "demo" && <p className="text-sm text-muted">Demo mode — forms are disabled until Supabase is configured.</p>}

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Stores</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th>Code</th><th>Name</th><th>GSTIN</th><th>Scheme</th><th>Pharmacist rule</th></tr></thead>
          <tbody>{org.stores.map((s) => (
            <tr key={s.id} className="border-t border-line"><td className="py-1 font-mono">{s.code}</td><td>{s.name}</td><td className="font-mono">{s.gstin ?? "—"}</td>
              <td>{s.gstScheme}</td><td>{s.pharmacistPresence === "hard" ? "Block Rx sale if none on duty" : "Warn only"}</td></tr>))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Drug licences & registrations</h2>
        <table className="mb-3 w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th>Store</th><th>Type</th><th>Number</th><th>Valid to</th></tr></thead>
          <tbody>{licences.map((l) => {
            const days = l.valid_to ? Math.round((Date.parse(l.valid_to) - Date.parse(today)) / 86_400_000) : null;
            return (
              <tr key={l.id} className="border-t border-line"><td className="py-1">{storeName(l.store_id)}</td><td>{l.kind}</td><td className="font-mono">{l.number}</td>
                <td className={days !== null && days <= 30 ? "text-danger" : ""}>{l.valid_to ? formatDateIN(l.valid_to) : "—"}{days !== null && days <= 30 && ` (${days} days)`}</td></tr>);
          })}
          {!licences.length && <tr><td colSpan={4} className="py-2 text-muted">No licences recorded yet.</td></tr>}</tbody>
        </table>
        <LicenceForm orgId={org.orgId} stores={org.stores.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }))} disabled={ctx.mode === "demo"} />
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Registered pharmacists</h2>
        <table className="mb-3 w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th>Name</th><th>Council</th><th>Reg. no.</th><th>Valid to</th></tr></thead>
          <tbody>{pharmacists.map((p) => (
            <tr key={p.id} className="border-t border-line"><td className="py-1">{p.name}</td><td>{p.council}</td><td className="font-mono">{p.reg_no}</td><td>{p.reg_valid_to ? formatDateIN(p.reg_valid_to) : "—"}</td></tr>))}
          {!pharmacists.length && <tr><td colSpan={4} className="py-2 text-muted">No pharmacists yet — prescription medicines can't be billed until one is added.</td></tr>}</tbody>
        </table>
        <PharmacistForm orgId={org.orgId} disabled={ctx.mode === "demo"} />
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Team</h2>
        <table className="mb-3 w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th>User</th><th>Role</th><th>Stores</th><th>Max discount</th><th>Status</th><th /></tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.user_id} className="border-t border-line">
              <td className="py-1">{emailOf(m.user_id)}</td><td>{ROLE_LABEL[m.role]}</td>
              <td>{m.store_ids ? m.store_ids.map(storeName).join(", ") : "All"}</td><td>{Number(m.max_discount_pct)}%</td>
              <td>{m.active ? "Active" : "Deactivated"}</td>
              <td>{m.user_id !== ctx.userId && <MemberToggle orgId={org.orgId} userId={m.user_id} active={m.active} />}</td>
            </tr>))}</tbody>
        </table>
        <h3 className="mb-1 text-sm font-semibold">Pending invitations</h3>
        <ul className="mb-3 space-y-1 text-sm">
          {invites.filter((i) => !i.accepted_at && !i.revoked && i.expires_at > new Date().toISOString()).map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 rounded bg-canvas px-2 py-1">
              <span>{i.email} · {ROLE_LABEL[i.role]}</span>
              <code className="truncate text-xs text-muted">/invite/{i.token}</code>
            </li>))}
        </ul>
        <InviteForm orgId={org.orgId} stores={org.stores.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }))} canInviteOwner={org.role === "owner"} disabled={ctx.mode === "demo"} />
      </section>
    </div>
  );
}
