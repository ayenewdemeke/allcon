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

Record on every element its lod and its basis: "dimensioned" (read from dimensions, schedules or details), "scaled" (measured off the drawing) or "assumed". Scaled or assumed geometry is at most LOD 200, whatever the target.`;

const ORGANIZATION = `Organize the model so it reads well in any IFC viewer:
- Levels (storeys) are floors people stand on. Ceilings, soffits and bulkheads belong to the floor below them, placed at their height. A one-storey building has one level, plus a Roof level only for the roof build-up and what stands on it.
- Use the most specific kind of element: finishes as coverings (flooring, wall finish, ceiling), roof build-up layers as roof or covering elements, storefront framing as mullions and panels, furniture as furniture. A generic element only when nothing fits.
- Names people recognize: an element's name says what it is ("Exterior wall W1", "Door 101"), with the mark from the drawings; rooms have their number and their name.`;

const ORGANIZATION_IFC = `${ORGANIZATION}
- In IFC: put each element in exactly one storey (spatial.assign_container) and each room in its storey (aggregate.assign_object). A room's Name is its number and its LongName the room name.
- Group the parts of an assembly under it, and put only the assembly in the storey: roof deck, insulation and membrane under an IfcRoof; storefront and curtain wall mullions (IfcMember) and panels (IfcPlate) under an IfcCurtainWall; flights, landings and railings under an IfcStair (aggregate.assign_object).
- Classes and predefined types: IfcCovering FLOORING / CLADDING / CEILING / INSULATION / MEMBRANE for finishes and layers, IfcSlab ROOF for a roof deck, IfcDoor TRAPDOOR for a roof hatch, IfcStair LADDER for a fixed ladder, IfcFurniture rather than IfcFurnishingElement, and IfcBuildingElementProxy only when nothing fits.
- Repeated items of the same mark (doors, windows, wall types) share a type (IfcDoorType, IfcWindowType, IfcWallType) where practical.
- Record LOD and basis in each element's Pset_Conkit property set (pset.add_pset, then pset.edit_pset with {"LOD": "300", "Basis": "dimensioned"}), with its Mark, SourceSheet and any assumption as Notes.`;

const DESCRIPTION = `Write the model's description for a person opening it: a first sentence on what it is and which sheets it comes from, then short sentences on the target LOD, what's included and excluded, the coordinate origin, and the main assumptions. Keep it current: when later changes add or remove things, update it (the description argument) in the same call.`;

export function buildModelPrompt(args: { drawings: string; discipline?: string; lod?: string; focus?: string }) {
  const lod = parseLod(args.lod);
  return `Build a 3D model in ${APP_NAME} from these drawings: ${args.drawings}. Discipline: ${args.discipline || "whatever the drawings show"}.${args.focus ? ` Model only: ${args.focus}.` : ""}

1. Find the project and sheets (list_projects, list_sheets). Read the index or cover sheet first to see what the set contains. Then read the sheets you need with read_sheet. Read text first (include_image false) and ask for the image where the layout matters.
   - Structural: foundation and framing plans, general notes, elevations or profiles, sections and details, schedules.
   - Architectural: floor plans, building sections and elevations, wall types, door and window schedules, the room finish schedule, reflected ceiling plans, roof plan and details.

2. ${LOD_CHECK(lod)}

3. Set up:
   - Units as on the drawings (ft for US imperial sets, mm or m for metric).
   - Coordinates: x along the main axis or east, y across or north, z up. Put the origin at a clear reference (grid A/1, begin bridge, station 0+00) and convert stations, grids and offsets to x and y. Use real elevations for z when they're given.
   - Levels from the floor elevations in sections or elevations.
   - Materials from the general notes, wall types and schedules (e.g. Class D concrete, A709 Grade 50 steel, CMU, gypsum partitions).
   - Set the model's lod to ${lod}.

4. ${ORGANIZATION}

5. What to model, to the level of LOD ${lod} above:
   - Structural: footings, piles, piers or columns, caps, girders or beams, deck or slabs, walls, abutments, wingwalls, barriers or railings, bearings; at LOD 350 also diaphragms, cross frames, stiffeners, connections and drains where detailed.
   - Architectural: exterior and interior walls (anchor bottom, on the floor level), floor slabs, roofs, columns, stairs, curtain walls (panels and mullions), ceilings at their heights, doors and windows as openings in their host walls (sizes and sill heights from the schedules), and every room as a space with its name and number. At LOD 100 only the outer walls, floors and roof as masses; at LOD 350 also wall and roof layers, finishes, furniture and casework shown on the drawings.

6. One element per physical piece, with a meaningful id, its mark, the sheet it came from, its lod and basis. Where something isn't given, make a reasonable, consistent assumption, write it in notes and mark the basis "assumed". Split curved members into segments about 3 m / 10 ft long.

7. Create the model with create_3d_model. For a large building or structure, create one level or part first, then add the rest with update_3d_model. ${DESCRIPTION}

8. Check the summary returned: extents against the overall dimensions on the drawings, room areas against any area schedule, volumes against any quantities table, and every warning (LOD, levels, openings that don't fit). Fix them with update_3d_model.

9. Finish with what you modelled, the LOD reached by kind of element and why any fall short, the assumptions, what you left out, how areas or volumes compare with the drawings, and the link to view the model.

Don't invent key dimensions silently: if one can't be read or reasonably inferred, ask me.`;
}

export function detailedModelPrompt(args: { task: string; model?: string; lod?: string }) {
  const lod = parseLod(args.lod);
  const start = args.model
    ? "Find the model (list_3d_models) and read its summary (get_3d_model): note its target LOD and warnings. If it's in conkit's format, convert it with convert_to_detailed."
    : `Find the project and read the drawings you need (read_sheet). Then create the model with create_detailed_model (lod "${lod}", one storey per floor) and keep the handles it returns (body context, storeys).`;
  return `In ${APP_NAME}, ${args.model ? `refine the 3D model ${args.model}` : "build a detailed IFC model"}: ${args.task}

1. ${start}

2. ${LOD_CHECK(lod)}

3. ${ORGANIZATION_IFC}

4. Use ifc_query to see what's there and get ids, and ifc_help to check an operation's arguments before using it for the first time.

5. Make changes with ifc_edit in batches of related operations (one element or one kind of change per batch), naming results with "as" and referring to them with "$name". Geometry goes in the Body context; place elements with geometry.edit_object_placement (conkit.matrix builds the matrix). For openings: an IfcOpeningElement with geometry and placement, feature.add_feature to cut it, feature.add_filling for its door or window.

6. Units are the model's units. Use the drawings' dimensions; note assumptions in Pset_Conkit Notes.

7. After each batch, check the summary returned, including its warnings (organization and LOD), and fix what they point out. If an operation fails, the whole batch is rejected and the error says which one and why: fix it and resend.

8. ${DESCRIPTION}

9. Finish with what you changed, the LOD reached, any assumptions, and the link to view the model.`;
}
