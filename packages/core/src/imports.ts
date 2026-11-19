import type { DrugSchedule } from "./compliance";
import { expiryFromMonthYear } from "./fefo";
import { rupeesToPaise } from "./money";

/**
 * Normalise rows from product-master / opening-stock CSVs into the shapes the import RPCs expect.
 * Every row returns either a value or a list of human-readable errors; nothing is silently dropped.
 */

const SCHEDULES: Record<string, DrugSchedule> = {
  "": "OTC", otc: "OTC", none: "OTC", g: "G", c: "C", c1: "C1", h: "H", rx: "H", h1: "H1", x: "X",
  ndps: "NDPS", narcotic: "NDPS", psychotropic: "NDPS", "schedule h": "H", "schedule h1": "H1", "schedule x": "X", "sch h": "H", "sch h1": "H1",
};

export function parseSchedule(v: string): DrugSchedule | null {
  return SCHEDULES[v.trim().toLowerCase()] ?? null;
}

const truthy = (v: string) => ["y", "yes", "true", "1"].includes(v.trim().toLowerCase());

export interface ProductImportRow {
  name: string;
  manufacturer?: string;
  composition?: string;
  dosageForm?: string;
  category: string;
  hsn: string;
  schedule: DrugSchedule;
  rxRequired: boolean;
  habitForming: boolean;
  coldChain: boolean;
  packLabel: string;
  baseUnitLabel: string;
  unitsPerPack: number;
  barcode?: string;
  reorderLevel: number;
  rack?: string;
  gstRateOverride?: number | null;
  listedOnline: boolean;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Expected columns: name, manufacturer, composition, dosage_form, category, hsn, schedule, rx_required,
 *  habit_forming, cold_chain, pack_label, base_unit, units_per_pack, barcode, reorder_level, rack, gst_override, online */
export function parseProductRow(r: Record<string, string>): Parsed<ProductImportRow> {
  const errors: string[] = [];
  const name = (r.name ?? r.product_name ?? r.item_name ?? "").trim();
  if (!name) errors.push("name is required");
  const hsn = (r.hsn ?? r.hsn_code ?? "").replace(/\s/g, "");
  if (!/^[0-9]{4,8}$/.test(hsn)) errors.push(`HSN "${hsn}" must be 4–8 digits`);
  const schedule = parseSchedule(r.schedule ?? "");
  if (!schedule) errors.push(`unknown schedule "${r.schedule}" (use OTC, G, H, H1, X, C, C1, NDPS)`);
  const units = Number(r.units_per_pack ?? r.pack_size ?? "1") || NaN;
  if (!Number.isInteger(units) || units <= 0) errors.push(`units_per_pack "${r.units_per_pack}" must be a whole number > 0`);
  const barcode = (r.barcode ?? r.ean ?? "").replace(/\s/g, "");
  if (barcode && !/^[0-9A-Za-z]{6,20}$/.test(barcode)) errors.push(`barcode "${barcode}" looks invalid`);
  const gstRaw = (r.gst_override ?? "").trim();
  const gstRateOverride = gstRaw === "" ? null : Number(gstRaw);
  if (gstRateOverride !== null && (!Number.isFinite(gstRateOverride) || gstRateOverride < 0 || gstRateOverride > 40)) errors.push(`gst_override "${gstRaw}" must be 0–40`);
  const reorder = Number(r.reorder_level || 0);
  if (!Number.isFinite(reorder) || reorder < 0) errors.push("reorder_level must be ≥ 0");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, manufacturer: r.manufacturer || undefined, composition: r.composition || r.salt || undefined, dosageForm: r.dosage_form || undefined,
      category: r.category || (schedule === "OTC" ? "OTC" : "Rx"), hsn, schedule: schedule!,
      rxRequired: truthy(r.rx_required ?? ""), habitForming: truthy(r.habit_forming ?? ""), coldChain: truthy(r.cold_chain ?? ""),
      packLabel: r.pack_label || "Strip", baseUnitLabel: r.base_unit || "Tab", unitsPerPack: units,
      barcode: barcode || undefined, reorderLevel: Math.floor(reorder), rack: r.rack || undefined, gstRateOverride,
      listedOnline: truthy(r.online ?? ""),
    },
  };
}

export interface StockImportRow {
  barcode?: string;
  productName?: string;
  batchNo: string;
  expiry: string; // ISO month-end
  packMrpPaise: number;
  packCostPaise: number; // ex-GST purchase rate per pack
  qtyBase: number;
}

/** Expected columns: barcode or product, batch, expiry (MM/YY or YYYY-MM-DD), mrp, cost (per pack), qty_packs and/or qty_units */
export function parseStockRow(r: Record<string, string>, unitsPerPack?: number): Parsed<StockImportRow> {
  const errors: string[] = [];
  const barcode = (r.barcode ?? "").replace(/\s/g, "") || undefined;
  const productName = (r.product ?? r.name ?? r.product_name ?? "").trim() || undefined;
  if (!barcode && !productName) errors.push("barcode or product name is required");
  const batchNo = (r.batch ?? r.batch_no ?? "").trim().toUpperCase();
  if (!batchNo) errors.push("batch is required");
  let expiry = "";
  const e = (r.expiry ?? r.exp ?? "").trim();
  try {
    expiry = /^\d{4}-\d{2}-\d{2}$/.test(e) ? e : expiryFromMonthYear(e);
  } catch { errors.push(`expiry "${e}" must be MM/YY or YYYY-MM-DD`); }
  let packMrpPaise = 0, packCostPaise = 0;
  try { packMrpPaise = rupeesToPaise(r.mrp ?? ""); } catch { errors.push(`mrp "${r.mrp}" is not a number`); }
  try { packCostPaise = rupeesToPaise(r.cost ?? r.ptr ?? r.rate ?? "0"); } catch { errors.push(`cost "${r.cost}" is not a number`); }
  if (packMrpPaise <= 0) errors.push("mrp must be > 0");
  if (packCostPaise > packMrpPaise) errors.push("cost is above MRP");
  const packs = Number(r.qty_packs || 0), loose = Number(r.qty_units || 0);
  if (!Number.isFinite(packs) || !Number.isFinite(loose) || packs < 0 || loose < 0) errors.push("quantities must be ≥ 0");
  if (packs > 0 && !unitsPerPack) errors.push("qty_packs needs a known product pack size");
  const qtyBase = Math.round(packs * (unitsPerPack ?? 1) + loose);
  if (qtyBase <= 0) errors.push("quantity must be > 0");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { barcode, productName, batchNo, expiry, packMrpPaise, packCostPaise, qtyBase } };
}
