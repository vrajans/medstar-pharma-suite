"use client";
import { useEffect } from "react";

/** Registers the offline app shell in production builds only (a service worker would fight hot reload in dev). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

/** Remove the cached billing screen (it contains the signed-in user's store details) — called on sign-out. */
export async function clearOfflineShell() {
  try {
    navigator.serviceWorker?.controller?.postMessage("clear");
    if ("caches" in window) await Promise.all((await caches.keys()).filter((k) => k.startsWith("medstar-pos")).map((k) => caches.delete(k)));
  } catch { /* nothing cached */ }
}
