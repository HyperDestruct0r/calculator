// Offline-first service worker. Bump CACHE_VERSION whenever any app file changes.
const CACHE_VERSION = "v3.0.0";
const CACHE_NAME = "custom-graphing-calculator-" + CACHE_VERSION;
const APP_FILES = [
  "./",
  "./index.html",
  "./popup.html",
  "./style.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/app.js",
  "./js/calc.js",
  "./js/dom.js",
  "./js/editor.js",
  "./js/engine.js",
  "./js/format.js",
  "./js/graph.js",
  "./js/history.js",
  "./js/keypad.js",
  "./js/numerics.js",
  "./js/settings.js",
  "./js/store.js",
  "./js/table.js",
  "./js/complex.js",
  "./js/linalg.js",
  "./js/parser.js",
  "./js/polynomial.js",
  "./js/realmath.js",
  "./js/sheets.js",
  "./js/solver.js",
  "./js/graphtypes/curve.js",
  "./js/graphtypes/inequality.js",
  "./js/graphtypes/parametric.js",
  "./js/graphtypes/polar.js",
  "./js/graphtypes/sequence.js",
  "./js/graphui/curves.js",
  "./js/graphui/function.js",
  "./js/graphui/inequality.js",
  "./js/graphui/rows.js",
  "./js/graphui/sequence.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith("custom-graphing-calculator-") && k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => (req.mode === "navigate" ? caches.match("./index.html") : Response.error()));
    })
  );
});
