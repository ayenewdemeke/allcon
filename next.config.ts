import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev badge clear of the sidebar's user menu (bottom-left).
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
