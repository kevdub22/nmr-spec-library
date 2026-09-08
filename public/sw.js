/*
  Service worker for the Spec Sheet Library PWA.

  Goals, in order: never break the live app, then work offline, then be fast.
  That ordering is why this is deliberately network-first for anything that
  changes between deploys — a stale HTML/CSS/JS cache is far more annoying than
  a slightly slower load, and the site has no hashed filenames to fall back on.

  Bump CACHE_VERSION on any change to the precache list or the strategies.
*/
const CACHE_VERSION = "v1";
const CACHE = `nmr-specs-${CACHE_VERSION}`;

/* The shell needed to render something useful with no network. Deliberately
   small: no catalog data, since that is fetched per-session and can be large. */
const PRECACHE = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/catalog.js",
  "/assets/nmr-logo.svg",
  "/assets/hero.png",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      /* Individual addAll() failures would reject the whole install and leave
         the SW permanently un-activated, so tolerate per-file misses. */
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("nmr-specs-") && n !== CACHE)
             .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/* Only cache things that are actually ours and actually cacheable. */
function cacheable(response) {
  return response && response.ok && response.type === "basic";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  /* Never touch anything but same-origin GETs. */
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Hands off every dynamic endpoint. These are the catalog feed, the PDF
     exports and the x-admin-key'd admin CRUD — caching or replaying any of
     them would serve stale inventory or leak an authed response into a shared
     cache. Let them go straight to the network, untouched. */
  if (url.pathname.startsWith("/.netlify/functions/") ||
      url.pathname.startsWith("/api/")) {
    return;
  }

  /* Navigations: network-first so a deploy is picked up immediately; fall back
     to the cached shell only when genuinely offline. */
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (cacheable(fresh)) {
            const cache = await caches.open(CACHE);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch (err) {
          return (await caches.match(req)) ||
                 (await caches.match("/index.html")) ||
                 Response.error();
        }
      })()
    );
    return;
  }

  const dest = req.destination;

  /* Images and fonts are effectively immutable here, so serve them from cache
     and refresh in the background. */
  if (dest === "image" || dest === "font") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        const network = fetch(req)
          .then(async (res) => {
            if (cacheable(res)) {
              const cache = await caches.open(CACHE);
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })()
    );
    return;
  }

  /* Everything else (CSS, JS, the manifest): network-first, cache as backup.
     Without hashed filenames this is what keeps a deploy from being masked by
     a stale script. */
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        if (cacheable(fresh)) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })()
  );
});
