import { formatDateIN } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { AccountsNav } from "@/components/books";
import { LockForm } from "./LockForm";

export const metadata = { title: "Period lock · MedStar" };

export default async function PeriodLockPage() {
  const ctx = await requireArea("/accounts");
  const canLock = ["owner", "admin"].includes(ctx.org.role);
  if (ctx.mode === "demo") return <div className="mx-auto max-w-4xl p-6"><PageHeader title="Period lock" /><AccountsNav active="/accounts/period-lock" /><LiveOnly what="Period lock" /></div>;
  const sb = await supabaseServer();
  const [lock, hist] = await Promise.all([
    sb.from("period_locks").select("locked_until").eq("org_id", ctx.org.orgId).maybeSingle(),
    sb.from("period_lock_history").select("id, locked_until, previous, reason, changed_at").eq("org_id", ctx.org.orgId).order("changed_at", { ascending: false }).limit(50),
  ]);
  const current = lock.data?.locked_until ?? null;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Period lock" sub="After you file GST or close a month, lock it so nothing can be posted or back-dated into it" />
      <AccountsNav active="/accounts/period-lock" />
      <div className="mb-4 rounded-lg border border-line bg-surface p-4">
        <p className="mb-3 text-base">{current ? <>Books are locked up to <b>{formatDateIN(current)}</b>.</> : "Books are not locked."}</p>
        <p className="mb-3 text-sm text-muted">While locked, no bill, return, purchase, payment, voucher or shift close can be dated on or before that day — including offline bills that sync late
          (they stay in the POS sync queue with an error until the owner unlocks the period). Mistakes in a locked month are corrected by a reversal in the current month.</p>
        {canLock ? <LockForm orgId={ctx.org.orgId} current={current} isOwner={ctx.org.role === "owner"} /> : <p className="text-sm text-muted">Only the owner or admin can change the lock.</p>}
      </div>
      <h2 className="mb-2 font-semibold">History</h2>
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Changed</th><th className={thCls}>Locked up to</th><th className={thCls}>Previously</th><th className={`${thCls} px-3`}>Reason</th></tr></thead>
          <tbody>{(hist.data ?? []).map((h) => (
            <tr key={h.id} className="border-t border-line"><td className="px-3 py-1">{new Date(h.changed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
              <td>{h.locked_until ? formatDateIN(h.locked_until) : "— (unlocked)"}</td><td>{h.previous ? formatDateIN(h.previous) : "—"}</td><td className="px-3">{h.reason}</td></tr>))}
          {!hist.data?.length && <tr><td colSpan={4} className="p-4 text-center text-muted">No changes yet.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
