import Link from "next/link";
import { SCHEDULE_INFO } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { PageHeader } from "@/components/ui";

const DEMO_H1 = [
  { date: "17-11-2026", bill: "BLR1/26-27/00002", patient: "Meena, Indiranagar", doctor: "Dr Kumar (KMC-12345)", drug: "Alprax 0.25 Tablet", batch: "AX0912", qty: "10 Tab" },
];

export default async function CompliancePage() {
  const ctx = await requireArea("/compliance");
  const canAudit = ["owner", "admin", "auditor"].includes(ctx.org.role);

  let counts = { h1: 0, x: 0, ndps: 0, rx: 0, recalled: 0 };
  if (ctx.mode === "live") {
    const sb = await supabaseServer();
    const monthStart = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 8) + "01";
    const c = async (sch: string) => (await sb.from("schedule_register").select("id", { count: "exact", head: true }).eq("store_id", ctx.store.id).eq("schedule", sch).gte("entry_date", monthStart)).count ?? 0;
    const [h1, x, ndps, rx, recalled] = await Promise.all([
      c("H1"), c("X"), c("NDPS"),
      sb.from("prescriptions").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.orgId).gte("created_at", monthStart).then((r) => r.count ?? 0),
      sb.from("batches").select("id", { count: "exact", head: true }).eq("store_id", ctx.store.id).in("status", ["recalled", "nsq", "quarantined"]).gt("qty_on_hand", 0).then((r) => r.count ?? 0),
    ]);
    counts = { h1, x, ndps, rx, recalled };
  }

  const cards: Array<{ href: string; title: string; text: string; show?: boolean }> = [
    { href: "/compliance/registers?sch=H1", title: "Schedule H1 register", text: `${counts.h1} entries this month · retained ${SCHEDULE_INFO.H1.retentionYears} years` },
    { href: "/compliance/registers?sch=X", title: "Schedule X register", text: `${counts.x} entries this month · Rx copy retained ${SCHEDULE_INFO.X.retentionYears} years` },
    { href: "/compliance/registers?sch=NDPS", title: "NDPS register", text: `${counts.ndps} entries this month · state format — verify per state` },
    { href: "/compliance/controlled", title: "Controlled-drug stock reconciliation", text: "Opening · received · sold · returned · closing per H1/X/NDPS product" },
    { href: "/compliance/prescriptions", title: "Prescription archive", text: `${counts.rx} prescriptions this month · every image view is logged` },
    { href: "/inventory/recalls", title: "Recalls & NSQ", text: `${counts.recalled} blocked batch(es) in stock` },
    { href: "/settings", title: "Licences & pharmacists", text: "Form 20/21 validity, pharmacist registrations, expiry alerts" },
    { href: "/compliance/audit", title: "Audit log", text: "Cancellations, overrides, PIN failures, Rx views, shift closes", show: canAudit },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader title="Compliance" sub={`${ctx.store.code} · inspection-ready registers and records`} />
      <section className="grid grid-cols-3 gap-4 text-sm">
        {cards.filter((c) => c.show !== false).map((c) => (
          <Link key={c.href} href={c.href} className="rounded-lg border border-line bg-surface p-4 hover:border-brand-600">
            <div className="font-medium">{c.title}</div><div className="text-muted">{c.text}</div>
          </Link>))}
      </section>
      {ctx.mode === "demo" && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-2 font-semibold">Schedule H1 register (demo)</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted"><tr><th>Date</th><th>Bill no.</th><th>Patient & address</th><th>Prescriber & reg. no.</th><th>Drug</th><th>Batch</th><th>Qty</th></tr></thead>
            <tbody>{DEMO_H1.map((r) => (
              <tr key={r.bill} className="border-t border-line"><td className="py-1">{r.date}</td><td>{r.bill}</td><td>{r.patient}</td><td>{r.doctor}</td><td>{r.drug}</td><td>{r.batch}</td><td>{r.qty}</td></tr>))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
