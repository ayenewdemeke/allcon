import { APP_NAME } from "@/lib/app-config";
import { LOD_LEVELS, lodGuide, type Lod } from "@/lib/ifc/lod";

// The skills (MCP prompts) for building 3D models from drawings: the procedure, the level of
// development to reach and how to check the drawings support it, and how to organize the
// model so it reads well in any IFC viewer.

export const DEFAULT_LOD: Lod = "300";

/** "LOD 300", "300", "lod300" → "300"; anything else → the default. */
export function parseLod(value: string | undefined): Lod {
  const digits = value?.match(/\d{3}/)?.[0];
  return (LOD_LEVELS as readonly string[]).includes(digits ?? "") ? (digits as Lod) : DEFAULT_LOD;
}

const LOD_CHECK = (lod: Lod) => `Level of development: the target is LOD ${lod}.
${lodGuide(lod)}

Before modelling, check the drawings support it. For each kind of element in scope, compare what LOD ${lod} needs with what the drawings give, and show me a short table: kind of element | what LOD ${lod} needs | what the drawings give | LOD it can reach. Where something is missing (no schedule, no sections, sizes only scalable off a scanned sheet), say what you'd do instead: model it at a lower LOD with basis "scaled" or "assumed", or leave it out. Then stop, ask me whether to proceed, and wait for my answer. Go straight on only if nothing is missing.

Record on every element its LOD and its basis: "dimensioned" (read from dimensions, schedules or details), "scaled" (measured off the drawing) or "assumed". Scaled or assumed geometry is at most LOD 200, whatever the target.`;

const ORGANIZATION = `Organize the model so it reads well in any IFC viewer:
- Storeys are floors people stand on. Ceilings, soffits and bulkheads belong to the floor below them, placed at their height. A one-storey building has one storey, plus a Roof storey only for the roof build-up and what stands on it.
- Put each element in exactly one storey (spatial.assign_container) and each room in its storey (aggregate.assign_object). A room's Name is its number and its LongName the room name.
- Group the parts of an assembly under it, and put only the assembly in the storey: roof deck, insulation and membrane under an IfcRoof; storefront and curtain wall mullions (IfcMember) and panels (IfcPlate) under an IfcCurtainWall; flights, landings and railings under an IfcStair (aggregate.assign_object).
- Use the most specific class and predefined type: IfcCovering FLOORING / CLADDING / CEILING / INSULATION / MEMBRANE for finishes and layers, IfcSlab ROOF for a roof deck, IfcDoor TRAPDOOR for a roof hatch, IfcStair LADDER for a fixed ladder, IfcFurniture rather than IfcFurnishingElement, and IfcBuildingElementProxy only when nothing fits.
- Names people recognize: start with what it is, then its mark or size ("Exterior wall W1", "Door 101", "Roof insulation 3 in"), not a number or code first.
- Repeated items of the same mark (doors, windows, wall types) share a type (IfcDoorType, IfcWindowType, IfcWallType) where practical.
- Give every element a material (material.add_material, material.assign_material), and record in its Pset_Conkit property set (pset.add_pset, then pset.edit_pset) its LOD and Basis, its Mark, the SourceSheet it came from, and any assumption as Notes.`;

const DESCRIPTION = `Write the model's description for a person opening it: a first sentence on what it is and which sheets it comes from, then short sentences on the target LOD, what's included and excluded, the coordinate origin, and the main assumptions. Keep it current: when later changes add or remove things, update it (the description argument) in the same call.`;

const ENGINE = `How to build with ${APP_NAME}'s tools:
- Make changes with ifc_edit in batches of related operations (one element or one kind of change per batch), naming results with "as" and referring to them with "$name". Use ifc_help to check an operation's arguments before using it for the first time, and ifc_query to see what's there and get ids.
- Geometry goes in the Body context (from create_3d_model's handles). Place elements with geometry.edit_object_placement (conkit.matrix builds the matrix). Walls: geometry.add_wall_representation; slabs and roofs: geometry.add_slab_representation; beams, columns and members: geometry.add_profile_representation with a profile from profile.add_parameterized_profile.
- Openings: an IfcOpeningElement with geometry and placement, feature.add_feature to cut it from its host, then feature.add_filling for its door or window.
- Units are the model's units. If an operation fails, the whole batch is rejected and the error says which one and why: fix it and resend.
- After each batch, read the summary returned, including its warnings (organization and LOD), and fix what they point out.`;

export function buildModelPrompt(args: { drawings: string; discipline?: string; lod?: string; focus?: string }) {
  const lod = parseLod(args.lod);
  return `Build a 3D model (IFC) in ${APP_NAME} from these drawings: ${args.drawings}. Discipline: ${args.discipline || "whatever the drawings show"}.${args.focus ? ` Model only: ${args.focus}.` : ""}

1. Find the project and sheets (list_projects, list_sheets). Read the index or cover sheet first to see what the set contains. Then read the sheets you need with read_sheet. Read text first (include_image false) and ask for the image where the layout matters.
   - Structural: foundation and framing plans, general notes, elevations or profiles, sections and details, schedules.
   - Architectural: floor plans, building sections and elevations, wall types, door and window schedules, the room finish schedule, reflected ceiling plans, roof plan and details.

2. ${LOD_CHECK(lod)}

3. Set up: units as on the drawings (ft for US imperial sets, mm or m for metric); coordinates with x along the main axis or east, y across or north, z up, and the origin at a clear reference (grid A/1, begin bridge, station 0+00), using real elevations where given; storeys from the floor elevations; materials from the general notes, wall types and schedules. Then start the model with create_3d_model (lod "${lod}", the storeys, a description) and keep the handles it returns.

4. ${ORGANIZATION}

5. What to model, to the level of LOD ${lod} above:
   - Structural: footings, piles, piers or columns, caps, girders or beams, deck or slabs, walls, abutments, wingwalls, barriers or railings, bearings; at LOD 350 also diaphragms, cross frames, stiffeners, connections and drains where detailed.
   - Architectural: exterior and interior walls, floor slabs, roofs, columns, stairs, curtain walls, ceilings at their heights, doors and windows in openings in their host walls (sizes and sill heights from the schedules), and every room as a space with its number and name. At LOD 100 only the outer walls, floors and roof as masses; at LOD 350 also wall and roof layers, finishes, furniture and casework shown on the drawings.
   One element per physical piece. Where something isn't given, make a reasonable, consistent assumption, note it, and mark the basis "assumed".

6. ${ENGINE}

7. ${DESCRIPTION}

8. Check the result against the drawings: overall dimensions, room areas against any area schedule, counts of doors and windows against the schedules. Fix differences.

9. Finish with what you modelled, the LOD reached by kind of element and why any fall short, the assumptions, what you left out, and the link to view the model.

Don't invent key dimensions silently: if one can't be read or reasonably inferred, ask me.`;
}

export function editModelPrompt(args: { task: string; model: string; lod?: string }) {
  const lod = args.lod ? parseLod(args.lod) : null;
  return `In ${APP_NAME}, change the 3D model ${args.model}: ${args.task}

1. Find the model (list_3d_models) and read its summary (get_3d_model): note its target LOD, storeys and warnings. Read the drawings you need (read_sheet).

2. ${lod ? LOD_CHECK(lod) : "Keep to the model's target LOD, and record the LOD and basis of anything you add."}

3. ${ORGANIZATION}

4. ${ENGINE}

5. ${DESCRIPTION}

6. Finish with what you changed, any assumptions, and the link to view the model.`;
}
