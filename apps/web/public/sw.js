// Cash Memo service worker: installable app shell + read-only offline.
// - /_next/static, icons, fonts: cache-first (content-hashed / immutable)
// - other same-origin GETs (pages, RSC payloads, /api reads): network-first, cached copy when offline
// - navigations with nothing cached: /offline
// - writes always go to the network; the UI disables them while offline
// Bump VERSION to drop every old cache on the next activation.
const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const PRECACHE = ["/offline", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, RUNTIME].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Bumped on every login/signup/logout so reads that were in flight across the switch aren't cached.
let generation = 0;

// The page asks the waiting worker to take over when the user accepts an update.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(?:svg|png|woff2?)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method !== "GET") {
    // Cached reads belong to whoever was signed in; never let them outlive the session.
    if (/^\/api\/auth\/(login|signup|logout)$/.test(url.pathname)) {
      generation++;
      event.respondWith(
        fetch(request).finally(() => {
          generation++;
          return caches.delete(RUNTIME);
        }),
      );
    }
    return;
  }

  if (isStatic(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  const gen = generation;
  event.respondWith(
    fetch(request)
      .then((res) => {
        // Skip redirects (auth bounces to /login) and errors so they never replay offline.
        if (res.ok && !res.redirected && gen === generation) {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        if (request.mode === "navigate") return caches.match("/offline");
        return Response.error();
      }),
  );
});
