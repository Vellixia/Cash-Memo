/* global self, caches */
/* Cashmemo static-only service worker. Authenticated data is network-only. */
const CACHE_NAME = "cashmemo-static-v1";
const CACHEABLE_ASSET = /(?:^|\/)_(?:next\/static)\/.+\.(?:js|css|woff2?|ttf|otf)$|(?:^|\/)(?:icons\/[^/]+\.(?:png|svg|ico)|manifest\.webmanifest|brand\/[^/]+\.(?:svg|png))$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isRsc = request.headers.has("RSC") || url.searchParams.has("_rsc");
  const isAuthenticatedPath = url.pathname === "/app" || url.pathname.startsWith("/app") || url.pathname === "/deletion" || url.pathname.startsWith("/deletion");

  // Reject all non-GET, API, RSC, document, and private route requests from cache handling.
  if (request.method !== "GET" || url.pathname.startsWith("/api/") || isRsc || request.destination === "document" || request.mode === "navigate" || isAuthenticatedPath) return;
  if (!CACHEABLE_ASSET.test(url.pathname)) return;

  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
    if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});
