import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { mediaFiles } from "../media-files.mjs";
import { verifyMedia } from "../scripts/activate.mjs";

test("actual Workers runtime streams R2 ranges and revalidates cached media", async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: await Promise.all(["worker.mjs", "media-files.mjs"].map(async name => ({
      type: "ESModule",
      path: fileURLToPath(new URL(`../${name}`, import.meta.url)),
      contents: await readFile(new URL(`../${name}`, import.meta.url), "utf8")
    }))),
    compatibilityDate: "2026-10-10",
    r2Buckets: ["MEDIA"]
  }));
  try {
    const bucket = await mf.getR2Bucket("MEDIA");
    const bytes = Uint8Array.from({ length: 1024 }, (_, i) => i % 256);
    for (const file of mediaFiles) await bucket.put(file.key, bytes, { httpMetadata: { contentType: file.type } });
    await verifyMedia("https://djsalva-media.test.workers.dev", mediaFiles.map(file => ({ key: file.key, bytes: 1024 })), (url, options) => mf.dispatchFetch(url, options));
    const first = await mf.dispatchFetch("https://media.test/sesion04-1.mp3", { headers: { Range: "bytes=400-449" } });
    assert.equal(first.status, 206);
    assert.deepEqual(new Uint8Array(await first.arrayBuffer()), bytes.slice(400, 450));
    const cached = await mf.dispatchFetch("https://media.test/sesion04-1.mp3", { headers: { "If-None-Match": first.headers.get("etag") } });
    assert.equal(cached.status, 304);
    const invalid = await mf.dispatchFetch("https://media.test/sesion04-1.mp3", { headers: { Range: "bytes=1024-" } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */1024");
  } finally {
    await mf.dispose();
  }
});
