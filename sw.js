const CACHE_NAME = "djsalva-pwa-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/laptop-session.png",
  "/manifest.webmanifest",
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

  // Solo cache-first para GET del mismo origen
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});