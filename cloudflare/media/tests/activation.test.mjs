import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mediaFiles } from "../media-files.mjs";
import { migrationPlan, validateOrigin, previousOrigin, verifyMedia } from "../scripts/activate.mjs";
import worker from "../worker.mjs";

const newOrigin = "https://djsalva-media.example.workers.dev";
// Keep the migration fixture independent of the site's already-migrated URLs.
const html = `<!doctype html><title>DJ SALVA</title><script>
const sources = ${JSON.stringify(mediaFiles.map(file => `${previousOrigin}/${file.key}`))};
const cacheName = "djsalva-pwa-v24";
navigator.serviceWorker.register("/sw.js?v=24");
</script>`;
const sw = 'const CACHE_NAME = "djsalva-pwa-v24";';

test("website uses all ten Cloudflare media files and matching PWA cache versions", async () => {
  const site = await readFile(new URL("../../../index.html", import.meta.url), "utf8");
  const serviceWorker = await readFile(new URL("../../../sw.js", import.meta.url), "utf8");
  const origin = "https://djsalva-media.salva00000001.workers.dev";
  assert(!site.includes(previousOrigin));
  assert.equal(site.split(origin).length - 1, mediaFiles.length);
  for (const file of mediaFiles) assert.equal(site.split(`${origin}/${file.key}`).length - 1, 1);
  const version = /djsalva-pwa-v(\d+)/.exec(serviceWorker)[1];
  assert(site.includes(`/sw.js?v=${version}`));
  assert(site.includes(`djsalva-pwa-v${version}`));
});

test("activation accepts only an HTTPS workers.dev origin, not keys or arbitrary URLs", () => {
  assert.equal(validateOrigin(newOrigin + "/"), newOrigin);
  for (const invalid of ["http://media.example.workers.dev", "https://workers.dev", newOrigin + "/secret", newOrigin + "?key=secret", "https://user:secret@media.example.workers.dev", "https://example.org"]) {
    assert.throws(() => validateOrigin(invalid));
  }
});

test("migration changes only the ten media origins and PWA cache version", () => {
  const next = migrationPlan(html, sw, newOrigin);
  assert(!next.html.includes(previousOrigin));
  assert.equal(next.html.split(newOrigin).length - 1, 10);
  const oldVersion = Number(/djsalva-pwa-v(\d+)/.exec(sw)[1]);
  assert(next.sw.includes(`djsalva-pwa-v${oldVersion + 1}`));
  assert.equal(next.html.replaceAll(newOrigin, previousOrigin)
    .replaceAll(`/sw.js?v=${oldVersion + 1}`, `/sw.js?v=${oldVersion}`)
    .replaceAll(`djsalva-pwa-v${oldVersion + 1}`, `djsalva-pwa-v${oldVersion}`), html);
  assert.throws(() => migrationPlan(html.replace("sesion01.mp3", "missing.mp3"), sw, newOrigin));
  assert.throws(() => migrationPlan(html + previousOrigin + "/unreviewed.mp3", sw, newOrigin));
  assert.throws(() => migrationPlan(next.html, next.sw, newOrigin));
});

test("preflight checks all ten files while reading only 340 content bytes total", async () => {
  const data = new Uint8Array(256);
  const meta = { size: 256, etag: "fixture", httpEtag: '"fixture"', uploaded: new Date() };
  let bytesRead = 0;
  const env = { MEDIA: {
    async head() { return meta; },
    async get(key, { range }) {
      assert(range, "Preflight must not request whole media files");
      bytesRead += range.length;
      return { ...meta, body: new Response(data.slice(range.offset, range.offset + range.length)).body };
    }
  } };
  const fetcher = (url, options) => worker.fetch(new Request(url, options), env);
  const inventory = mediaFiles.map(file => ({ key: file.key, bytes: 256 }));
  await verifyMedia(newOrigin, inventory, fetcher);
  assert.equal(bytesRead, 340);
  env.MEDIA.head = async () => null;
  await assert.rejects(() => verifyMedia(newOrigin, inventory, fetcher), /HEAD debe ser 200/);
});

test("verification cancels servers that ignore Range instead of downloading a session", async () => {
  let cancelled = false;
  const fetcher = async (url, options) => {
    if (url.endsWith("/health")) return Response.json({ service: "djsalva-media" });
    if (options.method === "HEAD") return new Response(null, { headers: {
      "Content-Length": "256", "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "https://djsalva.vercel.app", ETag: '"fixture"'
    } });
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  };
  const inventory = mediaFiles.map(file => ({ key: file.key, bytes: 256 }));
  await assert.rejects(() => verifyMedia(newOrigin, inventory, fetcher), /rangos/);
  assert(cancelled);
});
