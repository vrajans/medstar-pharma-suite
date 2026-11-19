import Link from "next/link";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { ScheduleBadge } from "@/components/ScheduleBadge";
import { ButtonLink, LiveOnly, PageHeader, thCls } from "@/components/ui";
import type { DrugSchedule } from "@medstar/core";

export const metadata = { title: "Products · MedStar" };

interface Row {
  id: string; name: string; manufacturer: string | null; composition: string | null; schedule: DrugSchedule; hsn: string;
  units_per_pack: number; pack_label: string; base_unit_label: string; reorder_level: number; rack: string | null; is_active: boolean;
  cold_chain: boolean; gst_rate_override: number | null; blocked_reason: string | null;
  batches: Array<{ store_id: string; qty_on_hand: number; status: string; expiry: string }>;
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; sch?: string; low?: string; inactive?: string }> }) {
  const ctx = await requireArea("/products");
  const sp = await searchParams;
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Products" /><LiveOnly what="The product master" /></div>;

  const sb = await supabaseServer();
  let q = sb.from("products")
    .select("id, name, manufacturer, composition, schedule, hsn, units_per_pack, pack_label, base_unit_label, reorder_level, rack, is_active, cold_chain, gst_rate_override, blocked_reason, batches(store_id, qty_on_hand, status, expiry)")
    .eq("org_id", ctx.org.orgId).order("name").limit(300);
  if (sp.q) q = q.or(`name.ilike.%${sp.q.replace(/[%,()]/g, "")}%,composition.ilike.%${sp.q.replace(/[%,()]/g, "")}%`);
  if (sp.sch) q = q.eq("schedule", sp.sch);
  if (!sp.inactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  const today = new Date().toISOString().slice(0, 10);
  let rows = ((data ?? []) as Row[]).map((p) => {
    const sellable = p.batches.filter((b) => b.store_id === ctx.store.id && b.status === "active" && b.expiry >= today).reduce((s, b) => s + b.qty_on_hand, 0);
    return { ...p, sellable };
  });
  if (sp.low) rows = rows.filter((r) => r.sellable / r.units_per_pack <= r.reorder_level);
  const canEdit = ["owner", "admin", "purchase", "pharmacist"].includes(ctx.org.role);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Products" sub={`${rows.length} shown · stock for ${ctx.store.code}`}>
        {canEdit && <ButtonLink href="/products/import">Import CSV</ButtonLink>}
        {canEdit && <ButtonLink href="/products/new" primary>Add product</ButtonLink>}
      </PageHeader>
      <form className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input name="q" defaultValue={sp.q} placeholder="Search name or salt" className="w-64 rounded border border-line bg-surface px-2 py-1.5" />
        <select name="sch" defaultValue={sp.sch ?? ""} className="rounded border border-line bg-surface px-2 py-1.5">
          <option value="">All schedules</option>{["OTC", "G", "H", "H1", "X", "C", "C1", "NDPS"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" name="low" value="1" defaultChecked={!!sp.low} /> At or below reorder level</label>
        <label className="flex items-center gap-1"><input type="checkbox" name="inactive" value="1" defaultChecked={!!sp.inactive} /> Include inactive</label>
        <button className="rounded border border-line bg-surface px-3 py-1.5">Filter</button>
      </form>
      {error && <p className="text-danger">{error.message}</p>}
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Product</th><th className={thCls}>Salt</th><th className={thCls}>HSN · GST</th><th className={thCls}>Pack</th><th className={thCls}>Rack</th><th className={`${thCls} text-right`}>Stock</th><th className={`${thCls} pr-3 text-right`}>Reorder at</th></tr></thead>
          <tbody>{rows.map((p) => {
            const packs = Math.floor(p.sellable / p.units_per_pack), loose = p.sellable % p.units_per_pack;
            return (
              <tr key={p.id} className={`border-t border-line ${p.is_active ? "" : "opacity-50"}`}>
                <td className="px-3 py-1.5"><Link href={`/products/${p.id}`} className="flex items-center gap-2 hover:underline"><ScheduleBadge schedule={p.schedule} coldChain={p.cold_chain} />{p.name}</Link>
                  <span className="text-xs text-muted">{p.manufacturer}{p.blocked_reason && <span className="ml-1 text-danger">Blocked: {p.blocked_reason}</span>}</span></td>
                <td className="text-muted">{p.composition}</td>
                <td className="font-mono text-xs">{p.hsn}{p.gst_rate_override !== null && <span className="ml-1 rounded bg-brand-100 px-1 text-brand-900">GST {Number(p.gst_rate_override)}%</span>}</td>
                <td>{p.units_per_pack} {p.base_unit_label}/{p.pack_label}</td>
                <td>{p.rack}</td>
                <td className={`num text-right ${packs <= p.reorder_level ? "text-danger" : ""}`}>{packs} {p.pack_label}{loose ? ` + ${loose} ${p.base_unit_label}` : ""}</td>
                <td className="num pr-3 text-right">{p.reorder_level}</td>
              </tr>);
          })}
          {!rows.length && <tr><td colSpan={7} className="p-6 text-center text-muted">No products yet. <Link href="/products/import" className="underline">Import your product master</Link> or add one.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
