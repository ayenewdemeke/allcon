// Level of development (LOD) for models built from drawings, after the BIMForum LOD levels
// (written in our own words; the specification itself isn't reproduced). LOD says how far an
// element can be relied on, not just how detailed it looks, so each element also records the
// basis of its geometry: an element scaled off a drawing or assumed can't claim more than 200.
// LOD 400 (fabrication) and 500 (field verified) aren't offered: drawings don't carry them.

export const LOD_LEVELS = ["100", "200", "300", "350"] as const;
export type Lod = (typeof LOD_LEVELS)[number];

export const BASES = ["dimensioned", "scaled", "assumed"] as const;
export type Basis = (typeof BASES)[number];

/** The highest LOD an element's geometry can support, by where its dimensions came from. */
export const MAX_LOD_FOR_BASIS: Record<Basis, Lod> = { dimensioned: "350", scaled: "200", assumed: "200" };

export const LOD_MEANING: Record<Lod, string> = {
  "100": "Massing: overall form, footprint, height and location; quantities are rough (area and volume only).",
  "200": "Generic: each element as a generic assembly with approximate size, shape, location and orientation. Sizes may be scaled or assumed.",
  "300": "Specific: each element at its specified size, shape, location and orientation, read from dimensions, schedules or details (not scaled), so quantities can be measured from the model.",
  "350": "Coordinated: LOD 300 plus what's needed to coordinate with neighbouring elements: layers, supports, connections, framing and interfaces shown on the drawings.",
};

/** What each kind of element needs at each level, and where the drawings usually give it. */
export const LOD_NEEDS: { category: string; needs: Record<Lod, string> }[] = [
  {
    category: "Walls",
    needs: {
      "100": "Building outline as a mass",
      "200": "Each wall as one solid of typical thickness and height, on its floor level",
      "300": "Each wall at its wall-type thickness and actual height (wall types, sections), at dimensioned locations; door and window openings at schedule sizes",
      "350": "Wall layers per wall type (structure, insulation, lining, finish), head and base conditions, bracing and lintels shown",
    },
  },
  {
    category: "Floors, slabs and roofs",
    needs: {
      "100": "Floor plates and roof as masses",
      "200": "Slabs and roof as single solids of typical thickness",
      "300": "Actual thickness, edges, slopes, steps and openings (structural plans, sections, roof plan)",
      "350": "Roof and floor build-up layers (deck, insulation, membrane, finish), drains, curbs, edge details",
    },
  },
  {
    category: "Structural frame and foundations",
    needs: {
      "100": "Not modelled separately",
      "200": "Columns, beams, footings as generic sizes on grids",
      "300": "Members at their scheduled sizes and dimensioned locations and elevations (framing and foundation plans, schedules)",
      "350": "Connections, base plates, bracing, bearings and stiffeners where detailed",
    },
  },
  {
    category: "Doors, windows and storefronts",
    needs: {
      "100": "Not modelled",
      "200": "Generic openings with doors and windows of approximate size",
      "300": "Each at its schedule size, sill and head height and location (door and window schedules, elevations)",
      "350": "Frames, mullions and panels as parts; hardware zones and head/sill details",
    },
  },
  {
    category: "Stairs, ramps and railings",
    needs: {
      "100": "Not modelled",
      "200": "Generic stair or ramp mass in its position",
      "300": "Actual risers, treads, landings, widths and railing heights (stair sections and details)",
      "350": "Stringers, supports and railing posts with their connections",
    },
  },
  {
    category: "Ceilings and finishes",
    needs: {
      "100": "Not modelled",
      "200": "Ceiling zones at typical heights",
      "300": "Ceilings at their heights per room (reflected ceiling plan, finish schedule); floor and wall finishes per schedule",
      "350": "Soffits, bulkheads, access panels and finish layers at junctions",
    },
  },
  {
    category: "Rooms",
    needs: {
      "100": "Not modelled",
      "200": "Rooms with name, number and approximate outline",
      "300": "Rooms with name, number, outline to the walls and ceiling height; areas match any area schedule",
      "350": "As 300",
    },
  },
  {
    category: "Furniture, casework and equipment",
    needs: {
      "100": "Not modelled",
      "200": "Generic blocks of approximate size where shown",
      "300": "Items at their sizes and positions as dimensioned or scheduled (enlarged plans, elevations, equipment schedule)",
      "350": "Supports, fixings and service connections where shown",
    },
  },
  {
    category: "MEP fixtures and terminals",
    needs: {
      "100": "Not modelled",
      "200": "Generic fixtures, lights and terminals at approximate positions",
      "300": "Each at its specified type, size and position (MEP plans, fixture schedules)",
      "350": "Connections to their systems and supports",
    },
  },
  {
    category: "Bridge superstructure and substructure",
    needs: {
      "100": "Deck and piers as masses along the alignment",
      "200": "Girders, deck, caps, piers and abutments at typical sizes",
      "300": "Members at their plan sizes, spans, elevations and stations (general plan, framing plan, sections)",
      "350": "Bearings, diaphragms, cross frames, stiffeners and drains where detailed",
    },
  },
];

/** The LOD guide as text for an AI app: what the level means and what each kind of element needs. */
export function lodGuide(level: Lod): string {
  const rows = LOD_NEEDS.map((c) => `- ${c.category}: ${c.needs[level]}`).join("\n");
  return `LOD ${level}: ${LOD_MEANING[level]}\n${rows}`;
}

/** Elements' LODs counted, with what doesn't meet the target or claims more than its basis allows. */
export function lodSummary(target: Lod | null, items: { lod?: string | null; basis?: string | null }[]) {
  const byLevel: Record<string, number> = {};
  let unset = 0;
  let belowTarget = 0;
  let overclaimed = 0;
  for (const item of items) {
    const lod = item.lod && (LOD_LEVELS as readonly string[]).includes(item.lod) ? (item.lod as Lod) : null;
    if (!lod) {
      unset++;
      continue;
    }
    byLevel[lod] = (byLevel[lod] ?? 0) + 1;
    if (target && Number(lod) < Number(target)) belowTarget++;
    const basis = item.basis as Basis | undefined;
    if (basis && MAX_LOD_FOR_BASIS[basis] && Number(lod) > Number(MAX_LOD_FOR_BASIS[basis])) overclaimed++;
  }
  const warnings: string[] = [];
  if (target && unset) warnings.push(`${unset} element${unset === 1 ? " has" : "s have"} no LOD recorded`);
  if (belowTarget) warnings.push(`${belowTarget} element${belowTarget === 1 ? " is" : "s are"} below the target LOD ${target}`);
  if (overclaimed) warnings.push(`${overclaimed} element${overclaimed === 1 ? " claims" : "s claim"} a higher LOD than its basis allows (scaled or assumed geometry is at most LOD 200)`);
  return { target, byLevel, unset, warnings };
}
