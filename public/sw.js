/* Prévisions Matières — service worker (offline app shell)
 * Strategy:
 *  - install: precache the app shell (root document + static assets discovered
 *    at runtime are cached on fetch).
 *  - navigation requests: network-first, fall back to cached root so the app
 *    loads offline (auth gate happens client-side via Supabase cookies).
 *  - /_next/static: cache-first (immutable hashed assets).
 *  - Supabase API / auth endpoints: never cache (pass-through).
 */
const CACHE = "pm-shell-v2";
const PRECACHE = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache Supabase / auth / external / PDF-generation endpoints
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/auth/")) return;
  if (url.pathname.includes("/pdf") || /application\/pdf/.test(req.headers.get("accept") ?? "")) return;

  // Navigation: network-first with cache fallback (app shell)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Static Next assets: cache-first, then network + store
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Other same-origin GETs (favicon, icons): stale-while-revalidate
  event.respondWith(
    caches.match(req).then(
      (cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }
    )
  );
});
