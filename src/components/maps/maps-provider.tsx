"use client";

import { createContext, useContext } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import type { MapsConfig } from "@/lib/maps/config";

// Google Maps for everything under it, with the key and map style the server provides.

const MapsContext = createContext<MapsConfig | null>(null);

export function MapsProvider({ config, children }: { config: MapsConfig; children: React.ReactNode }) {
  return (
    <MapsContext value={config}>
      <APIProvider apiKey={config.apiKey}>{children}</APIProvider>
    </MapsContext>
  );
}

/** The maps config, inside a MapsProvider. */
export function useMapsConfig() {
  const config = useContext(MapsContext);
  if (!config) throw new Error("useMapsConfig needs a MapsProvider");
  return config;
}
