# The Bridge description and load path (ported from allcon-desktop, 2026-11-14)

> In allcon (web) this is the Design kind `bridge`, named **Bridge Description and Load Path**, shown
> with CDOT agency rules on. It is separate from the **Bridge section** (`docs/bridge-module-spec.md`:
> the analysis model, solver, moving loads and workspace), which starts one from its Design tab
> ("Whole bridge: load path and foundations"). The text below is the desktop app's, where it is "the Bridge".


One record that describes a whole girder bridge, entered the way PGSuper's Bridge Description and
Alignment dialogs ask for it, which every design tool reads from and the IFC generator (phase 2) and
reader (phase 3) translate to and from. Phase 1: the record and its editor, the geometry it implies,
the superstructure check run from it, and the loads passed down the load path to the abutments, the
piers and their foundations.

## The record (Design kind `bridge`, Bridges category)

Laid out after PGSuper (9.0, BridgeLink): its project file holds `AlignmentData` (reference station,
northing, easting, direction, horizontal curves), `ProfileData` (station, elevation, grade, vertical
curves), `Crown` (roadway section templates by station: left and right slopes, the ridge point's
offset), and `BridgeDescription` (girder family and type, girder count and spacing and where it's
measured, the bridge line's offset from the alignment, the slab offset, the deck edges, and each pier:
station, orientation, connection, girder end distance and bearing offset).

- **Alignment** (horizontal): a reference station with its northing and easting and the back tangent's
  bearing; horizontal curves by PI station, radius and the front tangent's bearing (circular; spirals
  in a later phase).
- **Profile** (vertical): a station, its elevation and the grade leaving it; vertical curves by PVI
  station, the grade leaving it and the curve's length (symmetric parabolas, AASHTO Green Book).
- **Roadway section** (crown): left and right cross slopes and the crown's offset from the alignment,
  constant along the bridge (superelevation transitions in a later phase).
- **Supports**: abutment, pier, …, abutment, each at a station with its orientation ("normal" or a skew
  angle, + to the right, as PGSuper's "15 L"/"15 R"), its type (integral or seat abutment; pier
  continuous, continuous after deck placement, or simple), the girders' end distance and the bearing
  offset from the support's line.
- **Superstructure**: the girder (the girder check's library), count, spacing (normal to the
  alignment at the abutments), the bridge line's offset from the alignment, deck edges (overhang),
  deck thickness, sacrificial depth, slab offset ("A" dimension) or haunch, the rail, the wearing
  surface, concrete. The girder's own details (strands, stirrups, handling, criteria) stay in a linked
  girder design, which the Bridge sets the layout of.
- **Components**: links to the designs built from it: the girder design, an abutment design at each
  end, and at each pier its cap (strut-and-tie), column and foundation designs.

## What it works out

- **Geometry**: each support's station, coordinates, bearing and skew; each span's length along the
  bridge line, bearing to bearing; the profile grade and elevation along it; the top of deck at each
  girder over each bearing (from the profile and the crown), and the girder's seat elevation below it
  (the slab offset and the girder's depth): the bearing seat elevations table PGSuper reports.
- **Superstructure**: the girder design run with the Bridge's layout: the spans (continuous over the
  piers that are), the largest skew, the spacing, overhang, deck, rail, crown and the profile's
  ordinate over each span (for the haunch), interior and exterior girders, all its checks.
- **Load path**:
  - Each support's reactions per girder: DC (girder, deck and haunch, diaphragms, barrier), DW, and the
    HL-93 lane reaction times the shear distribution factor, without and with IM (a continuous
    bridge's pier reactions from the girder check's continuous beam).
  - Abutments: the abutment design's bridge inputs (unit length to the nearest expansion joint, the
    grade, skew, curvature, girder count, spacing, reactions, braking, the abutment's length along its
    skew).
  - Piers: the cap's loads from the girder designs (the strut-and-tie tool's existing link), the
    column from the cap (existing link), and the foundation's load cases from the column's base forces
    (footing, pile group or drilled shaft).
  - Every push shows what changes and keeps the component's own details (bars, strands, soils).
- **Summary**: each component's verdict and governing check in one table, top to bottom.

## Sources

- PGSuper / BridgeLink 9.0 (WSDOT), its project file's alignment, profile, crown and bridge
  description; its User Guide (Bridge Description, Alignment).
- AASHTO A Policy on Geometric Design (Green Book): vertical curves.
- AASHTO LRFD 10th: 3.6.1 (HL-93, multiple presence), 3.6.2 (IM), 3.6.4 (braking), 4.6.2.2 (distribution
  factors), and the tools' own articles.
