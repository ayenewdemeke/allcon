# Strut-and-Tie Model (Design → Substructures)

Planar strut-and-tie design of disturbed regions in reinforced concrete pier caps and abutments,
AASHTO LRFD 10th Edition (2024) with the September 2025 errata, US customary units. Ported to
TypeScript from the standalone Python solver (Documents\ChatGPT\Strut and Tie tool, release 0.2),
whose validation it reproduces.

## What it does

- **Model:** the concrete outline, nodes, supports (upward-only allowed) and factored load cases. The
  struts and ties are either entered (node pairs) or found by layout optimization: least volume
  Σ L(At + Ac) over every line between nodes that stays in the concrete, all cases sharing the
  envelopes. Both are solved as a linear program with HiGHS (`highs` npm, WebAssembly), the same
  solver SciPy uses in the Python release.
- **Model checks:** the 25° strut-tie angle limit (5.8.2.2, a failure, not a warning); crossings
  and first-order axial mechanisms are reported as warnings (a hand model may rest on the concrete,
  as published examples note).
- **Ties:** φ fy Ast (5.8.2.4.1), and anchorage at a tie's ends by the unified development
  length (5.10.8.2.1, straight bars or standard hooks 5.10.8.2.4) against the length available
  from the extended nodal zone.
- **Nodes:** each face the engineer lists (bearing, back face or strut interface, with its width
  and the node's thickness) takes its force from the solved model, per case; the node's type
  (CCC, CCT, CTT) follows from the ties meeting it; ν per Table 5.8.2.5.3a-1, or 0.45 without the
  crack-control grid; confinement m = √(A2/A1) ≤ 2 only from the engineer's A1, A2 and basis.
- **Crack-control grid** (5.8.2.6) and the **diagonal-cracking screen** (C5.8.2.2-1).
- **Calc package:** the checks as live math, the model's forces as given values, the sketch.

## Verified against the 10th Edition text

The provisions coded here were checked against the AASHTO LRFD 10th Edition in ALLCON's library
(2026-11-09): 3.4.1 (Tables 3.4.1-1, -2), 3.6.4, 3.8.1.1.2, 3.8.1.2.1 to 3.8.1.2.3, 3.8.1.3, 3.8.2,
5.6.5, 5.7.4.3, 5.7.4.4, 5.8.2.2 (C5.8.2.2), 5.8.2.4.2, 5.8.2.5.1 to 5.8.2.5.3b, 5.8.4.2, 5.8.4.3,
5.10.2.3, 5.10.3.1, 5.10.8.2.1c, 5.10.8.2.6b, 5.10.8.2.7. Corrections it brought: Strength V and
Service I wind use Kz = 1.0 (no 0.30 klf minimum, which is from older editions); a CCC node's back
face is the flexural compression block (not twice the cover), and may be augmented by the yield of
compression bars in it (5.8.2.5.1); curved-bar nodes aren't in the specification yet (C5.8.2.2), so
a corner node stays open for review rather than exempt; headed bars need 3 db center-to-center.

## Loads to the substructure (in the girder design check)

Wind and braking belong to the superstructure, so the girder design check computes them
(`girders/substructure-loads.ts`, section "Loads to the substructure"): the site's Strength III wind
speed, exposure, height and the barrier's height; the depth seen by the wind (girder, haunch, deck,
barrier); WS for Strength III, V and Service I; WL; the vertical wind; braking per lane (3.6.4). The
cap's girder link copies them with each span's reactions ("Refresh from the girder designs").

Girders made continuous (5.12.3.3): each span's share of an interior pier's reaction comes from the
girder check's continuous beam (pier centerline to centerline, bearings offset): the girder and
deck as simple spans, barriers, DC2 and DW by the beam's end shear, and one lane's live load from
the pier's reaction influence line (truck, tandem, lane, and 90% of two trucks with the lane,
3.6.1.3.1). Link the back span's end and the ahead span's start from the same design.

## Inverted-T and abutment caps

