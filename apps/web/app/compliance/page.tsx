import { SCHEDULE_INFO } from "@medstar/core";

const H1_ROWS = [
  { date: "17-11-2026", bill: "BLR1/26-27/00002", patient: "Meena, Indiranagar", doctor: "Dr Kumar (KMC-12345)", drug: "Alprax 0.25 Tablet", batch: "AX0912", qty: "10 Tab" },
];

export default function CompliancePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Compliance</h1>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Schedule H1 register</h2>
        <p className="mb-3 text-sm text-muted">Auto-generated from bills; read-only and retained for {SCHEDULE_INFO.H1.retentionYears} years. Export for inspection.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th>Date</th><th>Bill no.</th><th>Patient & address</th><th>Prescriber & reg. no.</th><th>Drug</th><th>Batch</th><th>Qty</th></tr></thead>
          <tbody>{H1_ROWS.map((r) => (
            <tr key={r.bill} className="border-t border-line"><td className="py-1">{r.date}</td><td>{r.bill}</td><td>{r.patient}</td><td>{r.doctor}</td><td>{r.drug}</td><td>{r.batch}</td><td>{r.qty}</td></tr>))}
          </tbody>
        </table>
      </section>

      <section className="grid grid-cols-3 gap-4 text-sm">
        {[
          ["Schedule X register", `Rx copy retained · ${SCHEDULE_INFO.X.retentionYears} yrs`],
          ["NDPS register", "State template — verify per state"],
          ["Prescription archive", "Search by patient / doctor / date"],
          ["Licences", "Form 20 / 21 · expiry alerts 30/15/7 days"],
          ["Pharmacists & shifts", "Registered pharmacist on duty log"],
          ["Recalls & NSQ", "Batches quarantined automatically"],
          ["Audit log", "Price overrides, cancellations, Rx views"],
          ["Habit-forming alerts", "Repeat purchase patterns (R2)"],
          ["Inspection pack", "One-click PDF for a date range (R2)"],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-line bg-surface p-4"><div className="font-medium">{t}</div><div className="text-muted">{d}</div></div>
        ))}
      </section>
    </div>
  );
}