- CDOT BDM 11.3 (abutment loads: half the approach slab, IM in the cap but not the foundation).

## Later phases

3. IFC → the Bridge (classify, extract, confirm), then the same design run.
4. Curved girders, rebar and strands in IFC.

## Status (phase 1 built, 2026-11-13)

- `lib/design/bridge/`: `alignment.ts` (stationing through tangents and circular curves, the inverse
  station and offset, the profile with parabolic vertical curves, the crown), `bridge.ts` (the record,
  `bridgeLayout`, `girderInputsFor`, `runBridge` with each support's reactions: simple ends at the
  abutments and simple piers; at a continuous pier the girder and deck simple, DC2 and DW on the
  continuous beam, the lane by its influence lines), `loadpath.ts`, `kinds.ts`; `app/actions/bridge.ts`
  (`syncBridge`: update the linked designs top to bottom, create the missing girder and abutment
  designs); `components/design/bridge-editor.tsx`, `bridge-sketch.tsx` (plan and profile).
- Piers (added 2026-11-13): each pier is described in the Bridge as PGSuper's physical pier model is
  (multicolumn bent or hammerhead; cap length, depth and width; columns, spacing and section; the top of
  the footing or shaft; the foundation's type). The cap is built from the standard pier cap template
  with those dimensions and its bearings where the Bridge's girders sit; the column's height runs from
  the cap's soffit (the lowest bearing seat less the cap's depth) to the foundation's top; "Create the
  missing designs" makes the cap, column and foundation.
- Service loads: the column's link from the cap carries a Service I case (each bearing's DC + DW + the
  most live load reaching it, with IM and the multiple presence factor, unfactored), shown in the
  column's rows but not held to its strength checks, so the footing's settlement and crack control and
  a pile group's deflection now run from the bridge's loads.
