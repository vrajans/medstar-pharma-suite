"use client";
import Dexie, { type Table } from "dexie";
import type { PostSale } from "@medstar/core";
import type { PosProduct } from "./catalogue";

export interface OutboxBill {
  billUuid: string;
  storeId: string;
  provisionalNo: string;
  payload: PostSale;
  totalPaise: number;
  /** Schedule X / NDPS prescription copy captured at the counter, uploaded before post_sale */
  rxFile?: Blob;
  rxUploaded?: boolean;
  status: "pending" | "synced" | "error";
  invoiceNo?: string;
  needsReview?: boolean;
  error?: string;
  attempts: number;
  createdAt: number;
}

export interface CachedProduct { key: string; storeId: string; search: string; product: PosProduct }

class PosDb extends Dexie {
  outbox!: Table<OutboxBill, string>;
  meta!: Table<{ key: string; value: number | string }, string>;
  catalogue!: Table<CachedProduct, string>;
  constructor() {
    super("medstar-pos");
    this.version(1).stores({ outbox: "billUuid, status, createdAt", meta: "key" });
    this.version(2).stores({ outbox: "billUuid, status, storeId, createdAt", meta: "key", catalogue: "key, storeId" });
  }
}

export const posDb: PosDb = typeof window !== "undefined" ? new PosDb() : (null as unknown as PosDb);

/** Stable per-browser device code used in provisional bill numbers (OFF-<device>-<seq>). */
export async function deviceCode(): Promise<string> {
  const cur = (await posDb.meta.get("device"))?.value;
  if (typeof cur === "string") return cur;
  const code = "P" + Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  await posDb.meta.put({ key: "device", value: code });
  return code;
}

export async function nextLocalSeq(): Promise<number> {
  return posDb.transaction("rw", posDb.meta, async () => {
    const cur = Number((await posDb.meta.get("seq"))?.value ?? 0);
    await posDb.meta.put({ key: "seq", value: cur + 1 });
    return cur + 1;
  });
}
