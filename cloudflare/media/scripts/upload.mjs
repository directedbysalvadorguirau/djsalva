import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mediaFiles } from "../media-files.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = process.argv[2];
const upload = process.argv.includes("--upload");
if (!directory || directory.startsWith("--")) {
  console.error("Uso: node scripts/upload.mjs CARPETA_ORIGINALES [--upload]");
  process.exit(1);
}

const inventory = JSON.parse(await readFile(new URL("../media-inventory.json", import.meta.url), "utf8"));
let total = 0;
// Validate every file before the first remote write. Never upload part 04-3.
for (const file of mediaFiles) {
  const local = resolve(directory, file.filename);
  const info = await stat(local);
  if (!info.isFile() || !info.size) throw new Error(`Archivo vacio o invalido: ${file.filename}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(local)) hash.update(chunk);
  const digest = hash.digest("hex");
  const expected = inventory.find(entry => entry.key === file.key);
  if (!expected || expected.bytes !== info.size || expected.sha256 !== digest) {
    throw new Error(`El original no coincide con el inventario: ${file.filename}`);
  }
  total += info.size;
  console.log(`OK ${file.filename}: ${info.size} bytes, SHA-256 verificado`);
}
console.log(`${mediaFiles.length} archivos; ${(total / 1e9).toFixed(3)} GB. ${upload ? "Iniciando subida." : "Solo comprobacion: no se ha subido nada."}`);

if (upload) {
  const cli = resolve(root, "node_modules/wrangler/bin/wrangler.js");
  for (const file of mediaFiles) {
    const result = spawnSync(process.execPath, [cli, "r2", "object", "put", `djsalva-media/${file.key}`,
      "--file", resolve(directory, file.filename), "--content-type", file.type,
      "--cache-control", "public, max-age=3600, no-transform", "--remote"], {
      cwd: root, stdio: "inherit",
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH || ""}` }
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Subida interrumpida en ${file.filename}. La web no se ha modificado.`);
    }
  }
}
