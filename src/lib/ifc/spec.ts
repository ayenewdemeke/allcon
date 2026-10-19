import { z } from "zod";

// The model format an AI app fills in from drawings, which conkit compiles to IFC. Every
// element is a cross-section profile swept along a path of straight segments, which covers
// walls, slabs, decks, beams, girders (curved ones as short segments), columns, piers,
// footings, piles, plates, railings and the like.

export const UNITS = ["m", "mm", "ft", "in"] as const;
export const METERS_PER_UNIT: Record<(typeof UNITS)[number], number> = { m: 1, mm: 0.001, ft: 0.3048, in: 0.0254 };

export const ELEMENT_TYPES = [
  "wall",
  "slab",
  "deck",
  "beam",
  "girder",
  "column",
  "pier",
  "footing",
  "pile_cap",
  "pile",
  "plate",
  "member",
  "brace",
  "railing",
  "barrier",
  "stair",
  "bearing",
  "abutment",
  "wingwall",
  // architectural
  "roof",
  "ceiling",
  "covering",
  "curtain_panel",
  "mullion",
  "furniture",
  "other",
] as const;

export const MATERIAL_CATEGORIES = ["concrete", "steel", "timber", "masonry", "aluminum", "glass", "earth", "other"] as const;

const len = z.number().positive().max(1e6);
const coord = z.number().finite().min(-1e8).max(1e8);
const point3 = z.tuple([coord, coord, coord]);
const id = z.string().trim().min(1).max(64);

export const profileSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("rect"), width: len, depth: len }),
    z.object({ kind: z.literal("circle"), radius: len }),
    z.object({ kind: z.literal("tube"), radius: len, wall: len }),
    z.object({ kind: z.literal("i"), depth: len, flange_width: len, web_thickness: len, flange_thickness: len }),
    z.object({ kind: z.literal("tee"), depth: len, flange_width: len, web_thickness: len, flange_thickness: len }),
    z.object({ kind: z.literal("angle"), depth: len, width: len, thickness: len }),
    z.object({ kind: z.literal("channel"), depth: len, flange_width: len, web_thickness: len, flange_thickness: len }),
    z.object({
      kind: z.literal("polygon"),
      points: z
        .array(z.tuple([coord, coord]))
        .min(3)
        .max(500)
        .describe("Outline in the profile plane, measured from the path's first point; not closed. For a slab, start the path at x=0, y=0 to give plan coordinates directly"),
    }),
  ])
  .describe(
    "Cross-section. For a vertical path (slabs, footings, columns) the profile lies in plan: x = east, y = north. For a sloping or horizontal path, x is across the member and y is up. width runs along x, depth along y.",
  );

export const elementSchema = z.object({
  id: id.describe("Unique within the model, e.g. G1-span2 or W-A3"),
  type: z.enum(ELEMENT_TYPES),
  name: z.string().max(120).optional(),
  mark: z.string().max(40).optional().describe("Mark or tag from the drawings"),
  level: id.optional().describe("Id of a level in levels"),
  material: id.optional().describe("Id of a material in materials"),
  profile: profileSchema,
  path: z
    .array(point3)
    .min(2)
    .max(1000)
    .describe("Points [x, y, z] the profile is swept along: bottom to top for vertical members (slab: from top of slab down or bottom up)"),
  anchor: z
    .enum(["center", "top", "bottom"])
    .default("center")
    .describe("Where the path runs through a horizontal member's profile: center, top (e.g. a girder hung from the deck line) or bottom (a wall on its base line)"),
  rotation: z
    .number()
    .finite()
    .min(-360)
    .max(360)
    .default(0)
    .describe(
      "Degrees about the path. For a horizontal path the profile's x points to the left of the path direction and y up; a positive rotation tilts x upwards. E.g. a roof plane along an eave running +x that rises towards +y: rotation = +pitch",
    ),
  sheet: z.string().max(40).optional().describe("Sheet the element was read from, e.g. B20"),
  notes: z.string().max(500).optional().describe("Assumptions made for this element"),
});

