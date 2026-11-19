import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { formatBillTime } from "@/components/pos/Receipt";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { ExportButtons } from "../registers/ExportButtons";

export const metadata = { title: "Audit log · MedStar" };

const ACTIONS = ["cancel_sale", "sales_return", "purchase_return", "stock_adjustment_request", "stock_adjustment_approve", "stock_adjustment_reject", "pin_failed",
  "rx_view", "rx_approve", "rx_reject", "shift_open", "shift_close", "set_batch_status", "create_recall", "import_products", "invite_member", "set_member_active", "post_sale"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; from?: string; to?: string }> }) {
  const ctx = await requireArea("/compliance");
  const sp = await searchParams;
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Audit log" /><LiveOnly what="The audit log" /></div>;
  if (!["owner", "admin", "auditor"].includes(ctx.org.role)) return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Audit log" /><p className="text-sm text-danger">Only owners, admins and auditors can see the audit log.</p></div>;
  const sb = await supabaseServer();
  let q = sb.from("audit_log").select("id, created_at, user_id, action, entity, entity_id, details").eq("org_id", ctx.org.orgId).order("id", { ascending: false }).limit(500);
  if (sp.action) q = q.eq("action", sp.action);
  if (sp.from) q = q.gte("created_at", new Date(`${sp.from}T00:00:00+05:30`).toISOString());
  if (sp.to) q = q.lt("created_at", new Date(new Date(`${sp.to}T00:00:00+05:30`).getTime() + 86_400_000).toISOString());
  const [{ data }, { data: invites }] = await Promise.all([q, sb.from("invitations").select("accepted_by, email").eq("org_id", ctx.org.orgId).not("accepted_by", "is", null)]);
  const who = (uid: string | null) => !uid ? "system" : uid === ctx.userId ? (ctx.email ?? "you") : invites?.find((i) => i.accepted_by === uid)?.email ?? uid.slice(0, 8) + "…";
  const rows = (data ?? []).map((r) => ({ when: formatBillTime(new Date(r.created_at)), user: who(r.user_id), action: r.action, entity: `${r.entity}${r.entity_id ? ` · ${r.entity_id.slice(0, 18)}` : ""}`, details: r.details ? JSON.stringify(r.details) : "" }));

  return (
    <div className="mx-auto max-w-7xl space-y-3 p-6">
      <PageHeader title="Audit log" sub="Append-only record of sensitive actions. Nobody — including owners — can edit or delete entries.">
        <ExportButtons title={`Audit log · ${ctx.org.orgName}`} rows={rows} />
      </PageHeader>
      <form className="flex flex-wrap items-center gap-2 text-sm">
        <select name="action" defaultValue={sp.action ?? ""} className="rounded border border-line bg-surface px-2 py-1.5"><option value="">All actions</option>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
        <label>From <input type="date" name="from" defaultValue={sp.from} className="rounded border border-line bg-surface px-2 py-1" /></label>
        <label>To <input type="date" name="to" defaultValue={sp.to} className="rounded border border-line bg-surface px-2 py-1" /></label>
        <button className="rounded border border-line bg-surface px-3 py-1.5">Filter</button>
      </form>
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>When</th><th className={thCls}>User</th><th className={thCls}>Action</th><th className={thCls}>Record</th><th className={`${thCls} pr-3`}>Details</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className={`border-t border-line align-top ${["pin_failed", "cancel_sale"].includes(r.action) ? "text-warn" : ""}`}>
              <td className="whitespace-nowrap px-3 py-1">{r.when}</td><td>{r.user}</td><td className="font-mono text-xs">{r.action}</td><td className="text-xs">{r.entity}</td>
              <td className="max-w-md truncate pr-3 font-mono text-xs" title={r.details}>{r.details}</td>
            </tr>))}
          {!rows.length && <tr><td colSpan={5} className="p-6 text-center text-muted">No entries.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
