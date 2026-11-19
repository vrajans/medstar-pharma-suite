"use client";
import { useEffect, useState } from "react";
import { formatINR, parseStockRow, type StockImportRow } from "@medstar/core";
import { CsvImport, type ServerCheck } from "@/components/CsvImport";
import { supabaseBrowser } from "@/lib/supabase";
import { inputCls } from "@/components/ui";

interface P { id: string; name: string; units_per_pack: number; product_barcodes: Array<{ barcode: string }> }
type Row = StockImportRow & { productId: string; productLabel: string };

const TEMPLATE = [
  ["barcode", "product", "batch", "expiry", "mrp", "cost", "qty_packs", "qty_units"],
  ["8901234500011", "", "DL2611", "08/28", "30.91", "21.00", "40", "7"],
  ["", "Alprax 0.25 Tablet", "AX0912", "09/27", "22.00", "15.00", "12", "0"],
];

export function OpeningStockImport({ orgId, storeId }: { orgId: string; storeId: string }) {
  const [products, setProducts] = useState<P[] | null>(null);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [key] = useState(() => crypto.randomUUID());

  useEffect(() => {
    void (async () => {
      const all: P[] = [];
      for (let from = 0; ; from += 1000) { // page through the full master
        const { data } = await supabaseBrowser()!.from("products").select("id, name, units_per_pack, product_barcodes(barcode)").eq("org_id", orgId).range(from, from + 999);
        all.push(...((data ?? []) as P[]));
        if (!data || data.length < 1000) break;
      }
      setProducts(all);
    })();
  }, [orgId]);

  if (!products) return <p className="text-sm text-muted">Loading product master…</p>;
  if (!products.length) return <p className="text-sm text-danger">Import your product master first — opening stock rows must match existing products.</p>;

  const byCode = new Map(products.flatMap((p) => p.product_barcodes.map((b) => [b.barcode, p] as const)));
  const byName = new Map(products.map((p) => [p.name.toLowerCase(), p] as const));

  const parseRow = (r: Record<string, string>): { ok: true; value: Row } | { ok: false; errors: string[] } => {
    const code = (r.barcode ?? "").replace(/\s/g, "");
    const name = (r.product ?? r.name ?? r.product_name ?? "").trim().toLowerCase();
    const p = (code && byCode.get(code)) || (name && byName.get(name)) || undefined;
    if (!p) return { ok: false, errors: [`no product matches ${code ? `barcode ${code}` : `"${r.product ?? ""}"`}`] };
    const res = parseStockRow(r, p.units_per_pack);
    return res.ok ? { ok: true, value: { ...res.value, productId: p.id, productLabel: p.name } } : res;
  };

  const call = async (rows: Row[], dry: boolean): Promise<ServerCheck> => {
    const { data, error } = await supabaseBrowser()!.rpc("post_opening_stock", { p: {
      idempotencyKey: key, storeId, asOf, dryRun: dry,
      rows: rows.map((r) => ({ productId: r.productId, batchNo: r.batchNo, expiry: r.expiry, packMrpPaise: r.packMrpPaise, packCostPaise: r.packCostPaise, qtyBase: r.qtyBase })),
    } });
    if (error) throw error;
    if (data.duplicate) return { errors: [], summary: "This file was already imported." };
    return { ...data, summary: `${dry ? "Will load" : "Loaded"} ${data.rows} batch line(s) worth ${formatINR(Number(data.valuePaise))} at cost${dry ? "" : " — posted to Inventory / Opening balances"}` };
  };

  return (
    <div className="space-y-3">
      <label className="block max-w-xs text-sm">Stock as on date<input type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
      <CsvImport<Row>
        templateName="medstar-opening-stock-template.csv" templateRows={TEMPLATE} parseRow={parseRow}
        check={(r) => call(r, true)} commit={(r) => call(r, false)}
        describe={(r) => `${r.productLabel} · ${r.batchNo} · exp ${r.expiry} · MRP ${formatINR(r.packMrpPaise)} · cost ${formatINR(r.packCostPaise)} · ${r.qtyBase} units`} />
    </div>
  );
}
