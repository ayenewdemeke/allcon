import type { NextConfig } from "next";

// Routes that read or render PDFs on the server (connector tools, "Fix sheet numbers") load
// pdf.js and its native canvas from node_modules at runtime. pdf.js loads its worker, fonts and
// canvas dynamically, so file tracing misses them; list them for those routes explicitly.
const SERVER_PDF_FILES = [
  "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "./node_modules/pdfjs-dist/standard_fonts/**",
  "./node_modules/@napi-rs/canvas/**",
  "./node_modules/@napi-rs/canvas-linux-*/**", // the binary Vercel installs
];

const nextConfig: NextConfig = {
  // Keep the dev badge clear of the sidebar's user menu (bottom-left).
  devIndicators: { position: "bottom-right" },
  // highs loads its wasm from beside its own script, so it's required from node_modules as is.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "highs"],
  outputFileTracingIncludes: {
    "/api/mcp": SERVER_PDF_FILES,
    "/projects/\\[projectId\\]/sheets": SERVER_PDF_FILES,
  },
};

export default nextConfig;
