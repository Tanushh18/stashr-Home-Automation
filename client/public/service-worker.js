/* ══════════════════════════════════════════════════════════
   Aurelia service worker

   Deliberately conservative for Stashr:
   only same-origin GET requests for the app shell and static
   assets are cached. API calls (a different origin) and any
   request carrying credentials always go straight to the
   network and are never stored.
   ══════════════════════════════════════════════════════════ */

const VERSION = "aurelia-v3";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/offline.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

const isStaticAsset = (url) =>
  url.pathname.startsWith("/assets/") ||
  url.pathname.startsWith("/static/") ||
  url.pathname.startsWith("/icons/") ||
  /\.(?:css|js|png|jpg|jpeg|svg|webp|ico|woff2?|glb)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin traffic — that is the API and the font CDN.
  if (url.origin !== self.location.origin) return;

  // Navigations: fresh first, cached shell when the network is away.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match("/index.html")) ||
            (await cache.match("/offline.html")) ||
            Response.error()
          );
        })
    );
    return;
  }

  // Static assets: serve instantly, refresh quietly in the background.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === "basic") {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
