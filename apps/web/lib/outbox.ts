"use client";
import { PostSaleSchema } from "@medstar/core";
import { posDb, type OutboxBill } from "./pos-db";
import { supabaseBrowser } from "./supabase";

export type { OutboxBill } from "./pos-db";

/** Offline-first POS outbox (ADR-003). Bills are written here first, then synced idempotently. */
export async function enqueueBill(bill: Omit<OutboxBill, "status" | "createdAt" | "attempts">) {
  PostSaleSchema.parse(bill.payload);
  await posDb.outbox.put({ ...bill, status: "pending", attempts: 0, createdAt: Date.now() });
  void syncOutbox();
}

/** Business-rule rejections (check_violation etc.) need a manager; network errors are retried. */
const isPermanent = (code?: string) => !!code && ["23514", "42501", "P0001", "22P02", "23505"].includes(code);

let syncing: Promise<SyncResult> | null = null;
export interface SyncResult { synced: number; pending: number; failed: OutboxBill[] }

export function syncOutbox(): Promise<SyncResult> {
  syncing ??= doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync(): Promise<SyncResult> {
  const sb = supabaseBrowser();
  let synced = 0;
  if (sb && navigator.onLine) {
    const queue = await posDb.outbox.where("status").equals("pending").sortBy("createdAt");
    for (const b of queue) {
      try {
        const rxPath = b.payload.prescription?.rxImagePath;
        if (b.rxFile && rxPath && !b.rxUploaded) {
          const up = await sb.storage.from("prescriptions").upload(rxPath, b.rxFile, { upsert: true, contentType: b.rxFile.type || undefined });
          if (up.error) throw Object.assign(new Error(`Prescription upload failed: ${up.error.message}`), { transient: true });
          await posDb.outbox.update(b.billUuid, { rxUploaded: true });
        }
        const { data, error } = await sb.rpc("post_sale", { p: b.payload });
        if (error && error.code === "23514" && /approval/i.test(error.message) && b.payload.pharmacistApprovalId) {
          // PIN was verified at the counter but the one-time approval expired while the bill waited to sync:
          // post as an offline-approved Rx sale so it is flagged for review instead of being lost.
          await posDb.outbox.update(b.billUuid, { payload: { ...b.payload, pharmacistApprovalId: undefined, offline: true }, attempts: b.attempts + 1 });
          queue.push({ ...b, payload: { ...b.payload, pharmacistApprovalId: undefined, offline: true }, attempts: b.attempts + 1, rxUploaded: true });
          continue;
        }
        if (error) {
          if (isPermanent(error.code)) {
            await posDb.outbox.update(b.billUuid, { status: "error", error: error.message, attempts: b.attempts + 1 });
          } else {
            await posDb.outbox.update(b.billUuid, { attempts: b.attempts + 1, error: error.message });
            break; // connectivity / server trouble: keep order, retry later
          }
        } else {
          await posDb.outbox.update(b.billUuid, { status: "synced", invoiceNo: data.invoiceNo, needsReview: data.needsReview, error: undefined, rxFile: undefined });
          synced++;
        }
      } catch (e) {
        await posDb.outbox.update(b.billUuid, { attempts: b.attempts + 1, error: e instanceof Error ? e.message : String(e) });
        break;
      }
    }
  }
  const pending = await posDb.outbox.where("status").equals("pending").count();
  const failed = await posDb.outbox.where("status").equals("error").toArray();
  return { synced, pending, failed };
}

/** A manager re-queues a rejected bill after fixing the cause (e.g. receiving stock, adding a pharmacist). */
export async function retryBill(billUuid: string) {
  await posDb.outbox.update(billUuid, { status: "pending", error: undefined });
  return syncOutbox();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void syncOutbox());
  setInterval(() => void syncOutbox(), 60_000);
}

export type PostNowResult =
  | { status: "posted"; invoiceNo: string; needsReview: boolean }
  | { status: "rejected"; message: string }
  | { status: "queued"; reason: string };

/**
 * Online counter flow: post synchronously so the printed bill carries the final invoice number and business-rule
 * rejections stop the sale at the counter. Network failure or timeout → falls back to the offline outbox.
 */
export async function postSaleNow(bill: Omit<OutboxBill, "status" | "createdAt" | "attempts">, timeoutMs = 8000): Promise<PostNowResult> {
  PostSaleSchema.parse(bill.payload);
  const sb = supabaseBrowser();
  const queue = async (reason: string): Promise<PostNowResult> => {
    await enqueueBill({ ...bill, payload: { ...bill.payload, offline: true } });
    return { status: "queued", reason };
  };
  if (!sb || !navigator.onLine) return queue("offline");
  try {
    const rxPath = bill.payload.prescription?.rxImagePath;
    if (bill.rxFile && rxPath) {
      const up = await sb.storage.from("prescriptions").upload(rxPath, bill.rxFile, { upsert: true, contentType: bill.rxFile.type || undefined });
      if (up.error) return queue(`prescription upload failed (${up.error.message})`);
    }
    const { data, error } = await sb.rpc("post_sale", { p: bill.payload }).abortSignal(AbortSignal.timeout(timeoutMs));
    if (error) {
      if (isPermanent(error.code)) return { status: "rejected", message: error.message };
      return queue(error.message);
    }
    await posDb.outbox.put({ ...bill, rxFile: undefined, rxUploaded: true, status: "synced", invoiceNo: data.invoiceNo, needsReview: data.needsReview, attempts: 1, createdAt: Date.now() });
    return { status: "posted", invoiceNo: data.invoiceNo, needsReview: !!data.needsReview };
  } catch (e) {
    return queue(e instanceof Error ? e.message : String(e));
  }
}
