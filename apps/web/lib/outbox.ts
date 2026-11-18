"use client";
import Dexie, { type Table } from "dexie";
import { PostSaleSchema, type PostSale } from "@medstar/core";
import { supabaseBrowser } from "./supabase";

/** Offline-first POS outbox (ADR-003). Bills are written here first, then synced idempotently. */
export interface OutboxBill {
  billUuid: string;
  provisionalNo: string;
  payload: PostSale;
  totalPaise: number;
  status: "pending" | "synced" | "error";
  invoiceNo?: string;
  error?: string;
  createdAt: number;
}

class PosDb extends Dexie {
  outbox!: Table<OutboxBill, string>;
  meta!: Table<{ key: string; value: number }, string>;
  constructor() {
    super("medstar-pos");
    this.version(1).stores({ outbox: "billUuid, status, createdAt", meta: "key" });
  }
}
export const posDb = typeof window !== "undefined" ? new PosDb() : (null as unknown as PosDb);

export async function nextLocalSeq(): Promise<number> {
  return posDb.transaction("rw", posDb.meta, async () => {
    const cur = (await posDb.meta.get("seq"))?.value ?? 0;
    await posDb.meta.put({ key: "seq", value: cur + 1 });
    return cur + 1;
  });
}

export async function enqueueBill(bill: Omit<OutboxBill, "status" | "createdAt">) {
  PostSaleSchema.parse(bill.payload);
  await posDb.outbox.put({ ...bill, status: "pending", createdAt: Date.now() });
  void syncOutbox();
}

let syncing = false;
/** Push pending bills; post_sale is idempotent on billUuid so retries are safe. */
export async function syncOutbox(): Promise<{ synced: number; pending: number }> {
  const sb = supabaseBrowser();
  if (!sb || syncing || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return { synced: 0, pending: await posDb.outbox.where("status").anyOf("pending", "error").count() };
  }
  syncing = true;
  let synced = 0;
  try {
    const pending = await posDb.outbox.where("status").anyOf("pending", "error").sortBy("createdAt");
    for (const b of pending) {
      const { data, error } = await sb.rpc("post_sale", { p: b.payload });
      if (error) await posDb.outbox.update(b.billUuid, { status: "error", error: error.message });
      else { await posDb.outbox.update(b.billUuid, { status: "synced", invoiceNo: data.invoiceNo, error: undefined }); synced++; }
    }
  } finally {
    syncing = false;
  }
  return { synced, pending: await posDb.outbox.where("status").anyOf("pending", "error").count() };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void syncOutbox());
}
