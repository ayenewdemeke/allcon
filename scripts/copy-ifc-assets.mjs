// Copies the files the 3D viewer loads at run time into public/: web-ifc's wasm (reads IFC)
// and the fragments worker (draws the model off the main thread). Runs after npm install.
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const copies = [
  ["node_modules/web-ifc/web-ifc.wasm", "public/wasm/web-ifc.wasm"],
  ["node_modules/web-ifc/web-ifc-mt.wasm", "public/wasm/web-ifc-mt.wasm"],
  ["node_modules/@thatopen/fragments/dist/Worker/worker.mjs", "public/fragments/worker.mjs"],
];

for (const [from, to] of copies) {
  const src = join(root, from);
  const dest = join(root, to);
  if (!existsSync(src)) {
    console.warn(`copy-ifc-assets: ${from} not found, skipped`);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  chmodSync(dest, 0o644); // web-ifc ships its wasm executable; these are only served
}
