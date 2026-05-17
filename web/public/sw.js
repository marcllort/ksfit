/**
 * Stride service worker.
 *
 * The dashboard is auth-gated and SSR'd against a live KS Fit cookie, so we
 * deliberately do NOT cache HTML pages or API responses — stale auth state is
 * worse than a network error. The SW only caches:
 *
 *   - Hashed Next.js static assets (`/_next/static/*`), cache-first.
 *   - The app shell needed to render the offline fallback (manifest, icons,
 *     `/offline`), precached on install.
 *
 * For navigation requests we go network-first and fall back to the offline
 * page only if the network is unreachable.
 */
const CACHE = "stride-v1";
const SHELL = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/192",
  "/icons/512",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          SHELL.map((url) =>
            cache.add(url).catch(() => {
              // Best-effort precache — a missing entry shouldn't block install.
            }),
          ),
        ),
      ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return;

  // Hashed static assets are immutable — cache-first wins.
  if (url.pathname.startsWith("/_next/static")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch (err) {
          if (hit) return hit;
          throw err;
        }
      }),
    );
    return;
  }

  // Navigations: try the network, fall back to the offline shell.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE);
          const offline = await cache.match("/offline");
          return (
            offline ??
            new Response("Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      })(),
    );
  }
});
