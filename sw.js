const CACHE_NAME = "djsalva-pwa-v8";
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

const SALVA03_DEVICE_FIX = `
<style id="salva03-device-fix">
  .frame-salva03{
    --screen-left: 21.22% !important;
    --screen-top: 39.86% !important;
    --screen-width: 41.08% !important;
    --screen-height: 14.92% !important;
    --video-scale: 1.08 !important;
  }

  .frame-salva03 .screen{
    background:#000 !important;
  }

  .frame-salva03 .screen video{
    position:absolute !important;
    inset:0 !important;
    min-width:100% !important;
    min-height:100% !important;
    background:#000 !important;
  }

  @media (max-width:600px){
    .frame-salva03{
      --screen-left: 21.14% !important;
      --screen-top: 39.82% !important;
      --screen-width: 41.26% !important;
      --screen-height: 15.02% !important;
      --video-scale: 1.09 !important;
    }
  }

  @supports (-webkit-touch-callout: none){
    @media (max-width:600px){
      .frame-salva03{
        --screen-left: 20.98% !important;
        --screen-top: 39.76% !important;
        --screen-width: 41.52% !important;
        --screen-height: 15.28% !important;
        --video-scale: 1.11 !important;
      }
    }
  }

  @media (display-mode: standalone) and (max-width:600px){
    .frame-salva03{
      --screen-left: 20.9% !important;
      --screen-top: 39.72% !important;
      --screen-width: 41.72% !important;
      --screen-height: 15.42% !important;
      --video-scale: 1.12 !important;
    }
  }
</style>`;

function injectSalva03Fix(html) {
  if (!html || html.includes("id=\"salva03-device-fix\"")) return html;
  return html.replace("</head>", `${SALVA03_DEVICE_FIX}</head>`);
}

async function buildPatchedHtmlResponse(response) {
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");

  return new Response(injectSalva03Fix(html), {
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