- **Inverted-T bent cap:** the girders bear on ledges; each load enters the in-plane model at the
  bottom chord and a hanger tie (the hanger stirrups within W + 2df, two legs each) carries it up
  the stem. At every bearing the ledge is checked by 5.8.4.3: shear friction (5.7.4, μ = 1.4,
  c = 0, Eqs. 5.8.4.2.2-1, -2), flexure with Nuc = 0.2 Vu and the primary bars and closed ties
  (5.8.4.2.1, Eqs. 5.8.4.2.2-5 to -7), punching (Eqs. 5.8.4.3.4-3 to -5, with the overlap limits),
  hangers at strength and service (Eqs. 5.8.4.3.5-1 to -3), and bearing (5.6.5). Torsion (5.7.3.6)
  is listed as not evaluated.
- **Abutment cap on piles:** the bent template with the piles as its supports (pile width and
  centerlines); the component is an abutment. Earth pressure on the backwall acts across the cap's
  plane and is checked elsewhere.

## Finite geometry from a standard cap (`stm/nodal-zones.ts`)

For a model built from a standard cap ("Node faces and anchorage: From the cap's geometry", the
default; "As entered" keeps the manual inputs):

- **Which nodes are checked** (C5.8.2.2, as the FHWA examples do): nodes under a bearing, over a
  column, and where a hammerhead arm's struts land on the column bars' tie. Panel points and strut
  crossings are smeared nodes; the corner where the top bars bend into the column is a curved-bar
  node; neither needs a stress check, and each is listed with that reason.
- **Each node's zone:** its bearing length (the bearing, the column's width or a hammerhead
  column node's part of the stress diagram, or twice the column bars' inset at the tie line) by
  twice the chord's centroid distance from the face (5.8.2.5.2): 2 × top cover, 2 × bottom cover.
- **Faces, case by case:** a load, reaction or column strut on the horizontal face (width lb); a
  chord strut on the vertical face (ha); each inclined strut's interface lb sin θ + ha cos θ
  (Figure 5.8.2.2-1), a bearing shared between struts by their vertical components and the back
  face by their horizontal ones (Figure C5.8.2.2-4). A bonded tie puts no stress on its back face
  (C5.8.2.5.3b). ν by the node's type in each case; the worst case governs.
- **Confinement m** at bearings: A2 similar to and concentric with the bearing, limited by the cap's
  width, the cap's end, halfway to the next bearing, and the 1V:2H spread (5.6.5).
- **Struts fit:** each strut is as wide as its face at a singular node, prismatic from there to
  midlength (toward a smeared node it may fan out); the band must stay within the concrete.
  A strut between two smeared nodes has no face to check (its strength is checked at node faces).
