import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mediaFiles } from "../media-files.mjs";

export const previousOrigin = "https://4r1ck5gfgtthlmqr.public.blob.vercel-storage.com";
const siteOrigin = "https://djsalva.vercel.app";

export function validateOrigin(value) {
  const url = new URL(value);
  assert(url.protocol === "https:" && url.hostname.endsWith(".workers.dev"), "Usa la URL HTTPS real de tu Worker en workers.dev.");
  assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "Indica solo el origen, sin ruta, claves ni parametros.");
  return url.origin;
}

export async function verifyMedia(origin, inventory, fetcher = fetch) {
  const headers = { Origin: siteOrigin };
  const request = (key, options) => fetcher(`${origin}/${key}`, {
    redirect: "error", signal: AbortSignal.timeout(20000), ...options
  });
  const health = await request("health", { headers });
  assert.equal(health.status, 200, "El Worker no responde.");
  assert.equal((await health.json()).service, "djsalva-media");
  for (const file of mediaFiles) {
    const expected = inventory.find(entry => entry.key === file.key);
    assert(expected?.bytes > 32, `Falta inventario de ${file.key}`);
    const head = await request(file.key, { method: "HEAD", headers });
    assert.equal(head.status, 200, `${file.key}: HEAD debe ser 200`);
    assert.equal(Number(head.headers.get("content-length")), expected.bytes, `${file.key}: tamano incorrecto`);
    assert.equal(head.headers.get("content-type"), file.type, `${file.key}: MIME incorrecto`);
    assert.equal(head.headers.get("accept-ranges"), "bytes");
    assert.equal(head.headers.get("access-control-allow-origin"), siteOrigin);
    assert(head.headers.get("etag"), `${file.key}: falta ETag`);
    for (const [range, offset, length] of [["bytes=0-1", 0, 2], ["bytes=-32", expected.bytes - 32, 32]]) {
      const part = await request(file.key, { headers: { ...headers, Range: range } });
      if (part.status !== 206 || Number(part.headers.get("content-length")) !== length) {
        await part.body?.cancel();
        throw new Error(`${file.key}: el servidor no sirve rangos correctamente`);
      }
      assert.equal(part.headers.get("content-range"), `bytes ${offset}-${offset + length - 1}/${expected.bytes}`);
      assert.equal((await part.arrayBuffer()).byteLength, length);
    }
    console.log(`VERIFICADO ${file.key}`);
  }
}

export function migrationPlan(html, sw, origin) {
  let updated = html;
  for (const file of mediaFiles) {
    const source = `${previousOrigin}/${file.key}`;
    assert.equal(updated.split(source).length - 1, 1, `Se esperaba una URL de ${file.key}; revisa el HTML antes de migrar.`);
    updated = updated.replace(source, `${origin}/${file.key}`);
  }
  assert(!updated.includes(previousOrigin), "Quedan URLs antiguas sin revisar.");
  const match = /const CACHE_NAME = "djsalva-pwa-v(\d+)";/.exec(sw);
  assert(match, "No se reconoce la version del service worker.");
  const version = Number(match[1]);
  assert(updated.includes(`/sw.js?v=${version}`) && updated.includes(`djsalva-pwa-v${version}`), "Versiones PWA no coinciden.");
  updated = updated.replaceAll(`/sw.js?v=${version}`, `/sw.js?v=${version + 1}`)
    .replaceAll(`djsalva-pwa-v${version}`, `djsalva-pwa-v${version + 1}`);
  return { html: updated, sw: sw.replace(`djsalva-pwa-v${version}`, `djsalva-pwa-v${version + 1}`) };
}

async function main() {
  const origin = validateOrigin(process.argv[2]);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const htmlPath = resolve(root, "index.html");
  const swPath = resolve(root, "sw.js");
  const inventory = JSON.parse(await readFile(new URL("../media-inventory.json", import.meta.url), "utf8"));
  const html = await readFile(htmlPath, "utf8");
  const sw = await readFile(swPath, "utf8");
  const plan = migrationPlan(html, sw, origin);
  await verifyMedia(origin, inventory);
  if (!process.argv.includes("--activate")) {
    console.log("Verificacion completada. No se ha cambiado la web. Usa --activate para sustituir las URLs locales.");
    return;
  }
  assert.equal(await readFile(htmlPath, "utf8"), html, "El HTML cambio durante la verificacion.");
  assert.equal(await readFile(swPath, "utf8"), sw, "El service worker cambio durante la verificacion.");
  await writeFile(htmlPath, plan.html);
  await writeFile(swPath, plan.sw);
  console.log("Enlaces locales y version PWA actualizados. Falta probar la reproduccion en navegador y publicar en Vercel.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
