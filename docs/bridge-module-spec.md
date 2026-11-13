# Bridge: one model, analysis and design — spec (for review)

A new section, **Bridge**: a bridge is modeled once, analyzed by allcon's own solver, and designed by
the checks allcon already has, with the calcs in Calcs, the quantities in the line items, and the AI
tools over MCP. It follows midas Civil for how a bridge is modeled, loaded and analyzed, and links
to what midas doesn't have. Standard bridges only (see Scope).

## Status (2026-11-13): step 1 built

- `src/lib/bridge/`: `model.ts` (the analysis model, midas's objects), `solver.ts` (the 3D frame
  solver), `definition.ts` (the wizard's inputs), `generate.ts` (the grillage, two stages),
  `bridge.ts` (cases, combinations, member results). Pages under `/bridges`, components in
  `src/components/bridge/` (the editor, the 3D view, the diagrams). Table `bridge`.
- Benchmarks passing (`solver.test.ts`, `bridge.test.ts`): closed-form beams, a portal frame, a
  spring, a bearing link, a grillage (benchmark 1); PGSuper's girder and deck moments at the tenth
  points within 0.5%, and the girders' total for barriers and wearing surface (benchmark 2).
- As built, differing from the text below:
  - the definition is kept in the database (a few kilobytes, as a design's inputs are); the model
    and results are regenerated in the browser and not stored, so there is no file yet (imported
    models, step 4, will be files);
  - the solver runs on the page (milliseconds for these models), not yet in a web worker;
  - a girder over a pier is one node on one bearing line (not two bearing lines); simple spans
    are a hinge in the girder beside the pier;
  - combinations carry permanent loads only until step 2; temperature and wind cases, the calc
    package and steel girders are not in yet.
- Next: step 3, design from the results.

## Status (2026-11-13): the workspace and step 2 (moving load) built

- **Workspace.** A bridge opens full screen (`/bridges/[id]`, `bridge-workspace.tsx`), laid out as
  midas Civil is: a ribbon (Structure, Boundary, Load, Analysis, Results, View), the model's tree,
  the 3D model as the canvas with moment, shear and axial diagrams or the deformed shape drawn on
  it (a click picks a member), the selected item's properties, the tables below (a member's
  diagrams and forces, reactions, checks), and a status bar that carries the "Not verified" note.
- **Moving load** (`moving.ts`): design lanes between the barriers (against either barrier and
  centered), a unit axle moved along each for the influence lines of every girder element, pier
  member and bearing; HL-93 truck or tandem with IM plus the lane load, 90% of two trucks for
  negative moment and pier reactions, multiple presence; envelopes with concurrent forces. Runs in
  slices after the static analysis (about a third of a second a span).
- Combinations now carry live load: Service I, Service III (0.8 LL), Strength I, Strength IV.
- Benchmarks (`moving.test.ts`): the vehicle engine on a beam's influence lines against the girder
  check's HL-93 envelopes (held to PGSuper) within 1% on a simple span and 1.5% on two continuous
  spans with the two-truck pier moment; on the grillage, statics of the influence values and an
  interior girder's share of a lane near Table 4.6.2.2.2b-1's.
- Not yet: the FHWA examples and midas's tutorial as fixtures (benchmarks 3 to 5), the fatigue
  truck and permit vehicles, live-load deflection, temperature and wind.

## Status (2026-11-13): steps 3 and 4 built

- **Design from the model** (`design-links.ts`, the workspace's Design tab): the girders, the deck,
  each line's bearings, each pier's columns and the expansion abutments' joints each start a design
  in the Design section with the bridge's values filled in: geometry and loads for the girder check
  and the deck; the largest bearing reaction (dead and live) and the expansion length for a
  bearing; Strength I cases at the top of the hardest-worked column with their concurrent forces
  for a pier column; the expansion length and skew for a joint. The tab lists each part's design
  with whether its checks pass. Links are kept in the bridge's definition (`designs`).
  - As built, differing from section 8: a design is filled in once, not fed live ("Start again"
    makes a new one); the girder check keeps its own line-girder analysis with distribution
    factors; pier caps (strut-and-tie) and Camber and Haunch aren't linked yet.
- **Calc package** (`report.ts`): the analysis as a Calcs worksheet: the bridge, the model, section
  properties, load cases with equilibrium, the live load's basis, girder moment and shear tables
  (an exterior and an interior girder in each span), bearing reactions, pier column forces.
- **MCP** (`tools/bridges.ts`): `list_bridges`, `get_bridge` (definition and results),
  `create_bridge`, `edit_bridge`.
- **Import** (`mct.ts`): a midas MCT file is read in the browser into the analysis model (units,
  nodes, beams and trusses, materials, sections by value or user dimensions, supports, springs,
  elastic links, end releases, load cases, nodal and beam loads, self-weight), with a report of
  what was read, what wasn't and what was assumed. Kept as a bridge whose model is a file in
  storage (`imported.ts`, `/api/bridges/import`, `/api/bridges/[id]/model`).
- **Imported workspace and compare** (`imported-workspace.tsx`, `compare.ts`): the model analyzed
  as it is, results on the model and in tables, and another program's beam force table pasted in
  beside allcon's, with the differences.
- Not yet: design from an imported model (its members need naming), importing result tables as
  the source of design forces, SAP2000/CSiBridge files, reading a real midas-written file end to
  end (the reader follows midas's documented format and is tested on a file laid out that way).

## 1. What is taken from midas Civil

Read from midas's manual (the PS Composite Bridge Wizard, Traffic Line Lanes, the MCT file
reference) and its tutorials.

| midas Civil | Here |
|---|---|
| Model data: nodes, beam elements, materials, sections, supports, elastic and rigid links, beam end releases, groups | The same objects, the same names (section 3) |
| Girder bridge wizard, "All Frame" (grillage): girders as composite beam elements, transverse deck elements, diaphragms, per-span divisions, skew, 10th-point groups | The wizard's model (section 4) |
| Composite sections that act in steps: the girder alone under the deck's weight, the composite section after | Two built-in stages (section 5); general construction stages later |
| Static load cases by type (D, L, W, T …) and load combinations generated by code | Load cases by AASHTO type; AASHTO LRFD Table 3.4.1-1 combinations |
| Moving load: traffic line lanes with eccentricity and wheel spacing, loads spread to the girders through the cross beams, influence lines, HL-93 truck, tandem and lane, the second truck for negative moment, envelopes with concurrent forces | The same (section 6) |
| Results: reactions, displacements, beam forces and stresses, diagrams, tables | The same, at each element's stations (section 7) |
| PSC and composite design to AASHTO LRFD, from the analysis | allcon's design tools, fed by the results (section 8) |
| Text model file (MCT) and result tables | Import of both (section 9) |
| API (JSON), Excel link | MCP tools (section 10) |

Not taken (out of scope): cable, suspension, arch and segmental wizards; plate and solid elements;
nonlinear, buckling, pushover, time history, heat of hydration; general construction stages with
creep and shrinkage of the whole model (later, with post-tensioning, if asked).

## 2. Scope

- Precast prestressed girder and steel plate girder bridges with a cast-in-place deck: simple spans
  and spans made continuous, straight, skewed supports, 1 to 6 spans.
- Substructure in the model: pier caps and columns as beam elements, bearings as elastic links,
  abutments as supports. Foundations as supports or springs.
- AASHTO LRFD, US customary units shown (SI later: the model is unit-neutral inside).
- Linear elastic analysis.

## 3. The model format (the recommendation)

One file per bridge, `allcon-bridge` (JSON, gzipped in file storage, as worksheets and drawings
are), in two layers:

1. **Definition** — what the engineer edits, and what the wizard fills in: alignment and skew, span
   lengths, the girder section and spacing, deck, haunch, diaphragms, piers (cap, columns, bearings),
   materials, loads (barriers, wearing surface, utilities), lanes. A few dozen values.
2. **Analysis model** — generated from the definition, never edited by hand in the first version:
   `nodes`, `elements` (beam, truss), `materials`, `sections` (properties, and a composite section's
   two states), `supports`, `springs`, `links` (elastic, rigid), `releases`, `groups`, `loadCases`,
   `loads` (nodal, beam, self-weight, temperature), `lanes`, `vehicles`, `combinations`.

Why this way:
- The analysis layer uses midas's own objects and fields, so a midas MCT file maps onto it
  one to one (`*NODE`, `*ELEMENT`, `*MATERIAL`, `*SECTION`, `*CONSTRAINT`, `*SPRING`,
  `*ELASTICLINK`, `*RIGIDLINK`, `*FRAME-RLS`, `*GROUP`, `*STLDCASE`, `*CONLOAD`, `*BEAMLOAD`,
  `*SELFWEIGHT`). An imported model simply has no definition layer.
- **Members** tie the two to design: each girder line in each span, each cap, each column is a
  named member (a group of elements, as midas's wizard makes 10th-point groups). Design tools ask
  for "girder G3, span 2", not element numbers, so they work the same on a wizard model and an
  imported one once its members are named.
- Stored in one fixed unit set (kip, ft, °F); shown in the units chosen.
- Results are a separate file beside the model, stamped with the model's revision, so a stale
  result is never shown as current.

Later a free node-and-element editor can edit the analysis layer directly; the format doesn't change.

## 4. The wizard

Inputs, following midas's PS Composite Bridge Wizard (Layout, Section, Load tabs):
- Layout: spans, support skew, support type at each line (abutment, pier: fixed or expansion
  bearings), continuity (simple spans, or continuous for composite loads).
- Section: girder shape from the library allcon has (AASHTO, AASHTO-PCI, CBT, WF; steel plate
  girder by its plates), number of girders and their offsets, deck thickness, haunch, overhangs,
  diaphragms (end, pier, intermediate by spacing), divisions per span (10 by default).
- Substructure: cap section and length, columns (number, section, height), fixity.
- Loads: barriers, wearing surface, utilities, lanes from the roadway width.

What it generates (midas's "All Frame" grillage): girder elements at the girders' centroids with
composite properties, transverse deck strips between them, diaphragms, bearings as elastic links
from the girder ends to the cap, cap and column elements, supports at the column bases.

A 3D view (three.js, as the model viewer uses) shows the model, the supports, the loads, and after
analysis the deflected shape and the diagrams.

## 5. Analysis

- A 3D frame solver in TypeScript, in the browser (a web worker): 6 degrees of freedom a node,
  beam elements with shear deformation, offsets, end releases, elastic and rigid links, springs.
  Sparse Cholesky. A girder bridge of this kind is a few thousand degrees of freedom: well under
  a second.
- **Two stages, built in:** the girders alone (simple spans) carry their own weight, the deck, the
  haunch and the diaphragms; the composite, continuous model carries the barriers, the wearing
  surface, live load, temperature and wind. This is what midas's composite-section stages do for
  these bridges. Results add up by stage.
- Checks on every run: equilibrium (reactions against applied loads, per case), a mechanism or an
  ill-conditioned model reported with the node it happens at.

## 6. Moving load

As midas's traffic line lanes with cross-beam distribution:
- Lanes across the roadway (AASHTO 3.6.1.1.1), each a line with an eccentricity from the bridge's
  reference line; wheels 6 ft apart; wheel loads spread to the two girders beside them through the
  deck strips.
- Influence lines for every result at every station, by unit loads along each lane.
- HL-93: truck (rear axles 14 to 30 ft) or tandem, plus lane; 90% of two trucks and lane for
  negative moment between contraflexure points and for pier reactions (3.6.1.3.1); dynamic
  allowance on the truck and tandem (3.6.2.1); multiple presence (3.6.1.1.2) over the lanes
  loaded, each lane loaded or not for the worst effect.
- Envelopes with **concurrent forces**: with the maximum moment, the shear and axial force that
  go with it (the pier and cap designs need them).
- Fatigue truck and the agency's permit vehicles (with agency rules on) by the same engine.
- The girder tool's distribution-factor method stays: the two are shown side by side.

## 7. Results

- Tables and diagrams per load case, combination and envelope: reactions, displacements, member
  forces (axial, shears, torsion, moments) at each station, composite section stresses.
- Combinations: AASHTO LRFD Table 3.4.1-1 (Strength I–V, Service I–IV, Extreme Event I–II,
  Fatigue I–II), generated, with the governing one named for each result.
- "Create calc package": the model's data, the loads, and the result tables into Calcs.

## 8. Design from the results

Each design tool gets a second source for its loads: "from the bridge model", beside its entered
values. The engines and their checks don't change.

| Member | Tool | Takes from the model |
|---|---|---|
| Girder line, per span | LRFD Bridge Design Check | Moments and shears by load type at the tenth points, live load envelopes |
| Deck | Deck Slab | Girder spacing, overhang, rail |
| Bearing | Elastomeric / PTFE Bearing | Reactions by load type, movements, rotations |
| Pier cap | Strut-and-Tie Model | Girder reactions per load case, cap geometry |
| Pier column | Pier Column | Axial load, moments and shears with their concurrent forces |
| Joint | Strip Seal Expansion Joint | Expansion length, movements |
| Haunch | Camber and Haunch | Deflections |

The Bridge page lists every member with its design's status (not started, passing, failing) and
opens it. Quantities from all of them go to one set of line items. Drawings (a general plan and
elevation, the typical section, the girder schedule) into Drafting are a later step.

## 9. Import, and checking against other software

- **Model:** a midas MCT file (text), read into the analysis layer. Unsupported commands are
  listed, not dropped silently. CSiBridge / SAP2000 text tables (`.s2k`, `.$br`) after.
- **Results:** midas's result tables (beam forces, reactions, displacements, as exported to Excel)
  and SAP2000's, matched by element and load case.
- **Design only:** with a model and its results imported, name the members and design from the
  imported forces, without allcon's own analysis.
- **Compare:** run allcon's solver on the imported model and show both sets of results side by
  side, with the differences, per load case.

## 10. AI (MCP)

`list_bridges`, `get_bridge` (definition, model summary, results on request), `create_bridge`
(the wizard's inputs), `edit_bridge`, `analyze_bridge`, `get_bridge_results` (a member, a case),
`design_bridge_member`. A `model_bridge` prompt with the procedure, including building one from an
uploaded plan set (as the girder check from plans does: values read, shown with their source,
confirmed before use).

## 11. Validation

Results are marked **"Not verified: check independently"** in the app and on every calc package
until a bridge of that kind has passed its benchmarks. Benchmarks, kept as tests:

1. The solver: closed-form beams and frames (continuous beams, a portal frame, a grillage with a
   known solution), equilibrium on every case.
2. Line girder: the PGSuper fixtures allcon already has (moments, shears, reactions, deflections).
3. FHWA Steel Bridge Design Handbook, Design Example 2A (two-span continuous steel I-girder):
   published moments and shears; midas publishes its own model of this bridge to compare with.
4. FHWA NHI-04-043 (two-span prestressed girder bridge): published girder forces and reactions.
5. midas's "Two Span PSC Composite" tutorial: its published result tables.
6. Any model the owner or users import, through the compare view.

## 12. Build order (one pass, each step live with its benchmark results)

1. The format, the solver, the wizard (superstructure and piers), the 3D view, static load cases,
   the two stages, combinations, result tables and diagrams. Benchmarks 1 and 2.
2. Moving load with concurrent forces. Benchmarks 3 to 5.
3. Design from the results, the member list, the calc package, MCP tools.
4. MCT and result-table import, design-only, the compare view.

Later, if asked: construction stages with creep and shrinkage and post-tensioning; response
spectrum; drawings into Drafting; a free node-and-element editor; SI display.

## 13. Decisions for the owner

1. The format as in section 3 (definition + midas-compatible analysis model + named members).
2. The section's name: "Bridge" (recommended; "Analysis" suggests a general FEM program).
3. Steel plate girders in the first pass, or prestressed only first (steel adds its own design
   tool, which allcon doesn't have yet: the model would analyze them but not design them).