- Abutments also drive their approach slab (deck width, roadway between barriers, skew) and a
  wingwall (height at the abutment face, the abutment's width, skew, backfill).
- Not yet: curved girders (girders are chorded between supports, as precast girders are), a calc
  package for the Bridge itself.

## Status (phase 2 built, 2026-11-13): the Bridge → IFC 4.3

"Build the IFC model" in the Bridge editor writes an IFC 4.3 model of the bridge and saves it as a new
3D model in the Bridge's project (the Bridge must be in a project).

- `lib/design/bridge/ifc.ts` (`bridgeIfc`) describes the model: the alignment as its horizontal segments
  (LINE, CIRCULARARC, CLOTHOID, as IfcAlignmentHorizontalSegment takes them) and its PVIs, from 100 ft
  before the first abutment to 100 ft past the last (widened to take in whole spirals and vertical
  curves); the parts (IfcBridge → SUPERSTRUCTURE and SUBSTRUCTURE, an ABUTMENT or PIER part per support);
  and each element as a profile swept from a placement, with its class, predefined type, material and an
  `ALLCON_Design` property set (the design's kind, id, verdict, the CDOT pay item).
- `api/_bridge.py` writes it with IfcOpenShell (action `bridge` of the IFC worker): feet, the site's
  `ALLCON_Origin` (the first abutment's northing and easting: the model's (0, 0)), the alignment segment
  by segment with `create_layout_segment`, the vertical by `layout_vertical_alignment_by_pi_method`, the
  start station as a STATION referent. The description is data: a fixed set of classes, numbers, names.
- Elements: girders (IfcBeam GIRDER_SEGMENT, the girder's outline swept along its 3D chord, seated on its
  bearings); bearings (IfcBearing); the deck (IfcSlab FLOOR, a closed triangulated solid whose top follows
  the alignment, the profile, the crown and the superelevation exactly, the soffit the deck's thickness
  below); integral abutments (pile cap IfcFooting, end diaphragm, H-piles IfcPile DRIVEN or shafts BORED);
  seat abutments (stem, backwall, footing); approach slabs (IfcSlab APPROACH_SLAB); pier caps (IfcBeam
  PIERCAP), columns (IfcColumn), footings, pile caps and piles, or shafts. Sizes come from the linked
  designs, or their defaults when one isn't linked.
- Alignment items added with it: spirals (entry and exit clothoids per curve, PGSuper's spiral lengths;
  `alignment.ts`), superelevation transitions (roadway section templates by station, straight-line
  between them; `sectionAt`), and flared girders (a girder spacing per support, the girder lines straight
  between them; the girder design takes the widest spacing in its group).
- Checked: `ifc.test.ts` and `geometry.test.ts` (spiral T, p, k, Lc and continuity; superelevation;
  flare; the deck's volume; the haunch at every bearing). The written files pass IfcOpenShell's schema
  validation, every element tessellates, and IfcOpenShell's own evaluation of a spiral alignment lies
  within 0.0001 ft of ours.
- Not modelled yet: wingwalls, barriers, diaphragms at piers, rebar and strands, the deck's haunch.

## The Bridge's calc package (built 2026-11-13)

1. A front page with the bridge rendered in 3D (`bridge/render3d.ts`: the IFC description's elements as
   triangles, an axonometric view from above one side, shaded, hidden faces dropped, drawn far to near; an
   SVG), the description, the overall result, references and contents.
2. The bridge's description and layout: alignment, curves and spirals, profile, roadway and superelevation,
   girders, deck and rail; the supports; every girder's span, length and seat elevations; plan and profile.
3. The summary of design checks: a table of every component with its verdict, then every check, grouped
   superstructure and substructure.
4. Part 1, Superstructure: the deck, overhang and rail; the girders of each group; the load path (each
   support's reactions per girder).
5. Part 2, Substructure, support by support in load-path order: the loads it receives, its bearings, its
   abutment (or pier cap and columns), its foundation, its approach slab and wingwalls.
6. Part 3, Quantities: the summary of quantities under CDOT's pay items, a column per part of the bridge
   (Superstructure, each support, Approach Slabs) and the total, then each part's tabulation.

Each component's own calc is included as its tool writes it; the whole package is worked out as one
worksheet (`bridge/calc.test.ts` checks it has no errors and that every component's checks come out as
they do alone). Code: `bridge/calc.ts` (the layout, pure), `bridge/package.ts` (reads the linked designs).

With it, the Bridge now also links a **deck slab** (its girders, spacing, overhang, thickness, flange, rail
and wearing surface from the Bridge) and **bearings** at each support. Under girders cast into a diaphragm
(integral abutments, continuous piers) the pads are leveling pads: the girder, deck and diaphragms until the
diaphragm is cast (DC1), no live load, no movement; each line of bearings carries its own span's end. The
Bridge has a **bridge rail** choice (CDOT B-606 Types 9 and 10 MASH); the IFC model sweeps it along both
deck edges (IfcRailing, the curb-and-post rail's steel tubes too), and every element has a colour.

## Two-stage pier caps (built 2026-11-13)

A pier cap under girders made continuous by a cast-in-place diaphragm is designed in two stages, as CDOT designs them (`stm/strut-tie.ts` `stages`, set by the Bridge at a continuous pier): **construction**, the first-stage cap under the girders, deck, haunch and the wet diaphragm (DC1, Strength I at 1.25 and IV at 1.50, no live load); **completed**, cap and diaphragm as one member (the diaphragm from the cap's top to the deck's top, its top bars the top tie) under every load. Both stages' checks are reported ("Construction: …", "Completed: …"); the calc's model drawing is the completed member.

## Prestressed boxes and the lever rule (built 2026-11-13)

- The 35 x 66 in box (`girders/sections.ts` `box-35x66`): a net-width profile (the void taken out at each   height) that gives the published A, yb and I; both walls are its web for shear. Paid by the square foot of   box, CDOT 618-01992/01994/01995 by depth. - The girder check's `distribution: "lever-rule"`: AASHTO's tables stay the default.

## CDOT rules update (applied 2026-11-13, the owner's "apply all five")

After a review against BDM 2026's wording:

1. **Higher girder strengths** (5.3.1.2): a girder setting, *Higher f′ci or f′c approved by the Unit Leader    with the State Bridge Engineer* (`highStrengthApproved`). Set, the 6.5 / 8.5 ksi checks are shown for    information. 2. **Harp point** (5.5.1.5 "should"): for information. It was already measured on the girder's length. 3. **Integral abutment depth**, deck top to cap bottom (11.3.1 "typically" 13 ft): for information. The    6 ft maximum ("shall") and 3.5 ft minimum cap depths stay checks. 4. **Approach slab distribution**: when the bars are CDOT's B-601 standard detail (#5 at 12 in), the check is    for information; other bars are checked. 5. **Humidity** (5.3.3 "shall"): under CDOT criteria, creep and shrinkage use 55 % whatever is entered    (`criteriaInputs`, used by `designGirder` and the calc).

Also: a *Live load distribution* choice in the girder editor (AASHTO's tables or the lever rule). Tests: `girders/cdot-rules.test.ts`. The three bridges were re-synced and their calcs remade. Remaining failures: 