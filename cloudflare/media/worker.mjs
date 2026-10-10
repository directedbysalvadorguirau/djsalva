import { mediaFiles } from "./media-files.mjs";

const files = new Map(mediaFiles.map(file => [`/${file.key}`, file]));
const methods = "GET, HEAD, OPTIONS";

export function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if ([start, end].some(n => n !== null && !Number.isSafeInteger(n))) return null;
  if (start === null) {
    if (end === 0) return null;
    const length = Math.min(end, size);
    return { offset: size - length, length };
  }
  if (start >= size || (end !== null && end < start)) return null;
  return { offset: start, length: Math.min(end ?? size - 1, size - 1) - start + 1 };
}

function notModified(request, meta) {
  const etags = request.headers.get("if-none-match");
  if (etags !== null) {
    return etags.split(",").some(tag => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === meta.httpEtag);
  }
  const since = request.headers.get("if-modified-since");
  return since !== null && Math.floor(meta.uploaded.getTime() / 1000) <= Math.floor(Date.parse(since) / 1000);
}

function rangeIsCurrent(request, meta) {
  const condition = request.headers.get("if-range");
  if (!condition) return true;
  if (condition.startsWith('"') || condition.startsWith("W/")) return condition === meta.httpEtag;
  return Math.floor(meta.uploaded.getTime() / 1000) <= Math.floor(Date.parse(condition) / 1000);
}

export default {
  async fetch(request, env) {
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Origin"
    });
    const origin = request.headers.get("origin");
    const allowed = (env.ALLOWED_ORIGINS || "https://djsalva.vercel.app").split(",").map(s => s.trim());
    const reply = (body, status) => new Response(request.method === "HEAD" ? null : body, { status, headers });

    // This restricts cross-origin browser requests, not access to public media URLs.
    if (origin && !allowed.includes(origin)) return reply("Origin not allowed", 403);
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      headers.set("Allow", methods);
      return reply("Method not allowed", 405);
    }

    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); }
    catch { return reply("Invalid path", 400); }
    const file = files.get(pathname);
    if (!file && pathname !== "/health") return reply("Not found", 404);

    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", methods);
      headers.set("Access-Control-Allow-Headers", "Range, If-Range, If-None-Match, If-Modified-Since");
      headers.set("Access-Control-Max-Age", "86400");
      return reply(null, 204);
    }
    if (!env.MEDIA) return reply("Media storage not configured", 503);
    if (pathname === "/health") {
      headers.set("Content-Type", "application/json");
      return reply(JSON.stringify({ service: "djsalva-media", version: 1, files: files.size }), 200);
    }

    try {
      const meta = await env.MEDIA.head(file.key);
      if (!meta) return reply("Media not found", 404);
      headers.set("Content-Type", file.type);
      headers.set("Accept-Ranges", "bytes");
      headers.set("ETag", meta.httpEtag);
      headers.set("Last-Modified", meta.uploaded.toUTCString());
      headers.set("Cache-Control", "public, max-age=3600, no-transform");
      if (notModified(request, meta)) return reply(null, 304);
      if (request.method === "HEAD") {
        headers.set("Content-Length", String(meta.size));
        return reply(null, 200);
      }

      let range;
      const requestedRange = request.headers.get("range");
      if (requestedRange && rangeIsCurrent(request, meta)) {
        range = parseRange(requestedRange, meta.size);
        if (!range) {
          headers.set("Cache-Control", "no-store");
          headers.set("Content-Range", `bytes */${meta.size}`);
          return reply(null, 416);
        }
      }

      // Guard against replacement between HEAD and GET; never buffer a whole MP3.
      const object = await env.MEDIA.get(file.key, {
        onlyIf: { etagMatches: meta.etag },
        ...(range ? { range } : {})
      });
      if (!object || !object.body) {
        headers.set("Cache-Control", "no-store");
        headers.set("Retry-After", "1");
        return reply("Media changed; retry request", 503);
      }
      headers.set("Content-Length", String(range ? range.length : meta.size));
      if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`);
      return new Response(object.body, { status: range ? 206 : 200, headers });
    } catch {
      headers.set("Cache-Control", "no-store");
      headers.set("Content-Type", "text/plain; charset=utf-8");
      headers.delete("Content-Length");
      headers.delete("Content-Range");
      headers.set("Retry-After", "30");
      return reply("Media temporarily unavailable", 503);
    }
  }
};
