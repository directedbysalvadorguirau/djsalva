import assert from "node:assert/strict";
import test from "node:test";
import worker, { parseRange } from "../worker.mjs";
import { mediaFiles } from "../media-files.mjs";

const origin = "https://djsalva.vercel.app";
const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
const metadata = { size: bytes.length, etag: "fixture", httpEtag: '"fixture"', uploaded: new Date("2026-10-01T12:00:00.900Z") };

export function fixture() {
  const calls = [];
  const env = {
    ALLOWED_ORIGINS: origin,
    MEDIA: {
      async head(key) { calls.push(["head", key]); return metadata; },
      async get(key, options) {
        calls.push(["get", key, options]);
        assert.equal(options.onlyIf.etagMatches, metadata.etag);
        const { offset = 0, length = bytes.length } = options.range || {};
        return { ...metadata, body: new Response(bytes.slice(offset, offset + length)).body };
      }
    }
  };
  const request = (path = "sesion01.mp3", options = {}) => worker.fetch(new Request(`https://media.example.workers.dev/${path}`, options), env);
  return { calls, env, request };
}

test("only the ten active files are exposed, including exactly two parts of 04", () => {
  assert.equal(mediaFiles.length, 10);
  assert.equal(mediaFiles.filter(f => f.type === "video/mp4").length, 4);
  assert(!mediaFiles.some(f => f.key === "sesion04-3.mp3"));
});

test("closed, open-ended, clamped and suffix byte ranges", () => {
  assert.deepEqual(parseRange("bytes=0-1", 256), { offset: 0, length: 2 });
  assert.deepEqual(parseRange("bytes=100-", 256), { offset: 100, length: 156 });
  assert.deepEqual(parseRange("bytes=250-999", 256), { offset: 250, length: 6 });
  assert.deepEqual(parseRange("bytes=-32", 256), { offset: 224, length: 32 });
  assert.deepEqual(parseRange("bytes=-999", 256), { offset: 0, length: 256 });
  for (const value of ["bytes=256-", "bytes=2-1", "bytes=-0", "bytes=-", "bytes=0-1,4-5", "items=0-2", "bytes=9999999999999999999-", "garbage"]) {
    assert.equal(parseRange(value, 256), null, value);
  }
  assert.equal(parseRange("bytes=0-1", 0), null);
});

test("GET streams the object and HEAD never fetches its body", async () => {
  const { request, calls } = fixture();
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("content-length"), "256");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.match(response.headers.get("cache-control"), /no-transform/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  calls.length = 0;
  const head = await request("audio/sesion04.mp4", { method: "HEAD", headers: { Range: "bytes=0-1" } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "video/mp4");
  assert.equal(head.headers.get("content-length"), "256");
  assert.equal(head.body, null);
  assert.deepEqual(calls, [["head", "audio/sesion04.mp4"]]);
});

test("Safari-style initial, seek and suffix requests return exact 206 bytes", async () => {
  const { request } = fixture();
  for (const [range, offset, end] of [["bytes=0-1", 0, 1], ["bytes=180-", 180, 255], ["bytes=-32", 224, 255]]) {
    const response = await request("audio/sesion03.mp4", { headers: { Origin: origin, Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${offset}-${end}/256`);
    assert.equal(response.headers.get("content-length"), String(end - offset + 1));
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(offset, end + 1));
  }
});

test("unsatisfiable ranges return 416 without a full download", async () => {
  const { request, calls } = fixture();
  const response = await request("sesion01.mp3", { headers: { Range: "bytes=999-" } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */256");
  assert.equal(response.body, null);
  assert.equal(calls.length, 1);
});

test("ETag and Last-Modified prevent repeated body downloads", async () => {
  const { request, calls } = fixture();
  for (const headers of [
    { "If-None-Match": 'W/"fixture"' }, { "If-None-Match": '"other", "fixture"' },
    { "If-None-Match": "*" }, { "If-Modified-Since": "Thu, 01 Oct 2026 12:00:00 GMT" }
  ]) {
    const response = await request("sesion01.mp3", { headers });
    assert.equal(response.status, 304);
    assert.equal(response.body, null);
  }
  assert(calls.every(call => call[0] === "head"));
  const response = await request("sesion01.mp3", { headers: { "If-None-Match": '"other"', "If-Modified-Since": "Thu, 01 Oct 2026 12:00:00 GMT" } });
  assert.equal(response.status, 200);
  await response.body.cancel();
});

test("If-Range only returns partial content for the current representation", async () => {
  const { request } = fixture();
  for (const [condition, status] of [['"fixture"', 206], ['"old"', 200], ['W/"fixture"', 200], ["Thu, 01 Oct 2026 12:00:00 GMT", 206], ["invalid-date", 200]]) {
    const response = await request("sesion01.mp3", { headers: { Range: "bytes=0-1", "If-Range": condition } });
    assert.equal(response.status, status);
    await response.body.cancel();
  }
});

test("CORS and preflight support the website but reject unknown browser origins", async () => {
  const { request, calls } = fixture();
  const blocked = await request("sesion01.mp3", { headers: { Origin: "https://unrelated.example" } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  const preflight = await request("sesion01.mp3", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Range" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.match(preflight.headers.get("access-control-allow-headers"), /Range/);
  assert.equal(calls.length, 0);
});

test("no upload, deletion, listing, private file or arbitrary proxy endpoints", async () => {
  const { request, calls } = fixture();
  for (const path of ["", ".env", "private.mp3", "sesion04-3.mp3", "%ZZ", "https://example.org/video.mp4"]) {
    assert([400, 404].includes((await request(path)).status));
  }
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal((await request("sesion01.mp3", { method })).status, 405);
  assert.equal(calls.length, 0);
});

test("health does not read objects, and absent files are 404 not HTML", async () => {
  const { request, env, calls } = fixture();
  assert.deepEqual(await (await request("health")).json(), { service: "djsalva-media", version: 1, files: 10 });
  assert.equal(calls.length, 0);
  env.MEDIA.head = async () => null;
  assert.equal((await request()).status, 404);
});

test("R2 errors and replacement races fail safely without leaking internal errors", async () => {
  const { request, env } = fixture();
  env.MEDIA.get = async () => metadata;
  let response = await request();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  env.MEDIA.head = async () => { throw new Error("internal-secret"); };
  response = await request();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "30");
  assert(!(await response.text()).includes("internal-secret"));
});
