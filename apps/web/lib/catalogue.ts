"use client";
import type { Batch, DrugSchedule } from "@medstar/core";
import { posDb } from "./pos-db";
import { supabaseBrowser } from "./supabase";

export interface PosProduct {
  id: string;
  name: string;
  composition: string;
  manufacturer: string;
  hsn: string;
  /** -1 when no GST rate is configured for the HSN (bill will be refused by the server) */
  gstRate: number;
  schedule: DrugSchedule;
  rxRequired?: boolean;
  habitForming?: boolean;
  coldChain?: boolean;
  allowLoose?: boolean;
  blockedReason?: string | null;
  unitsPerPack: number;
  packLabel: string;
  baseLabel: string;
  barcode: string;
  rack?: string;
  batches: Batch[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromRpc(r: any): PosProduct {
  return {
    id: r.id, name: r.name, composition: r.composition ?? "", manufacturer: r.manufacturer ?? "", hsn: r.hsn,
    gstRate: Number(r.gstRate), schedule: r.schedule, rxRequired: r.rxRequired, habitForming: r.habitForming, coldChain: r.coldChain,
    allowLoose: r.allowLoose, blockedReason: r.blockedReason, unitsPerPack: r.unitsPerPack, packLabel: r.packLabel, baseLabel: r.baseLabel,
    barcode: r.barcode ?? "", rack: r.rack ?? undefined,
    batches: (r.batches ?? []).map((b: any) => ({ id: b.id, batchNo: b.batchNo, expiry: b.expiry, qtyBase: b.qtyBase, packMrpPaise: Number(b.packMrpPaise), status: b.status, receivedAt: b.receivedAt })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const searchText = (p: PosProduct) => `${p.barcode} ${p.name} ${p.composition} ${p.manufacturer}`.toLowerCase();

/** Download the store's stocked catalogue into IndexedDB so search and FEFO work offline. */
export async function refreshCatalogue(storeId: string): Promise<number> {
  const sb = supabaseBrowser();
  if (!sb || !navigator.onLine) return posDb.catalogue.where("storeId").equals(storeId).count();
  const { data, error } = await sb.rpc("pos_catalogue", { p_store: storeId });
  if (error) throw error;
  const rows = (data as unknown[]).map(fromRpc);
  await posDb.transaction("rw", posDb.catalogue, posDb.meta, async () => {
    await posDb.catalogue.where("storeId").equals(storeId).delete();
    await posDb.catalogue.bulkPut(rows.map((p) => ({ key: `${storeId}:${p.id}`, storeId, search: searchText(p), product: p })));
    await posDb.meta.put({ key: `catalogue:${storeId}`, value: Date.now() });
  });
  return rows.length;
}

export async function catalogueAge(storeId: string): Promise<number | null> {
  const v = (await posDb.meta.get(`catalogue:${storeId}`))?.value;
  return typeof v === "number" ? Date.now() - v : null;
}

/** Local search: exact barcode first, then name prefix, then contains. */
export async function searchLocal(storeId: string, q: string, limit = 8): Promise<PosProduct[]> {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const all = await posDb.catalogue.where("storeId").equals(storeId).toArray();
  const scored = all
    .map(({ product, search }) => ({
      product,
      score: product.barcode === s ? 100 : product.name.toLowerCase().startsWith(s) ? 50 : search.includes(s) ? 10 : 0,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
  return scored.slice(0, limit).map((x) => x.product);
}

/** Server search (also finds products with no stock, so staff see "out of stock" instead of "not found"). */
export async function searchRemote(storeId: string, q: string): Promise<PosProduct[]> {
  const sb = supabaseBrowser();
  if (!sb || !navigator.onLine) return [];
  const { data, error } = await sb.rpc("pos_catalogue", { p_store: storeId, p_q: q, p_limit: 8 });
  if (error) return [];
  return (data as unknown[]).map(fromRpc);
}

/** Keep offline stock honest after a local sale until the next catalogue refresh. */
export async function decrementLocalStock(storeId: string, allocations: Array<{ productId: string; batchId: string; qtyBase: number }>) {
  await posDb.transaction("rw", posDb.catalogue, async () => {
    for (const a of allocations) {
      const row = await posDb.catalogue.get(`${storeId}:${a.productId}`);
      if (!row) continue;
      row.product.batches = row.product.batches.map((b) => (b.id === a.batchId ? { ...b, qtyBase: b.qtyBase - a.qtyBase } : b));
      await posDb.catalogue.put(row);
    }
  });
}
