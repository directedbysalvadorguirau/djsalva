const CACHE_NAME = "djsalva-pwa-v21";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest-v20.webmanifest",
  "/brand-mark.svg",
  "/favicon.ico",
  "/favicon-djsalva-v20.ico",
  "/favicon-djsalva-v20-32.png",
  "/favicon-djsalva-v20-64.png",
  "/pegatina-djsalva.png",
  "/instagram-icon.svg",
  "/gmail-icon.webp",
  "/laptop-session.png",
  "/fondo2.png",
  "/fondo3.png",
  "/session-01-icon.png",
  "/session-02-icon.png",
  "/session-03-icon.png",
  "/session-01-landscape.png",
  "/session-02-landscape.png",
  "/session-03-landscape.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon-v20.png",
  "/icons/maskable-512.png"
];

const VERCEL_ANALYTICS_SNIPPET = `
<script id="vercel-analytics-loader">
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
</script>
<script defer src="/_vercel/insights/script.js"></script>`;

function injectRuntimeFixes(html) {
  if (!html) return html;

  let patched = html;

  if (!patched.includes('id="vercel-analytics-loader"') && !patched.includes('/_vercel/insights/script.js')) {
    patched = patched.replace("</head>", `${VERCEL_ANALYTICS_SNIPPET}</head>`);
  }

  return patched;
}

async function buildPatchedHtmlResponse(response) {
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");

  return new Response(injectRuntimeFixes(html), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

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

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const network = await fetch(req);
        return await buildPatchedHtmlResponse(network);
      } catch (error) {
        const cached = await caches.match(req) || await caches.match("/index.html");
        if (cached) return buildPatchedHtmlResponse(cached);
        throw error;
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200 || res.type !== "basic") return res;
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match("/index.html"));
    })
  );
});
