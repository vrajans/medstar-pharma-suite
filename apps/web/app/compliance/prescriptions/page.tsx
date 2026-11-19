import { formatDateIN } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { ViewRx } from "./ViewRx";

export const metadata = { title: "Prescription archive · MedStar" };

export default async function PrescriptionsPage({ searchParams }: { searchParams: Promise<{ q?: string; from?: string; to?: string }> }) {
  const ctx = await requireArea("/compliance");
  const sp = await searchParams;
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Prescription archive" /><LiveOnly what="The prescription archive" /></div>;
  const sb = await supabaseServer();
  let q = sb.from("prescriptions").select("id, rx_date, created_at, patient_name, prescriber_name, prescriber_reg_no, image_path, verification_status, times_used, pharmacists:verified_by(name)")
    .eq("org_id", ctx.org.orgId).order("created_at", { ascending: false }).limit(300);
  if (sp.q) { const s = sp.q.replace(/[%,()]/g, ""); q = q.or(`patient_name.ilike.%${s}%,prescriber_name.ilike.%${s}%,prescriber_reg_no.ilike.%${s}%`); }
  if (sp.from) q = q.gte("created_at", new Date(`${sp.from}T00:00:00+05:30`).toISOString());
  if (sp.to) q = q.lt("created_at", new Date(new Date(`${sp.to}T00:00:00+05:30`).getTime() + 86_400_000).toISOString());
  const { data, error } = await q;
  const canView = ["owner", "admin", "pharmacist", "auditor"].includes(ctx.org.role);
  type Rx = { id: string; rx_date: string | null; created_at: string; patient_name: string | null; prescriber_name: string | null; prescriber_reg_no: string | null; image_path: string | null; verification_status: string; times_used: number; pharmacists: { name: string } | null };

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-6">
      <PageHeader title="Prescription archive" sub="Prescriptions captured at the counter and online. Images open through 5-minute links and every view is written to the audit log." />
      <form className="flex flex-wrap items-center gap-2 text-sm">
        <input name="q" defaultValue={sp.q} placeholder="Patient, doctor or reg. no." className="w-64 rounded border border-line bg-surface px-2 py-1.5" />
        <label>From <input type="date" name="from" defaultValue={sp.from} className="rounded border border-line bg-surface px-2 py-1" /></label>
        <label>To <input type="date" name="to" defaultValue={sp.to} className="rounded border border-line bg-surface px-2 py-1" /></label>
        <button className="rounded border border-line bg-surface px-3 py-1.5">Search</button>
      </form>
      {error && <p className="text-danger">{error.message}</p>}
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Captured</th><th className={thCls}>Rx date</th><th className={thCls}>Patient</th><th className={thCls}>Prescriber</th><th className={thCls}>Verified by</th><th className={thCls}>Used</th><th className={`${thCls} pr-3`}>Image</th></tr></thead>
          <tbody>{((data ?? []) as unknown as Rx[]).map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="px-3 py-1">{formatDateIN(r.created_at)}</td><td>{r.rx_date ? formatDateIN(r.rx_date) : "—"}</td><td>{r.patient_name ?? "—"}</td>
              <td>{r.prescriber_name}{r.prescriber_reg_no && <span className="font-mono text-xs text-muted"> {r.prescriber_reg_no}</span>}</td>
              <td>{r.pharmacists?.name ?? "—"} <span className="text-xs text-muted">{r.verification_status}</span></td><td>{r.times_used}×</td>
              <td className="pr-3">{r.image_path ? (canView ? <ViewRx id={r.id} /> : <span className="text-muted">restricted</span>) : <span className="text-muted">none</span>}</td>
            </tr>))}
          {!data?.length && <tr><td colSpan={7} className="p-6 text-center text-muted">No prescriptions found.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
