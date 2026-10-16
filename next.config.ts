import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev badge clear of the sidebar's user menu (bottom-left).
  devIndicators: { position: "bottom-right" },
  // The connector reads and renders sheets on the server with pdf.js on a native canvas;
  // both load from node_modules at runtime rather than being bundled.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/mcp": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "./node_modules/pdfjs-dist/standard_fonts/**"],
  },
};

export default nextConfig;
