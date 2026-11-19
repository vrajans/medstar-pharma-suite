import Link from "next/link";
import { redirect } from "next/navigation";
import { daysBetween, formatDateIN, formatINR } from "@medstar/core";
import { DEMO_PRODUCTS } from "@/lib/demo-data";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";

interface Alert { kind: string; name: string; number: string; valid_to: string; days_left: number; store_name: string | null }

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await getAppContext();
  if (ctx.mode === "live" && !ctx.userId) redirect("/login");
  if (ctx.mode === "live" && !ctx.org) redirect("/onboarding");
  const { denied } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  let salesToday = 0, billsToday = 0, alerts: Alert[] = [];
  let expiringCount = 0, blockedCount = 0, stockValue = 0;
  if (ctx.mode === "live" && ctx.store) {
    const sb = await supabaseServer();
    const startIST = new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00+05:30`).toISOString();
    const [bills, al, stock] = await Promise.all([
      sb.from("sales_bills").select("total_paise").eq("store_id", ctx.store.id).eq("status", "posted").gte("billed_at", startIST),
      sb.from("v_licence_alerts").select("kind, name, number, valid_to, days_left, store_name").order("valid_to"),
      sb.from("v_stock_by_batch").select("qty_on_hand, days_to_expiry, status, value_at_cost_paise").eq("store_id", ctx.store.id),
    ]);
    billsToday = bills.data?.length ?? 0;
    salesToday = (bills.data ?? []).reduce((s, b) => s + Number(b.total_paise), 0);
    alerts = (al.data ?? []) as Alert[];
    for (const b of stock.data ?? []) {
      if (b.qty_on_hand <= 0) continue;
      if (b.status !== "active" || b.days_to_expiry < 0) blockedCount++;
      else if (b.days_to_expiry <= 60) expiringCount++;
      if (b.status === "active") stockValue += Number(b.value_at_cost_paise);
    }
  } else {
    const batches = DEMO_PRODUCTS.flatMap((p) => p.batches.map((b) => ({ ...b, product: p })));
    expiringCount = batches.filter((b) => b.status === "active" && b.qtyBase > 0 && b.expiry >= today && daysBetween(today, b.expiry) <= 60).length;
    blockedCount = batches.filter((b) => b.status !== "active" || b.expiry < today).length;
    stockValue = batches.filter((b) => b.status === "active").reduce((s, b) => s + Math.round((b.packMrpPaise * b.qtyBase) / b.product.unitsPerPack), 0);
    alerts = [{ kind: "licence", name: "Form 21", number: "KA-BLR-21-XXXX", valid_to: "2026-12-05", days_left: daysBetween(today, "2026-12-05"), store_name: "MedStar Indiranagar" }];
  }

  const tiles = [
    { label: "Today's sales", value: formatINR(salesToday), hint: `${billsToday} bills · ${ctx.store?.code ?? ""}`, href: "/pos" },
    { label: "Pharmacist on duty", value: ctx.store?.onDuty.length ? ctx.store.onDuty.map((p) => p.name).join(", ") : "None", hint: "Start duty from the POS", href: "/pos" },
    { label: "Batches expiring ≤ 60 days", value: String(expiringCount), hint: "Plan distributor returns", href: "/inventory" },
    { label: "Blocked batches (expired / recalled)", value: String(blockedCount), hint: "Quarantine & return", href: "/inventory" },
    { label: ctx.mode === "live" ? "Stock at cost" : "Stock at MRP (demo)", value: formatINR(stockValue), hint: ctx.store?.name ?? "", href: "/inventory" },
    { label: "Licences & registrations expiring ≤ 30 days", value: String(alerts.length), hint: "Drug licences, pharmacists, distributors", href: "/settings" },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">{ctx.org?.orgName} · dashboard</h1>
      {denied && <p role="alert" className="mb-3 rounded bg-danger/10 p-2 text-sm text-danger">Your role doesn&apos;t have access to {denied}.</p>}
      {alerts.map((a) => (
        <div key={a.kind + a.number} className={`mb-2 rounded-md border p-3 text-sm ${a.days_left < 0 ? "border-danger bg-danger/10 text-danger" : "border-warn bg-warn/10 text-warn"}`} role="alert">
          {a.kind === "licence" ? `Drug licence ${a.name} (${a.number})${a.store_name ? ` for ${a.store_name}` : ""}` :
            a.kind === "pharmacist" ? `Pharmacist registration of ${a.name} (${a.number})` : `Distributor ${a.name}'s drug licence (${a.number})`}
          {a.days_left < 0 ? ` expired on ${formatDateIN(a.valid_to)}.` : ` expires on ${formatDateIN(a.valid_to)} (${a.days_left} days).`}
          {a.kind === "distributor" && " Purchases from them will be blocked after expiry."}
        </div>
      ))}
      <div className="grid grid-cols-3 gap-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-lg border border-line bg-surface p-4 shadow-sm hover:border-brand-600">
            <div className="text-sm text-muted">{t.label}</div>
            <div className="num mt-1 truncate text-2xl font-semibold">{t.value}</div>
            <div className="mt-1 text-xs text-muted">{t.hint}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
