import { DesignError } from "../walls/cip";
import { bar, positive } from "./aashto";

// Bar detailing for caps and abutments, AASHTO LRFD 10th Edition: cover (Table 5.10.1-1 subset),
// clear spacing and layers (5.10.3.1), and standard hooks (5.10.2.1, corrected Table 5.10.2.3-1).

export type Exposure = "salt_water" | "cast_against_earth" | "coastal" | "deicing_salts" | "other_severe_moderate" | "limited";
export type BarCategory = "A" | "B" | "C"; // A uncoated, B epoxy or galvanized, C AASHTO M 334

export const EXPOSURES: { value: Exposure; label: string }[] = [
  { value: "salt_water", label: "Direct exposure to salt water" },
  { value: "cast_against_earth", label: "Cast against earth" },
  { value: "coastal", label: "Coastal" },
  { value: "deicing_salts", label: "Exposure to deicing salts" },
  { value: "other_severe_moderate", label: "Other severe to moderate exposure" },
  { value: "limited", label: "Limited exposure" },
];

/** Minimum cover to main bars (or stirrups, 0.5 in less), Table 5.10.1-1 with the w/cm factor. */
export function minimumCover(exposure: Exposure, category: BarCategory, wcm: number, barSize: number, role: "main" | "stirrup" = "main", ownerMin = 0) {
  positive({ "w/cm": wcm });
  bar(barSize);
  const rows: Record<Exposure, [number, number, number]> = {
    salt_water: [4, 2.5, 2.5],
    cast_against_earth: [3, 2, 2],
    coastal: [3, 2, 2],
    deicing_salts: [2.5, 2, 1.5],
    other_severe_moderate: [2, 2, 1.5],
    limited: barSize <= 11 ? [1.5, 1, 1] : [2, 2, 2],
  };
  const row = rows[exposure];
  if (!row || ownerMin < 0) throw new DesignError("Choose an exposure for the cover.");
  const factor = wcm <= 0.4 ? 0.8 : wcm >= 0.5 ? 1.2 : 1;
  const code = Math.max(1, row["ABC".indexOf(category)] * factor - (role === "stirrup" ? 0.5 : 0));
  return { required: Math.max(code, ownerMin), code, factor };
}

/** Equal bars in aligned layers: clear spacing, layer spacing, fit and cover (5.10.3.1.1–3). */
export function barLayout(o: { barSize: number; count: number; layers: number; width: number; depth: number; cover: number; layerClear: number; aggregate: number; requiredCover: number; stirrupSize?: number | null; precast?: boolean }) {
  const { db, area } = bar(o.barSize);
  if (!Number.isInteger(o.count) || !Number.isInteger(o.layers) || o.count < 1 || o.layers < 1) throw new DesignError("Bars per layer and layers must be whole numbers.");
  positive({ "Section width": o.width, "Section depth": o.depth, Cover: o.cover, "Layer clear space": o.layerClear, "Aggregate size": o.aggregate });
  const stirrup = o.stirrupSize ? bar(o.stirrupSize).db : 0;
  const minimum = o.precast ? Math.max(db, 1.33 * o.aggregate, 1) : Math.max(1.5 * db, 1.5 * o.aggregate, 1.5);
  const available = o.width - 2 * (o.cover + stirrup);
  const clear = o.count > 1 ? (available - o.count * db) / (o.count - 1) : null;
  const height = o.layers * db + (o.layers - 1) * o.layerClear;
  const widthOk = available >= o.count * db && (clear === null || clear >= minimum - 1e-9);
  const depthOk = height <= o.depth - 2 * (o.cover + stirrup) + 1e-9;
  const layersOk = o.layers === 1 || o.layerClear >= Math.max(1, db) - 1e-9;
  const coverOk = o.cover >= o.requiredCover;
  return {
    db,
    area: o.count * o.layers * area,
    clear,
    minimumClear: minimum,
    centroidFromFace: o.cover + stirrup + db / 2 + ((o.layers - 1) * (db + o.layerClear)) / 2,
    mainClearCover: o.cover + stirrup,
    widthOk,
    depthOk,
    layersOk,
    coverOk,
    ok: widthOk && depthOk && layersOk && coverOk,
  };
}

/** A standard hook's least inside bend diameter and tail (5.10.2.1, corrected Table 5.10.2.3-1). */
export function hookDimensions(barSize: number, angle: 90 | 135 | 180, coating: "uncoated" | "epoxy" | "galvanized" | "dual" = "uncoated", role: "longitudinal" | "transverse" = "longitudinal", fy = 60) {
  const { db } = bar(barSize);
  if (fy > 75 || (barSize > 14 && fy >= 75)) throw new DesignError("Hooks are implemented for fy up to 75 ksi.");
  let tail: number;
  let multiple: number;
  if (role === "longitudinal") {
    if (angle === 90) tail = 12 * db;
    else if (angle === 180) tail = Math.max(4 * db, 2.5);
    else throw new DesignError("Hooks on main bars are 90° or 180°.");
    multiple = barSize <= 8 ? 6 : barSize <= 11 ? 8 : 10;
  } else if (barSize <= 8) {
    if (angle === 90) tail = (barSize <= 5 ? 6 : 12) * db;
    else if (angle === 135) tail = 6 * db;
    else throw new DesignError("Stirrup hooks are 90° or 135°.");
    multiple = barSize <= 5 ? 4 : 6;
  } else throw new DesignError("Stirrup hooks are for #8 bars and smaller.");
  if (coating === "galvanized") multiple = barSize <= 6 ? 6 : barSize <= 11 ? 8 : 10;
  const inside = multiple * db;
  return { inside, radius: (inside + db) / 2, outside: inside + 2 * db, tail, angle };
}
