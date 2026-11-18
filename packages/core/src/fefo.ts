export type BatchStatus = "active" | "quarantined" | "recalled" | "nsq";

export interface Batch {
  id: string;
  batchNo: string;
  /** ISO date of expiry (use last day of the printed month) */
  expiry: string;
  receivedAt: string;
  qtyBase: number;
  packMrpPaise: number;
  status: BatchStatus;
}

export interface Allocation { batchId: string; batchNo: string; qtyBase: number; expiry: string; packMrpPaise: number; nearExpiry: boolean }

export class StockError extends Error {
  constructor(public code: "INSUFFICIENT" | "BLOCKED" | "EXPIRED", message: string, public available = 0) {
    super(message);
    this.name = "StockError";
  }
}

/** Printed expiry "08/27" → "2027-08-31" */
export function expiryFromMonthYear(mmYY: string): string {
  const m = /^(\d{1,2})[/-](\d{2}|\d{4})$/.exec(mmYY.trim());
  if (!m) throw new Error(`Invalid expiry ${mmYY}`);
  const month = Number(m[1]);
  const year = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid expiry month ${mmYY}`);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export function isSellable(b: Batch, today: string): boolean {
  return b.status === "active" && b.expiry >= today && b.qtyBase > 0;
}

/**
 * First-Expiry-First-Out allocation, ties broken by earliest receipt.
 * Expired / quarantined / recalled / NSQ batches are never allocated.
 */
export function allocateFefo(
  batches: Batch[],
  qtyBase: number,
  today: string,
  opts: { nearExpiryDays?: number; preferredBatchId?: string } = {},
): Allocation[] {
  if (qtyBase <= 0) throw new Error("qtyBase must be > 0");
  const near = opts.nearExpiryDays ?? 30;

  if (opts.preferredBatchId) {
    const b = batches.find((x) => x.id === opts.preferredBatchId);
    if (!b) throw new StockError("BLOCKED", "Selected batch not found");
    if (b.status !== "active") throw new StockError("BLOCKED", `Batch ${b.batchNo} is ${b.status} and cannot be sold`);
    if (b.expiry < today) throw new StockError("EXPIRED", `Batch ${b.batchNo} expired on ${b.expiry}`);
  }

  const sellable = batches
    .filter((b) => isSellable(b, today))
    .sort((a, b) =>
      opts.preferredBatchId && a.id === opts.preferredBatchId ? -1
      : opts.preferredBatchId && b.id === opts.preferredBatchId ? 1
      : a.expiry.localeCompare(b.expiry) || a.receivedAt.localeCompare(b.receivedAt));

  const available = sellable.reduce((s, b) => s + b.qtyBase, 0);
  if (available < qtyBase)
    throw new StockError("INSUFFICIENT", `Only ${available} units available in sellable batches`, available);

  const out: Allocation[] = [];
  let remaining = qtyBase;
  for (const b of sellable) {
    if (remaining === 0) break;
    const take = Math.min(b.qtyBase, remaining);
    out.push({
      batchId: b.id, batchNo: b.batchNo, qtyBase: take, expiry: b.expiry, packMrpPaise: b.packMrpPaise,
      nearExpiry: daysBetween(today, b.expiry) <= near,
    });
    remaining -= take;
  }
  return out;
}
