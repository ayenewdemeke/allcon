// Copies the files the 3D viewer loads at run time into public/: web-ifc's wasm (reads IFC),
// the fragments worker (draws the model off the main thread) and the Draco decoder (unpacks
// Google's 3D map tiles). Runs after npm install.
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const copies = [
  ["node_modules/web-ifc/web-ifc.wasm", "public/wasm/web-ifc.wasm"],
  ["node_modules/web-ifc/web-ifc-mt.wasm", "public/wasm/web-ifc-mt.wasm"],
  ["node_modules/@thatopen/fragments/dist/Worker/worker.mjs", "public/fragments/worker.mjs"],
  ["node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js", "public/draco/draco_decoder.js"],
  ["node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm", "public/draco/draco_decoder.wasm"],
  ["node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js", "public/draco/draco_wasm_wrapper.js"],
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
