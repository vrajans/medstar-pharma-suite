import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { ButtonLink, LiveOnly, PageHeader, thCls } from "@/components/ui";
import { DoctorForm } from "./DoctorForm";

export const metadata = { title: "Doctors · MedStar" };

export default async function DoctorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireArea("/customers");
  const sp = await searchParams;
  if (ctx.mode === "demo") return <div className="mx-auto max-w-5xl p-6"><PageHeader title="Doctors" /><LiveOnly what="The doctor master" /></div>;
  const sb = await supabaseServer();
  let q = sb.from("doctors").select("id, name, qualification, council, reg_no, address, phone").eq("org_id", ctx.org.orgId).order("name").limit(300);
  if (sp.q) { const s = sp.q.replace(/[%,()]/g, ""); q = q.or(`name.ilike.%${s}%,reg_no.ilike.%${s}%`); }
  const { data } = await q;
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader title="Doctors" sub="Used to fill prescriber details on prescription bills and the H1 / X / NDPS registers"><ButtonLink href="/customers">Customers</ButtonLink></PageHeader>
      <form><input name="q" defaultValue={sp.q} placeholder="Search name or registration no." className="w-72 rounded border border-line bg-surface px-2 py-1.5 text-sm" /></form>
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Doctor</th><th className={thCls}>Registration</th><th className={thCls}>Clinic address</th><th className={thCls}>Phone</th></tr></thead>
          <tbody>{(data ?? []).map((d) => (
            <tr key={d.id} className="border-t border-line">
              <td className="px-3 py-1.5">{d.name}<span className="text-muted">{d.qualification && `, ${d.qualification}`}</span></td>
              <td>{d.reg_no ? <span className="font-mono">{d.reg_no}</span> : <span className="text-warn">missing — needed for H1/X</span>}<div className="text-xs text-muted">{d.council}</div></td>
              <td>{d.address}</td><td>{d.phone}</td>
            </tr>))}
          {!data?.length && <tr><td colSpan={4} className="p-6 text-center text-muted">No doctors yet.</td></tr>}</tbody>
        </table>
      </div>
      <section className="rounded-lg border border-line bg-surface p-4"><h2 className="mb-2 font-semibold">Add doctor</h2><DoctorForm orgId={ctx.org.orgId} /></section>
    </div>
  );
}
