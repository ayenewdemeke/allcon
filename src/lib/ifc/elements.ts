import { ifcGuid } from "./compile";
import { openingPlacement, polygonArea, profileArea, profileSize, segments } from "./geometry";
import { METERS_PER_UNIT, type ModelElement, type ModelSpec } from "./spec";

// The elements of a model in conkit's format, as mapping reads them: the same shape as an
// uploaded model's elements (Revit-style category, a type, a level, quantities in SI), so
// rules, suggestions and the report treat both alike. GlobalIds match the compiled IFC, so
// an element keeps its identity (and its mappings) from one revision to the next.

export type ModelElementRow = {
  stableId: string;
  category: string;
  typeName: string;
  level: string | null;
  quantities: { volume?: number; area?: number; length?: number; perimeter?: number };
  properties: Record<string, string>;
};

/** Categories named as in Revit, so the mapping suggestions' classification tables apply. */
const CATEGORY: Record<ModelElement["type"], string> = {
  wall: "Walls",
  slab: "Floors",
  deck: "Structural Deck",
  beam: "Structural Framing",
  girder: "Structural Framing",
  column: "Structural Columns",
  pier: "Piers",
  footing: "Structural Foundations",
  pile_cap: "Structural Foundations",
  pile: "Structural Foundations",
  plate: "Plates",
  member: "Structural Framing",
  brace: "Structural Framing",
  railing: "Railings",
  barrier: "Barriers",
  stair: "Stairs",
  bearing: "Bearings",
  abutment: "Abutments",
  wingwall: "Walls",
  roof: "Roofs",
  ceiling: "Ceilings",
  covering: "Coverings",
  curtain_panel: "Curtain Panels",
  mullion: "Curtain Wall Mullions",
  furniture: "Furniture",
  other: "Generic Models",
};

/** Members measured by their face (height × length) rather than their plan. */
const FACE_MEASURED = new Set<ModelElement["type"]>(["wall", "wingwall", "barrier", "abutment", "curtain_panel"]);
/** Thin horizontal members measured by their top (width × length): roofs and finishes swept along an edge. */
const SURFACE_MEASURED = new Set<ModelElement["type"]>(["roof", "ceiling", "covering", "plate", "slab", "deck"]);

/** A size in the model's units, the way the drawings write it. */
function size(value: number, units: ModelSpec["units"]): string {
  const r = (n: number, d = 2) => Number(n.toFixed(d)).toString();
  if (units === "ft") return value < 3 ? `${r(value * 12, 1)}″` : `${r(value)}′`;
  if (units === "in") return `${r(value, 1)}″`;
  if (units === "m") return value < 3 ? `${r(value * 1000, 0)} mm` : `${r(value)} m`;
  return `${r(value, 0)} mm`;
}

const isVertical = (e: ModelElement) => {
  const first = segments(e)[0];
  return !!first && Math.abs(first.end[2] - first.start[2]) > 0.999 * first.length;
};

/** "CMU · 8″ thick", "Concrete C30 · 12″ × 24″", "Steel · I 14″ × 6.7″". */
function typeName(e: ModelElement, spec: ModelSpec, material: string | null): string {
  const p = e.profile;
  const u = spec.units;
  const length = segments(e).reduce((s, g) => s + g.length, 0);
  let shape: string;
  if (isVertical(e) && p.kind === "polygon") shape = `${size(length, u)} thick`; // slabs, footings: their depth
  else if (FACE_MEASURED.has(e.type) && p.kind === "rect") shape = `${size(p.width, u)} thick`;
  else if (p.kind === "rect") shape = `${size(p.width, u)} × ${size(p.depth, u)}`;
  else if (p.kind === "circle") shape = `Ø${size(p.radius * 2, u)}`;
  else if (p.kind === "tube") shape = `Ø${size(p.radius * 2, u)} × ${size(p.wall, u)}`;
  else if (p.kind === "polygon") shape = "custom profile";
  else {
    const { width, depth } = profileSize(p);
    shape = `${p.kind.toUpperCase()} ${size(depth, u)} × ${size(width, u)}`;
  }
  return [material ?? "No material", shape].join(" · ");
}