- **Nodal zones** must lie within the concrete and not overlap (a hammerhead column's two nodes
  are adjacent parts of its stress diagram, so they're exempt from each other).
- **Bars' fit** (5.10.3.1): the fewest layers at the least clear spacing (1.5 db, 1.5 in), the bars
  shared evenly between layers, layers 1 in or db apart; their centroid must be no deeper than the
  cover the model's chord uses (+0.5 in).
- **Anchorage** where a chord's bars stop: the bars run to the cap's end less the clear cover
  (template input, 2 in), hooked or straight (template input); the critical section is where the
  bars leave the extended nodal zone, at the edge of the strut anchoring them (w / 2 sin θ inside
  the node, Figure C5.8.2.4.2-1). The development length is the 10th Edition's unified length for
  the tie's full yield (λer = 1, no excess-steel credit, as the design basis sets). A hammerhead's
  column bars where the cap continues past the column develop up into the cap, from where they
  leave the node's extended zone to the cap's top less cover; at a corner of the concrete (the
  column's face at the cap's end) they bend into the top bars, a curved-bar node with no stress
  check (C5.8.2.2) and the least bend of Table 5.10.2.3-1 (the ACI curved-bar radius check isn't
  applied: AASHTO only). Column bars continue down into the column; stirrups are hooked around the
  longitudinal bars (5.10.8.2.6). Where a length falls short the result lists what would fix it:
  headed bars (5.10.8.2.7, if their 3 db clear spacing fits), smaller bars of the same area that
  still fit the chord's cover, or the extra length needed. An anchorage entered under Ties
  replaces the worked-out one.
- **Not yet:** congestion where bar systems cross at the column; wind, braking and loads across
  the cap.

## Reinforcement details, bar schedule and quantities (`stm/detail.ts`, `rebar/`)

A model built from a standard cap gets three tabs on the right: Model and checks, Reinforcement
details (elevation and sections A-A through an arm or span, B-B over a column), and Bar schedule &
quantities (with "Create quantity sheet", a Calcs sheet of its own, variant `quantities`). The STM
calc package gains the details and schedule as an appendix.

- **From the design:** the top and bottom bars (count, size, layers by 5.10.3.1), stirrups (size,
  legs, spacing; the grid's sv if closer), the grid's horizontal bars as side-face bars (Ah/2 per
  face within sh), an inverted-T's ledge bars and ties.
- **Standard rules** (FHWA-NHI-17-071 Ex. 2 Figs. 2-18 to 2-20; CDOT Bridge Detail Manual Ch. 4):
  top bars hooked down at the cap's ends (90° standard hooks, 5.10.2.1), or at a C-bent's corner
  turned down to lap the column bars (Class B, 5.10.8.4.3a); bottom bars along the soffit (bent at a
  taper), hooked up; closed stirrups in nested sets giving the legs evenly across (4 legs = outer +
  middle-third hoop), 135° hooks; a tapered arm's stirrups are a bar series (one mark, H varies,
  counted at the average length); side-face rows stop where a taper reaches them; bars longer than
  stock (40 ft for #5 and smaller, 60 ft for #6 and larger) cut and lapped Class B, staggered, laps
  counted; no laps above #11 (mechanical splices); lengths are out-to-out dimensions, each rounded
  down to the inch. The column's bars are drawn into the cap with hooks but scheduled with the column.
- **Marks:** size then sequence (1101, 501), ALLCON's; CDOT calls bars out by size and use, which
  each row carries ("#11 Cont (Tot 26)", "#5 Stirrups @ 0'-6" max (4 legs)").
- **Quantities:** weight by ASTM A615 unit weights, by size and total; concrete from the outline
  above the columns' tops by the cap's width (plus an inverted-T's ledges), CY.

### CDOT pay items and project line items (`rebar/cdot-items.ts`, `rebar/pay-lines.ts`)

The quantities go under CDOT pay items from the Master Item Code Book (Spec Year 05, 2026 Q3):
item number, description and pay unit. `TOOL_PAY_ITEMS` lists, per design tool, the items each
quantity may go to; defaults follow CDOT's own bridge and wall quantity sets (601-03040 Concrete
Class D (Bridge) for caps, 601-03056 Class DF for decks, 602-00020 epoxy-coated bars on bridges,
602-00000 on walls, 504 facing and 206-00360 for MSE walls). Quantities are rounded as CDOT's
summaries carry them: CY to 0.1, LB to the nearest 10. "Push to line items" (Bar schedule &
quantities tab) writes a heading for the design and a line per pay item into its project's
line items (SOV / BoQ); pushed again it updates the same lines in place, keeping their rates
(`inputs.payItems.headingId`). The quantity sheet leads with a summary of approximate quantities
by pay item (a table, `summaryTable`: Item No. | Description | Quantity | Unit), then the
concrete and bar-by-bar reinforcing tabulations, then the record set's total with space for the
independent check set (within 1%, CDOT Bridge Detail Manual 4.12), then the other items with
their basis.

Structure excavation and backfill follow CDOT M-206-2 (`capEarthwork`, `stmPayLines`), from the
original ground's height above the cap's bottom (`inputs.payItems.ground`; an input on the
quantities tab):
- **Abutment:** 206-00000 over (1'-6" + cap width + the 4 ft backfill zone) by (length + 3 ft),
  ground to the cap's bottom (default: the cap's depth); 206-00100 Class 1 and 206-00360
  Mechanical Reinforcement of Soil in the 4 ft zone behind the abutment, the cap's height by its
  length; the rest of the excavation, less the cap and the zone, 206-00200 Class 2.
- **Pier (hammerhead, bent):** none here; the excavation around the columns is the Pier Column
  tool's (docs/pier-column.md).
Any two quantities given the same pay item add up under one line.

## Strut-and-tie or sectional (`stm/sectional.ts`)

AASHTO 5.8.2.1: STM should be considered where the distance between the centers of a load and its
supporting reaction is under twice the member's depth; 5.5.1.2.1: D-Regions extend about a depth
from loads and reactions, B-Regions between follow beam theory. Each arm, overhang or span is
classed by its loads' nearest distance to a column face over the depth at the column (the shear
span, as FHWA measures it): all ≥ 2h is a B-Region, which the sectional method suits; the card
says when the whole cap is B (STM not needed). "Check the B-Regions by the sectional method"
(`inputs.sectional`) checks them for every load case (both turning directions): the cap as a beam
(a hammerhead's arms by statics from their tips; a bent continuous on pinned column centerlines,
stiffness method); at each face, dv from it, and inboard of each load: flexure (5.6.3.2, φ by εt,
5.5.4.2), minimum reinforcement (5.6.3.3, γ1 1.6, γ3 0.67, fr 0.24√f'c), shear by the General
Procedure (5.7.3.4.2; Eq. -2 with ag 0.75 in assumed when below the minimum stirrups), minimum
stirrups and spacing (5.7.2.5, 5.7.2.6), longitudinal reinforcement for shear (5.7.3.5), skin
reinforcement (Eq. 5.6.7-3 and spacing). Crack control (Eq. 5.6.7-1) needs Service I moments and
isn't checked yet. The calc package adds the governing sections as live math.

## Loads from girder designs (lane placement on the cap)

"Loads from girder designs" copies, for the back and/or ahead span, a girder design's layout and
each girder's unfactored DC and DW reactions at the pier (girder on its full length, deck and
haunch, diaphragms, barriers and other DC, wearing surface, as the girder check loads them). The
copy is a snapshot with its source; "Refresh from the girder designs" re-reads it.

- **Along the bridge:** one lane's reaction at the pier from the influence line of the two spans
  as simple spans: the design truck (14 ft) or tandem with IM = 33%, plus 0.64 klf; at an
  interior pier also 90% of two trucks 50 ft apart with 90% of the lane load (3.6.1.3.1). Each
  part is kept by span, so different girder layouts each side get their own share.
- **Across the bridge:** up to ⌊roadway/12⌋ lanes (3.6.1.1.1), moved across the shared roadway in
  1 ft steps with the trucks shifted ±1 ft in their lanes (wheels ≥ 2 ft from the lane edges), the
  lane load 10 ft wide; each wheel line and the lane load go to the girders by the lever rule
  (simple deck spans, cantilevered overhangs); multiple presence per T. 3.6.1.1.2-1.
- **On the cap:** girder positions along the cap from the spacing and skew (z / cos θ) about the
  cap x of the bridge centerline; each bearing load split onto the two load nodes either side by
  statics; the cap's own weight above the soffit by vertical strips. Strength I cases (1.25 DC,
  1.50 DW, 1.75 LL): the arrangement loading each load node most, the most turning each way about
  the supports' centroid and the most total; the two turning cases again with 0.90 DC and 0.65 DW;
  and Strength IV (1.50 DC, 1.50 DW, no live load). These replace the entered load cases while the
  link is on.
- **Service I** (1.0 DC + 1.0 DW + 1.0 LL+IM) on each arm beyond an outer column face, the
  arrangement loading the arm most: its shear at the face and the shear span to the arm's load
  resultant feed the diagonal-cracking screen (C5.8.2.2) of a standard cap, unless a shear is
  entered. A bent's spans between columns: the span's loads as a simple span between the column
  centerlines, the shear at each face less the load between centerline and face, the shear span to
  the resultant of the load that face carries.
- **Wind across the bridge** (optional, in the cap's plane): PZ = 2.56×10⁻⁶ V² Kz G Cd ksf
  (Eq. 3.8.1.2.1-1, Kz by Eq. 3.8.1.2.1-2 for exposure B, C or D at 33 ft or more, G = 1.0,
  Cd = 1.3), over the exposed depth, at least 0.30 klf, on half of each span; horizontal at the
  bearings, its overturning about the bearings (at mid-depth) as a couple across the girders.
  Strength III (1.25 DC, 1.50 DW, wind at the site's speed) adds the 0.020 ksf uplift on the deck at
  its windward quarter point (3.8.2); Strength V (1.25 DC, 1.50 DW, 1.35 LL turning the cap the
  wind's way, 80 mph, and 0.10 klf on the live load 6 ft above the deck, 3.8.1.3). Each both ways.
  Inputs: the site's speed (Figure 3.8.1.1.2-1), exposure, height above ground, exposed depth, deck
  height over the bearings. A hammerhead's column takes the horizontal force at its first node
  (rebuild an older model for it). These provisions were coded from the 10th Edition's articles
  as cited; check them against the specification before relying on a wind-governed design.
- Braking and other loads along the bridge act across the cap's plane: outside this model.
- Not yet: reactions of continuous girders (taken as simple spans, with a warning), and a button
  in the girder editor to start a cap from it.

## Standard caps (templates)

"Start from a standard cap" builds the model from a hammerhead (one column, optional taper to the
ends) or a multi-column bent cap: its length, depth, cap and column widths, column positions,
bearings (entered, or positioned from the girder link) and bars. The generator
(`stm/templates.ts`):

- direct struts first (C5.8.2.2, fewest panels): each bearing's load goes by one strut to its
  column node where that strut is steeper than 27° (a margin over 25°, 5.8.2.2); farther out it
  steps in panel by panel, each panel point a vertical stirrup tie, reusing bearings and other
  loads' panel points where they're within reach. In a span between columns a load gets a path
  to both columns (with pinned single-node columns, statics sets how it divides);
- a hammerhead laid out as FHWA-NHI-17-071 Design Example 2 (the same bent as TxDOT 5-5253-01
  Example 2): bearings closer than "Resolve bearings closer than" (half the depth at the column by
  default) act as one load at their resultant, its bearing face their pads together; the top tie on
  the top bars' centroid; the bottom strut ("Bottom strut: At a/2", the default) at a/2 above the
  soffit, a from the largest moment of an arm about its column node over the model's cases held by
  that node's back face, M = φ ν f'c b a (d − a/2), φ 0.7, ν 0.85 (0.70 where the arm lands on the
  column-bar tie, a CCT node; 0.45 without the grid), 1% clear; the node checks use that a as the
  back face. Each arm's loads strut to their own column node; a load between the two column struts
  goes to the nearer (FHWA's strut BD); a load on the column bars' line loads the corner node, whose
  corner strut carries it. Outer loads too flat for a direct strut step in by equal panels to the
  next bearing or the column (FHWA's two-panel model puts its vertical tie midway). With fixed
  column struts one geometry carries every case only if the arms can trade moment, which FHWA does
  through the column tie (drawing one model per case): the innermost girder beyond each column face
  (never one over the column) also struts to the far column node, crossing at a node, the heavier
  arm's only where the lighter face has no tie. This is the tool's addition, not in the references,
  and it carries nothing where FHWA's own path suffices. The top bars at a corner over the column
  bars' tie bend into the column bars (FHWA's node A, curved-bar), so they need no anchorage there;
- a hammerhead's column by FHWA's method (Design Example 2): for the case turning the column most
  (or toward the side chosen in "Lay out for"), the column's linear stress where the disturbed
  region ends (one column width below the cap, C5.5.1.2.1), P/A ± Mc/I; its compression split into
  the part carrying the heavier arm's loads beyond the face (P2) and the rest; a strut at each
  part's centroid down to a support, each node as wide as its part; a tie at the lighter face's
  bars (input: face to bars' centroid, 8 in by default) where that face is in tension, with its
  corner strut into the near column strut (FHWA's A–A′ and A–D); the lighter arm's struts land on
  a node on that tie. Checked against FHWA Example 2: node E 0.31 ft inside the face, D
  2.17 ft from E, E's face about 7.6 in. A model takes the cases turning the column its way;
  cases turning it the other way are left out with a warning, for a second design laid out for
  that side. A bent cap's columns are one support node each at the centerline (gravity bents);
- top chord (top bars), bottom chord (bottom bars between columns; struts under cantilevers);
  diagonals marked strut-only so the solver can't make one a tie;
- node checks and anchorage from the cap's geometry (above); bearings more than twice the depth
  from a column face are flagged as outside the disturbed region (5.8.2.1);
- the diagonal-cracking screen from the girders' Service I loads on each arm (with the girder
  link), or as entered.

The sketch draws the loads as downward arrows with their values: at the girders' bearings, each
girder's Strength I reaction with its most live load (with DC, DW and LL+IM kept in the result),
when the loads come from girder designs; otherwise the largest factored load at each loaded node.

Members can be entered as `A-B:strut` or `A-B:tie` to fix their sign (an LP bound). A chord
that runs straight through a node changing from tie to strut (within 5° of straight) isn't
counted as a strut-tie angle; any other pair is. Anchorage is reported missing only where a tie
line ends, not where scheduled bars continue in line.

## Files

`src/lib/design/stm/`: `aashto.ts`, `detailing.ts`, `anchorage.ts`, `serviceability.ts`
(kernels); `geometry.ts`, `linalg.ts` (one-sided Jacobi SVD), `stability.ts`, `optimizer.ts`,
`model.ts` (solver); `lp-node.ts` / `lp-browser.ts` (HiGHS loaders); `strut-tie.ts` (the design),
`strut-tie-calc.ts` (calc package). Editor `src/components/design/stm-editor.tsx`, sketch
`stm-sketch.tsx`.

HiGHS: the server and tests `import("highs")` (it's in `serverExternalPackages`); the browser
loads `/wasm/highs.js` and `/wasm/highs.wasm`, copied from node_modules by
`scripts/copy-ifc-assets.mjs` on install, because the script reaches for Node's `fs`. Use
`highs` 1.15 or later: 1.8.0 reports solutions to 6 significant figures, which fails the
equilibrium check.

## Validation

- `optimizer.test.ts`: the Python release's regression models give the same optimum objectives
  (66,984 and 46,184 in³), mechanism counts, envelopes and hand solutions.
- `kernels.test.ts`: the hand solutions for the AASHTO kernels.
- `strut-tie.test.ts`: the defaults are a published cantilever bent cap worked example (8th
  Edition basis, one Strength I case). All nine member forces are within 0.9%; node capacities
  match (with confinement within 0.5%); the strut-to-node interface at the column corner is 1.7%
  over its strength, which the example accepts by judgment and this tool reports as a failure;
  the top bars' straight development by the 10th Edition is 48.2 in against 91.3 in available
  (the example's older equation needed hooks).
- `fhwa-deep-beam.test.ts`: FHWA-NHI-17-071 Design Example 1 (simply supported deep beam, a span
  between two supports as in a bent cap) built with the bent-cap template and the worked-out
  geometry: direct struts 1,177 kip at 30.7°, chords 1,013 kip, reactions 600 kip; node F's
  interface 12.3 in and 1,239 kip; node F's 6 in back face short (857 kip against 1,013), which the
  example also finds and fixes with bars in the top strut; node C's interface 15.7 in; the tie's
  available length 25.4 in from the critical section of Figure 1-21; Vcr at the lower limit. The
  hook needs 25.9 in by the 10th Edition at full yield against the example's 20 in (8th Edition,
  crediting excess steel), so this tool reports it half an inch short.
- `templates.test.ts`: FHWA-NHI-17-071 Design Example 2 built from the hammerhead template (level
  top): FHWA's nine members and no others; AB, BC, AA′, BD, DE, CE and DD′ within 3% of Figure 2-9;
  AD's horizontal part and EE′ match once FHWA's 2.9° top slope is allowed for; node E 2.30 in above
  the soffit (FHWA 2.23 in, taking the moment at the face rather than at E); node E's interface
  with CE over its strength, as in FHWA.
- `case-results.test.ts`: per-case equilibrium, governing cases, supports, coverage, the worked-out
  geometry (every strut, node and anchorage checked or exempt with its reason).
- `strut-tie-calc.test.ts`: the calc package works out in Calcs with no errors and agrees with the
  engine, including a standard cap's worked-out faces and service screens; three decimals; code
  references only.

## Not yet

Openings in the outline (the solver supports them; the editor doesn't yet), finite nodal geometry
for models not built from a standard cap, the linked elastic service analysis of the Python
release, congestion where bar systems cross, wind and braking loads, prestressing, 3D pile caps,
and seismic detailing.