/** A door, window or plain opening cut into a host wall. */
export const openingSchema = z.object({
  id: id.describe("Unique among openings, e.g. D101 or W-3"),
  kind: z.enum(["door", "window", "opening"]),
  host: id.describe("Id of the wall it's cut into"),
  offset: z.number().min(0).max(1e6).describe("Distance along the wall's path from its start to the opening's near edge"),
  sill: z.number().min(0).max(1e6).default(0).describe("Height of the opening's bottom above the wall's base (0 for doors)"),
  width: len,
  height: len,
  name: z.string().max(120).optional(),
  mark: z.string().max(40).optional().describe("Door or window mark from the schedule"),
  material: id.optional(),
  sheet: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
});

/** A room: its floor outline extruded up to its height. */
export const spaceSchema = z.object({
  id: id.describe("Unique among spaces"),
  name: z.string().max(120).describe("Room name, e.g. Office"),
  number: z.string().max(40).optional().describe("Room number, e.g. 101"),
  level: id.optional(),
  outline: z.array(z.tuple([coord, coord])).min(3).max(500).describe("Floor outline in plan coordinates [x, y]; not closed"),
  base: coord.describe("Floor elevation (z)"),
  height: len.describe("Floor to ceiling"),
  sheet: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
});

const levelsSchema = z
  .array(z.object({ id, name: z.string().max(80), elevation: coord }))
  .max(200)
  .describe("Building storeys; elements reference them by id");
const materialsSchema = z
  .array(z.object({ id, name: z.string().max(80), category: z.enum(MATERIAL_CATEGORIES), grade: z.string().max(80).optional() }))
  .max(200);
const facilitySchema = z.enum(["building", "bridge", "site", "other"]);

export const modelSpecSchema = z.object({
  units: z.enum(UNITS),
  facility: facilitySchema.default("building"),
  levels: levelsSchema.default([]),
  materials: materialsSchema.default([]),
  elements: z.array(elementSchema).max(20_000),
  openings: z.array(openingSchema).max(5000).default([]).describe("Doors, windows and openings, each cut into a host wall"),
  spaces: z.array(spaceSchema).max(5000).default([]).describe("Rooms, with name, number and outline"),
});

export type ModelSpec = z.infer<typeof modelSpecSchema>;
export type ModelElement = z.infer<typeof elementSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ModelOpening = z.infer<typeof openingSchema>;
export type ModelSpace = z.infer<typeof spaceSchema>;

/** Changes to an existing model, so an AI app doesn't resend everything to fix one thing. */
export const modelPatchSchema = z.object({
  upsert_elements: z.array(elementSchema).max(5000).default([]).describe("Added, or replacing the element with the same id"),
  remove_element_ids: z.array(id).max(5000).default([]),
  upsert_openings: z.array(openingSchema).max(5000).default([]),
  remove_opening_ids: z.array(id).max(5000).default([]),
  upsert_spaces: z.array(spaceSchema).max(5000).default([]),
  remove_space_ids: z.array(id).max(5000).default([]),
  // No defaults here: leaving these out keeps the model's own.
  levels: levelsSchema.optional().describe("Replaces all levels when given"),
  materials: materialsSchema.optional().describe("Replaces all materials when given"),
  units: z.enum(UNITS).optional(),
  facility: facilitySchema.optional(),
});
export type ModelPatch = z.infer<typeof modelPatchSchema>;

/** Removes, replaces (same id) and adds items of one collection. */
function merge<T extends { id: string }>(items: T[], upserts: T[], removeIds: string[]) {
  const removed = new Set(removeIds);
  const byId = new Map(upserts.map((e) => [e.id, e]));
  const kept = items.filter((e) => !removed.has(e.id)).map((e) => byId.get(e.id) ?? e);
  const existing = new Set(kept.map((e) => e.id));
  return [...kept, ...upserts.filter((e) => !existing.has(e.id) && !removed.has(e.id))];
}

export function applyPatch(spec: ModelSpec, patch: ModelPatch): ModelSpec {
  return {
    units: patch.units ?? spec.units,
    facility: patch.facility ?? spec.facility,
    levels: patch.levels ?? spec.levels,
    materials: patch.materials ?? spec.materials,
    elements: merge(spec.elements, patch.upsert_elements, patch.remove_element_ids),
    openings: merge(spec.openings, patch.upsert_openings ?? [], patch.remove_opening_ids ?? []),
    spaces: merge(spec.spaces, patch.upsert_spaces ?? [], patch.remove_space_ids ?? []),
  };
}