export function modelElements(modelId: string, spec: ModelSpec): ModelElementRow[] {
  const m = METERS_PER_UNIT[spec.units];
  const levels = new Map(spec.levels.map((l) => [l.id, l.name]));
  const materials = new Map(spec.materials.map((x) => [x.id, x.grade ? `${x.name} ${x.grade}` : x.name]));
  const guid = (part: string) => ifcGuid(`${modelId}:${part}`);
  const rows = new Map<string, ModelElementRow>();

  for (const e of spec.elements) {
    const length = segments(e).reduce((s, g) => s + g.length, 0);
    const material = (e.material && materials.get(e.material)) || null;
    const { width, depth } = profileSize(e.profile);
    const area = isVertical(e)
      ? SURFACE_MEASURED.has(e.type) || e.type === "footing" || e.type === "pile_cap"
        ? profileArea(e.profile) // plan area of a slab or footing
        : undefined
      : FACE_MEASURED.has(e.type)
        ? length * depth
        : SURFACE_MEASURED.has(e.type)
          ? length * width
          : undefined;
    const properties: Record<string, string> = {};
    if (e.mark) properties.Mark = e.mark;
    if (material) properties.Material = material;
    if (e.sheet) properties["Source sheet"] = e.sheet;
    if (e.lod) properties.LOD = e.lod;
    rows.set(e.id, {
      stableId: guid(`el:${e.id}`),
      category: CATEGORY[e.type],
      typeName: typeName(e, spec, material),
      level: (e.level && levels.get(e.level)) || null,
      quantities: {
        volume: profileArea(e.profile) * length * m ** 3,
        length: length * m,
        ...(area !== undefined ? { area: area * m * m } : {}),
      },
      properties,
    });
  }

  // Doors and windows count, with their opening area; every opening is taken out of its wall.
  for (const o of spec.openings) {
    const host = spec.elements.find((e) => e.id === o.host);
    const placement = host && openingPlacement(host, o);
    const hostRow = host && rows.get(host.id);
    if (placement && hostRow) {
      const q = hostRow.quantities;
      q.volume = Math.max(0, (q.volume ?? 0) - o.width * o.height * placement.thickness * m ** 3);
      if (q.area !== undefined) q.area = Math.max(0, q.area - o.width * o.height * m * m);
    }
    if (o.kind === "opening") continue;
    const material = (o.material && materials.get(o.material)) || null;
    rows.set(`fill:${o.id}`, {
      stableId: guid(`fill:${o.id}`),
      category: o.kind === "door" ? "Doors" : "Windows",
      typeName: [material, `${size(o.width, spec.units)} × ${size(o.height, spec.units)}`].filter(Boolean).join(" · "),
      level: (host?.level && levels.get(host.level)) || null,
      quantities: { area: o.width * o.height * m * m },
      properties: { ...(o.mark ? { Mark: o.mark } : {}), ...(o.sheet ? { "Source sheet": o.sheet } : {}) },
    });
  }

  // Rooms: floor area, perimeter and volume, for finishes priced per room.
  for (const sp of spec.spaces) {
    const area = polygonArea(sp.outline);
    const perimeter = sp.outline.reduce((s, p, i) => {
      const q = sp.outline[(i + 1) % sp.outline.length];
      return s + Math.hypot(q[0] - p[0], q[1] - p[1]);
    }, 0);
    rows.set(`sp:${sp.id}`, {
      stableId: guid(`sp:${sp.id}`),
      category: "Rooms",
      typeName: sp.name,
      level: (sp.level && levels.get(sp.level)) || null,
      quantities: { area: area * m * m, perimeter: perimeter * m, volume: area * sp.height * m ** 3 },
      properties: sp.number ? { Number: sp.number } : {},
    });
  }
  return [...rows.values()];
}
