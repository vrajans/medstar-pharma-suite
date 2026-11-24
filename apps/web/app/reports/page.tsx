import Link from "next/link";
import { formatDateIN, formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { RangeForm, readRange } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";
import { RemindButton } from "./RemindButton";

export const metadata = { title: "Reports · MedStar" };

const TABS = [
  ["sales", "Sales summary"], ["products", "Item-wise sales"], ["doctors", "Doctor-wise"], ["purchases", "Purchase register"],
  ["outstanding", "Customer udhaar"], ["suppliers", "Supplier dues"], ["valuation", "Stock valuation"], ["nonmoving", "Non-moving stock"],
] as const;
type Tab = (typeof TABS)[number][0];

type Rows = Array<Record<string, string | number | null>>;
const R = (p: number | string | null | undefined) => Number(p ?? 0) / 100;

function Table({ head, rows, right = [] }: { head: string[]; rows: React.ReactNode[][]; right?: number[] }) {
  return (
    <div className="overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-canvas"><tr>{head.map((h, i) => <th key={h} className={`${thCls} ${i === 0 ? "px-3" : ""} ${right.includes(i) ? "pr-3 text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className={`py-1 ${j === 0 ? "px-3" : ""} ${right.includes(j) ? "num pr-3 text-right" : ""}`}>{c}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={head.length} className="p-6 text-center text-muted">Nothing for this period.</td></tr>}</tbody>
      </table>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; days?: string }> }) {
  const ctx = await requireArea("/reports");
  const sp = await searchParams;
  const tab = (TABS.some(([k]) => k === sp.tab) ? sp.tab : "sales") as Tab;
  const { from, to } = readRange(sp);
  const days = Math.max(30, Math.min(365, Number(sp.days) || 90));
  const nav = (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2 text-sm">
      {TABS.map(([k, l]) => <Link key={k} href={`/reports?tab=${k}&from=${from}&to=${to}`} className={`rounded px-2 py-1 ${tab === k ? "bg-brand-700 text-white" : "text-muted hover:bg-canvas"}`}>{l}</Link>)}
    </nav>);
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Reports" />{nav}<LiveOnly what="Reports" /></div>;
  const sb = await supabaseServer();
  const period = `${formatDateIN(from)} to ${formatDateIN(to)}`;
  let body: React.ReactNode = null, exportRows: Rows = [], title = "";
  let needsRange = true;

  if (tab === "sales") {
    const { data, error } = await sb.rpc("sales_report", { p_store: ctx.store.id, p_from: from, p_to: to });
    if (error) body = <p className="text-danger">{error.message}</p>;
    else {
      const s = data as { days: Array<{ date: string; bills: number; cancelled: number; sales: number; discount: number; returns: number }>; modes: Array<{ mode: string; amount: number }>;
        refunds: Array<{ mode: string; amount: number }>; staff: Array<{ label: string; bills: number; sales: number }>; hours: Array<{ hour: number; bills: number; sales: number }>;
        totals: { bills: number; sales: number; returns: number; cancelled: number; avgBill: number } };
      title = `Sales summary ${ctx.store.code} ${period}`;
      exportRows = s.days.map((d) => ({ date: formatDateIN(d.date), bills: d.bills, cancelled: d.cancelled, sales: R(d.sales), discount: R(d.discount), returns: R(d.returns), net: R(d.sales - d.returns) }));
      const modes = new Map<string, number>();
      for (const m of s.modes) modes.set(m.mode, (modes.get(m.mode) ?? 0) + Number(m.amount));
      const peak = [...s.hours].sort((a, b) => b.bills - a.bills)[0];
      body = (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-3 text-sm">
            {[["Bills", String(s.totals.bills)], ["Sales", formatINR(s.totals.sales)], ["Returns", formatINR(s.totals.returns)], ["Net sales", formatINR(s.totals.sales - s.totals.returns)], ["Average bill", formatINR(s.totals.avgBill)]].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-line bg-surface p-3"><div className="text-muted">{l}</div><div className="num text-lg font-semibold">{v}</div></div>))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><h3 className="mb-1 font-semibold">By payment mode</h3>
              <Table head={["Mode", "Collected"]} right={[1]} rows={[...modes].sort((a, b) => b[1] - a[1]).map(([m, a]) => [m === "credit" ? "Credit (udhaar)" : m.toUpperCase(), formatINR(a)])} />
              {s.refunds.length > 0 && <p className="mt-1 text-xs text-muted">Refunds: {s.refunds.map((r) => `${r.mode} ${formatINR(Number(r.amount))}`).join(" · ")}</p>}</div>
            <div><h3 className="mb-1 font-semibold">By staff</h3><Table head={["Staff", "Bills", "Sales"]} right={[1, 2]} rows={s.staff.map((x) => [x.label, x.bills, formatINR(Number(x.sales))])} /></div>
            <div><h3 className="mb-1 font-semibold">By hour {peak && <span className="text-xs font-normal text-muted">· busiest {peak.hour}:00–{peak.hour + 1}:00</span>}</h3>
              <Table head={["Hour", "Bills", "Sales"]} right={[1, 2]} rows={s.hours.map((h) => [`${String(h.hour).padStart(2, "0")}:00`, h.bills, formatINR(Number(h.sales))])} /></div>
          </div>
          <div><h3 className="mb-1 font-semibold">By day</h3>
            <Table head={["Date", "Bills", "Cancelled", "Sales", "Discount", "Returns", "Net"]} right={[1, 2, 3, 4, 5, 6]}
              rows={s.days.map((d) => [formatDateIN(d.date), d.bills, d.cancelled, formatINR(Number(d.sales)), formatINR(Number(d.discount)), formatINR(Number(d.returns)), formatINR(Number(d.sales) - Number(d.returns))])} /></div>
        </div>);
    }
  } else if (tab === "products") {
    const { data, error } = await sb.rpc("margin_report", { p_store: ctx.store.id, p_from: from, p_to: to, p_by: "product" });
    const m = data as { rows: Array<{ label: string; qty: number; sales: number; cost: number; margin: number; marginPct: number | null }> } | null;
    title = `Item-wise sales ${ctx.store.code} ${period}`;
    exportRows = (m?.rows ?? []).map((r) => ({ item: r.label, qty_base_units: r.qty, sales_ex_gst: R(r.sales), cost: R(r.cost), margin: R(r.margin), margin_pct: r.marginPct }));
    body = error ? <p className="text-danger">{error.message}</p> : <Table head={["Item", "Qty (units)", "Sales before GST", "Cost", "Margin", "%"]} right={[1, 2, 3, 4, 5]}
      rows={(m?.rows ?? []).map((r) => [r.label, r.qty, formatINR(r.sales), formatINR(r.cost), formatINR(r.margin), r.marginPct ?? "—"])} />;
  } else if (tab === "doctors") {
    const { data, error } = await sb.rpc("doctor_sales_report", { p_store: ctx.store.id, p_from: from, p_to: to });
    const rows = (data ?? []) as Array<{ doctor: string; regNo: string | null; bills: number; sales: number; controlledBills: number }>;
    title = `Doctor-wise prescription sales ${ctx.store.code} ${period}`;
    exportRows = rows.map((r) => ({ doctor: r.doctor, reg_no: r.regNo, bills: r.bills, sales: R(r.sales), controlled_bills: r.controlledBills }));
    body = error ? <p className="text-danger">{error.message}</p> : <Table head={["Doctor", "Reg. no.", "Rx bills", "Sales", "H1 / X / NDPS bills"]} right={[2, 3, 4]}
      rows={rows.map((r) => [r.doctor, r.regNo ?? "", r.bills, formatINR(r.sales), r.controlledBills])} />;
  } else if (tab === "purchases") {
    const { data, error } = await sb.from("purchase_invoices").select("supplier_invoice_no, supplier_invoice_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, due_date, distributors(name, gstin)")
      .eq("store_id", ctx.store.id).gte("supplier_invoice_date", from).lte("supplier_invoice_date", to).order("supplier_invoice_date").limit(3000);
    const rows = (data ?? []) as unknown as Array<{ supplier_invoice_no: string; supplier_invoice_date: string; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number; due_date: string | null; distributors: { name: string; gstin: string | null } | null }>;
    title = `Purchase register ${ctx.store.code} ${period}`;
    exportRows = rows.map((r) => ({ date: formatDateIN(r.supplier_invoice_date), supplier: r.distributors?.name ?? "", gstin: r.distributors?.gstin ?? "", invoice: r.supplier_invoice_no,
      taxable: R(r.taxable_paise), cgst: R(r.cgst_paise), sgst: R(r.sgst_paise), igst: R(r.igst_paise), total: R(r.total_paise), due: r.due_date ? formatDateIN(r.due_date) : "" }));
    const tot = rows.reduce((s, r) => s + Number(r.total_paise), 0);
    body = error ? <p className="text-danger">{error.message}</p> : (<>
      <p className="mb-2 text-sm text-muted">{rows.length} invoice(s) · total {formatINR(tot)}</p>
      <Table head={["Date", "Supplier", "Invoice", "Taxable", "GST", "Total", "Due"]} right={[3, 4, 5]}
        rows={rows.map((r) => [formatDateIN(r.supplier_invoice_date), r.distributors?.name ?? "", r.supplier_invoice_no, formatINR(Number(r.taxable_paise)),
          formatINR(Number(r.cgst_paise) + Number(r.sgst_paise) + Number(r.igst_paise)), formatINR(Number(r.total_paise)), r.due_date ? formatDateIN(r.due_date) : ""])} /></>);
  } else if (tab === "outstanding") {
    needsRange = false;
    const { data, error } = await sb.from("v_customer_balances").select("customer_id, name, phone, credit_limit_paise, outstanding_paise, last_entry").eq("org_id", ctx.org.orgId).gt("outstanding_paise", 0).order("outstanding_paise", { ascending: false }).limit(2000);
    const rows = data ?? [];
    title = `Customer udhaar as on ${formatDateIN(to)}`;
    exportRows = rows.map((r) => ({ customer: r.name, mobile: r.phone, outstanding: R(r.outstanding_paise), credit_limit: R(r.credit_limit_paise), last_entry: r.last_entry ? formatDateIN(r.last_entry) : "" }));
    const total = rows.reduce((s, r) => s + Number(r.outstanding_paise), 0);
    body = error ? <p className="text-danger">{error.message}</p> : (<>
      <p className="mb-2 text-sm text-muted">{rows.length} customer(s) owe {formatINR(total)}. Reminders open WhatsApp with a polite message — nothing is sent automatically.</p>
      <Table head={["Customer", "Mobile", "Outstanding", "Limit", "Last entry", ""]} right={[2, 3]}
        rows={rows.map((r) => [r.name ?? "—", r.phone, formatINR(Number(r.outstanding_paise)), Number(r.credit_limit_paise) ? formatINR(Number(r.credit_limit_paise)) : "—",
          r.last_entry ? formatDateIN(r.last_entry) : "", <RemindButton key={r.customer_id} phone={r.phone} name={r.name} amountPaise={Number(r.outstanding_paise)} shop={`${ctx.org.orgName}, ${ctx.store.name}`} />])} /></>);
  } else if (tab === "suppliers") {
    needsRange = false;
    const { data, error } = await sb.from("v_supplier_balances").select("name, gstin, due_paise, oldest_due_date, last_purchase, credit_days").eq("org_id", ctx.org.orgId).neq("due_paise", 0).order("oldest_due_date");
    const rows = data ?? [];
    title = `Supplier dues as on ${formatDateIN(to)}`;
    exportRows = rows.map((r) => ({ supplier: r.name, gstin: r.gstin, due: R(r.due_paise), oldest_due: r.oldest_due_date ? formatDateIN(r.oldest_due_date) : "", last_purchase: r.last_purchase ? formatDateIN(r.last_purchase) : "" }));
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    body = error ? <p className="text-danger">{error.message}</p> : <Table head={["Supplier", "GSTIN", "Due", "Oldest due date", "Last purchase"]} right={[2]}
      rows={rows.map((r) => [r.name, r.gstin ?? "", formatINR(Number(r.due_paise)),
        r.oldest_due_date ? <span className={r.oldest_due_date < today ? "text-danger" : ""}>{formatDateIN(r.oldest_due_date)}{r.oldest_due_date < today && " (overdue)"}</span> : "", r.last_purchase ? formatDateIN(r.last_purchase) : ""])} />;
  } else if (tab === "valuation") {
    needsRange = false;
    const { data, error } = await sb.rpc("stock_valuation", { p_store: ctx.store.id });
    const v = data as { rows: Array<{ category: string; products: number; qtyBase: number; costPaise: number; mrpPaise: number }>; costPaise: number; mrpPaise: number } | null;
    title = `Stock valuation ${ctx.store.code} as on ${formatDateIN(to)}`;
    exportRows = (v?.rows ?? []).map((r) => ({ category: r.category, products: r.products, units: r.qtyBase, at_cost: R(r.costPaise), at_mrp: R(r.mrpPaise) }));
    body = error ? <p className="text-danger">{error.message}</p> : (<>
      <p className="mb-2 text-sm text-muted">Saleable stock (active, not expired): {formatINR(v?.costPaise ?? 0)} at cost · {formatINR(v?.mrpPaise ?? 0)} at MRP</p>
      <Table head={["Category", "Products", "Units", "At cost", "At MRP"]} right={[1, 2, 3, 4]}
        rows={(v?.rows ?? []).map((r) => [r.category, r.products, r.qtyBase, formatINR(r.costPaise), formatINR(r.mrpPaise)])} /></>);
  } else if (tab === "nonmoving") {
    needsRange = false;
    const { data, error } = await sb.rpc("non_moving_stock", { p_store: ctx.store.id, p_days: days });
    const rows = (data ?? []) as Array<{ name: string; manufacturer: string | null; packLabel: string; unitsPerPack: number; qtyBase: number; valuePaise: number; lastSold: string | null; nearestExpiry: string }>;
    title = `Non-moving stock ${ctx.store.code} (no sale in ${days} days)`;
    exportRows = rows.map((r) => ({ item: r.name, company: r.manufacturer, units: r.qtyBase, value_at_cost: R(r.valuePaise), last_sold: r.lastSold ? formatDateIN(r.lastSold) : "never", nearest_expiry: formatDateIN(r.nearestExpiry) }));
    body = error ? <p className="text-danger">{error.message}</p> : (<>
      <form className="mb-2 flex items-end gap-2 text-sm"><input type="hidden" name="tab" value="nonmoving" />
        <label className="flex flex-col">No sale for<select name="days" defaultValue={String(days)} className="rounded border border-line bg-surface px-2 py-1.5">
          {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label><button className="rounded border border-line bg-surface px-3 py-1.5">Show</button>
        <span className="text-muted">{rows.length} item(s) · {formatINR(rows.reduce((s, r) => s + r.valuePaise, 0))} at cost — return to the supplier before expiry or move to the other branch</span></form>
      <Table head={["Item", "Company", "Stock", "Value at cost", "Last sold", "Nearest expiry"]} right={[2, 3]}
        rows={rows.map((r) => [r.name, r.manufacturer ?? "", `${Math.floor(r.qtyBase / r.unitsPerPack)} ${r.packLabel}`, formatINR(r.valuePaise), r.lastSold ? formatDateIN(r.lastSold) : "never", formatDateIN(r.nearestExpiry)])} /></>);
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Reports" sub={`${ctx.store.code} · ${ctx.store.name}`}>
        <ExportButtons title={title} rows={exportRows} footer="" />
      </PageHeader>
      {nav}
      {needsRange && <RangeForm from={from} to={to} extra={{ tab }} />}
      {body}
    </div>
  );
}
