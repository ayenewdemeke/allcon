import { z } from "zod";

// Where a 3D model sits on the map. A model placed by hand keeps that placement; otherwise its
// own georeferencing places it, else the project's pin (facing north).

/** A point on the model, where it is on Earth, which way its Y axis (project north) points, and how far above the ground it sits. */
export type Placement = {
  lat: number;
  lon: number;
  /** Degrees clockwise from true north to the model's Y axis. */
  heading: number;
  /** Metres raised above where it would otherwise sit: on the ground, or at its own height. */
  elevation: number;
  /**
   * The point placed at lat/lon, in the model's own coordinates (metres): its origin [0, 0, 0],
   * or for a model in survey coordinates its base point, whose height is its level 0. Null for
   * the middle of the model, as when it's placed at the project's pin.
   */
  anchor: Anchor | null;
  /** Level 0's height above sea level in metres, when the model gives it (survey coordinates); otherwise it sits on the ground. */
  height: number | null;
  source: PlacementSource;
};
export type Anchor = [number, number, number];
export type PlacementSource = "manual" | "ifc" | "project";

/** Georeferencing read from the IFC by the engine (api/ifc.py georef). */
export type Georef = { lat: number; lon: number; heading: number; height: number; crs: string | null; source: "map" | "site"; anchor: Anchor };

export const placementInput = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  heading: z.number().transform((h) => ((h % 360) + 360) % 360),
  elevation: z.number().min(-1000).max(10000),
  anchor: z.tuple([z.number(), z.number(), z.number()]).nullable().default(null),
  height: z.number().min(-1000).max(10000).nullable().default(null),
});

export const PLACEMENT_SOURCE: Record<PlacementSource, string> = {
  manual: "by hand",
  ifc: "from the model's georeferencing",
  project: "at the project's pin",
};

/** The place in Google Maps (its own site, in a new tab): the location only. */
export const googleMapsUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;

export function readGeoref(summary: unknown): Georef | null {
  const g = (summary as { georef?: Georef | null } | null)?.georef;
  return g && Number.isFinite(g.lat) && Number.isFinite(g.lon) ? g : null;
}

/**
 * Whether the model's current summary has its georeferencing as read now: older summaries
 * didn't look for it, or read it at the model's origin without saying where (wrong for models
 * in survey coordinates).
 */
export function georefChecked(summary: unknown) {
  if (!summary || typeof summary !== "object" || !("georef" in summary)) return false;
  const g = (summary as { georef: Partial<Georef> | null }).georef;
  return g === null || Array.isArray(g.anchor);
}

export function modelPlacement(
  model: { placement: unknown; summary: unknown },
  project: { latitude: number | null; longitude: number | null },
): Placement | null {
  const manual = placementInput.safeParse(model.placement);
  if (manual.success) return { ...manual.data, source: "manual" };
  const georef = readGeoref(model.summary);
  // A height of 0 is a model without real heights (or at sea level): it sits on the ground.
  if (georef)
    return { lat: georef.lat, lon: georef.lon, heading: georef.heading, elevation: 0, anchor: georef.anchor ?? [0, 0, 0], height: georef.height || null, source: "ifc" };
  if (project.latitude !== null && project.longitude !== null)
    return { lat: project.latitude, lon: project.longitude, heading: 0, elevation: 0, anchor: null, height: null, source: "project" };
  return null;
}
