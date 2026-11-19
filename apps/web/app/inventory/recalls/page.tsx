import { formatDateIN } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader } from "@/components/ui";
import { RecallForm, RecallImpact } from "./forms";

export const metadata = { title: "Recalls · MedStar" };

export default async function RecallsPage() {
  const ctx = await requireArea("/inventory");
  if (ctx.mode === "demo") return <div className="mx-auto max-w-5xl p-6"><PageHeader title="Recalls & NSQ alerts" /><LiveOnly what="Recalls" /></div>;
  const sb = await supabaseServer();
  const { data } = await sb.from("recalls").select("id, product_name, manufacturer, batch_no, reason, source, created_at, org_id").order("created_at", { ascending: false }).limit(50);
  const canAct = ["owner", "admin", "pharmacist"].includes(ctx.org.role);
  const canRelease = ["owner", "admin"].includes(ctx.org.role);
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader title="Recalls & NSQ alerts" sub="Entering a recall quarantines every matching batch immediately (it can no longer be billed) and lists the customers who bought it, so you can call them back." />
      {canAct && <section className="rounded-lg border border-line bg-surface p-4"><RecallForm orgId={ctx.org.orgId} /></section>}
      {(data ?? []).map((r) => (
        <section key={r.id} className="rounded-lg border border-line bg-surface p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <div><span className="font-medium">{r.product_name}</span>{r.manufacturer && <span className="text-muted"> · {r.manufacturer}</span>} · batch <span className="font-mono">{r.batch_no}</span></div>
            <div className="text-muted">{formatDateIN(r.created_at)}{r.source && ` · ${r.source}`}{!r.org_id && " · platform alert"}</div>
          </div>
          <p className="text-danger">{r.reason}</p>
          <RecallImpact recallId={r.id} canRelease={canRelease} />
        </section>
      ))}
      {!data?.length && <p className="text-sm text-muted">No recalls recorded.</p>}
    </div>
  );
}
