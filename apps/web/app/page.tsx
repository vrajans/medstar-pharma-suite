import Link from "next/link";
import { daysBetween, formatINR } from "@medstar/core";
import { DEMO_PRODUCTS } from "@/lib/demo-data";

export default function Dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const batches = DEMO_PRODUCTS.flatMap((p) => p.batches.map((b) => ({ ...b, product: p })));
  const expiring = batches.filter((b) => b.status === "active" && b.qtyBase > 0 && daysBetween(today, b.expiry) <= 60);
  const blocked = batches.filter((b) => b.status !== "active" || b.expiry < today);
  const stockValue = batches.filter((b) => b.status === "active").reduce((s, b) => s + Math.round((b.packMrpPaise * b.qtyBase) / b.product.unitsPerPack), 0);

  const tiles = [
    { label: "Today's sales", value: formatINR(0), hint: "Connect Supabase to see live figures", href: "/pos" },
    { label: "Online orders awaiting Rx check", value: "2", hint: "SLA 15 min", href: "/rx-verify" },
    { label: "Batches expiring ≤ 60 days", value: String(expiring.length), hint: "Plan distributor returns", href: "/inventory" },
    { label: "Blocked batches (expired / recalled)", value: String(blocked.length), hint: "Quarantine & return", href: "/inventory" },
    { label: "Stock at MRP", value: formatINR(stockValue), hint: "Demo catalogue", href: "/inventory" },
    { label: "Licences expiring ≤ 30 days", value: "1", hint: "Form 21 — BLR1", href: "/compliance" },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Owner dashboard</h1>
      <div className="mb-4 rounded-md border border-warn bg-warn/10 p-3 text-sm text-warn" role="alert">
        Drug licence Form 21 for MedStar Indiranagar expires on 05-12-2026. Start renewal with the State Drugs Control Department.
      </div>
      <div className="grid grid-cols-3 gap-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-lg border border-line bg-surface p-4 shadow-sm hover:border-brand-600">
            <div className="text-sm text-muted">{t.label}</div>
            <div className="num mt-1 text-2xl font-semibold">{t.value}</div>
            <div className="mt-1 text-xs text-muted">{t.hint}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
