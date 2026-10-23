import { z } from "zod";

// Where a 3D model sits on the map. A model placed by hand keeps that placement; otherwise its
// own georeferencing places it, else the project's pin (facing north).

/** The model's origin on Earth, which way its Y axis (project north) points, and how far above the ground it sits. */
export type Placement = {
  lat: number;
  lon: number;
  /** Degrees clockwise from true north to the model's Y axis. */
  heading: number;
  /** Metres above the ground at the origin (the model's level 0 sits on the ground at 0). */
  elevation: number;
  source: PlacementSource;
};
export type PlacementSource = "manual" | "ifc" | "project";

/** Georeferencing read from the IFC by the engine (api/ifc.py georef). */
export type Georef = { lat: number; lon: number; heading: number; height: number; crs: string | null; source: "map" | "site" };

export const placementInput = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  heading: z.number().transform((h) => ((h % 360) + 360) % 360),
  elevation: z.number().min(-1000).max(10000),
});

export const PLACEMENT_SOURCE: Record<PlacementSource, string> = {
  manual: "by hand",
  ifc: "from the model's georeferencing",
  project: "at the project's pin",
};

export function readGeoref(summary: unknown): Georef | null {
  const g = (summary as { georef?: Georef | null } | null)?.georef;
  return g && Number.isFinite(g.lat) && Number.isFinite(g.lon) ? g : null;
}

/** Whether the engine has looked for georeferencing in the model's current summary (older summaries didn't). */
export const georefChecked = (summary: unknown) => !!summary && typeof summary === "object" && "georef" in summary;

export function modelPlacement(
  model: { placement: unknown; summary: unknown },
  project: { latitude: number | null; longitude: number | null },
): Placement | null {
  const manual = placementInput.safeParse(model.placement);
  if (manual.success) return { ...manual.data, source: "manual" };
  const georef = readGeoref(model.summary);
  if (georef) return { lat: georef.lat, lon: georef.lon, heading: georef.heading, elevation: 0, source: "ifc" };
  if (project.latitude !== null && project.longitude !== null) return { lat: project.latitude, lon: project.longitude, heading: 0, elevation: 0, source: "project" };
  return null;
}
