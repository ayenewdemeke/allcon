"use client";

import { createContext, useContext, useEffect } from "react";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
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

export type ElevationLookup = (places: { lat: number; lng: number }[]) => Promise<(number | null)[]>;

/** Hands Google's elevation lookup (ground height above sea level) to `onReady` once loaded. */
export function ElevationLookupLoader({ onReady }: { onReady: (lookup: ElevationLookup) => void }) {
  const elevation = useMapsLibrary("elevation");
  useEffect(() => {
    if (!elevation) return;
    const service = new elevation.ElevationService();
    onReady(async (places) => {
      const { results } = await service.getElevationForLocations({ locations: places });
      return places.map((_, i) => results[i]?.elevation ?? null);
    });
  }, [elevation, onReady]);
  return null;
}
