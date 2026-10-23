import "server-only";
import { env } from "@/lib/env";

/** What the browser needs for Google Maps: the (referrer-restricted) key and the map style id. */
export type MapsConfig = { apiKey: string; mapId: string };

export function mapsConfig(): MapsConfig | null {
  const { GOOGLE_MAPS_API_KEY, GOOGLE_MAP_ID } = env();
  // Google's demo map id works without setting one up, for trying things out.
  return GOOGLE_MAPS_API_KEY ? { apiKey: GOOGLE_MAPS_API_KEY, mapId: GOOGLE_MAP_ID ?? "DEMO_MAP_ID" } : null;
}
