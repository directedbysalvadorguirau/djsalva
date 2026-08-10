const CACHE_NAME = "djsalva-pwa-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/brand-mark.svg",
  "/favicon.png",
  "/laptop-session.png",
  "/fondo2.png",
  "/fondo3.png",
  "/djsalva-icon.png",
  "/icon-ibicenca.png",
  "/icon3.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
