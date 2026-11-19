/* MedStar POS service worker — offline app shell (Sprint 4).
 * - /pos page: network-first, falls back to the last good copy, so the counter opens with no internet.
 * - Next.js static assets & icons: cache-first (they are content-hashed).
 * - Never touches Supabase or any other origin, and never caches redirects (signed-out → /login).
 * Bills made offline are kept by the app in IndexedDB and synced later; this file only keeps the screen loadable. */
const VERSION = "medstar-pos-v1";
const POS = "/pos";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.add(POS)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil(caches.delete(VERSION));
});

const isStatic = (url) => url.pathname.startsWith("/_next/static/") || /\.(?:png|svg|ico|woff2?|webmanifest)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStatic(url)) {
    event.respondWith(caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (req.mode === "navigate" && url.pathname === POS) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        if (res.ok && !res.redirected) cache.put(POS, res.clone());
        return res;
      } catch {
        return (await cache.match(POS)) ?? Response.error();
      }
    })());
    return;
  }

  if (req.mode === "navigate") {
    // other pages need the server; offline, send the cashier to the billing screen instead of a browser error
    event.respondWith(fetch(req).catch(async () => (await caches.match(POS)) ?? Response.error()));
  }
});
