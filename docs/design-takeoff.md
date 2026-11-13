# Reinforcement details and quantities (take-off) for the design tools

Every design tool with bars or pay quantities has a "Details and quantities" card below its checks
(`components/design/takeoff-panel.tsx`), with two tabs: Reinforcement details (views of the bars,
`detail-sketch.tsx`) and Bar schedule & quantities (the schedule, totals, "Create quantity sheet"
and "Push to line items", `rebar-schedule-tab.tsx`). The STM pier caps have their own detailer
(`stm/detail.ts`, see strut-and-tie-model.md); the others are in `lib/design/takeoff/`.

**Pay items (web app):** generic by default, one CSI MasterFormat section per quantity
(`GENERIC_ITEMS` in `rebar/cdot-items.ts`: 03 30 00 concrete, 03 21 00 bars, 31 23 16 excavation
and so on), the numbering the line items and mapping already use. "Pay items" on the line items
card switches a design to CDOT's Master Item Code Book items, kept as `takeoff.agency` (or
`payItems.agency` for the STM caps). The CDOT pay items in the table below apply with CDOT chosen.

- `takeoff/tools.ts` — one detailer per tool, from its design inputs: the bars the design sizes,
  and what it doesn't size from the CDOT standard named for it, each assumption noted on the page.
- `takeoff/index.ts` — `takeoffFor(kind, inputs, settings)`, `takeoffPayLines` (CDOT pay items,
  default by tool, a shaft's item by its diameter, a girder's by its shape).
- `takeoff/calc.ts` — the quantity sheet (`rebar/schedule.ts` `quantityLines`: the summary of
  approximate quantities as a table, Item No. | Description | Quantity | Unit; the tabulations;
  other items with their basis; the views).
- `rebar/runs.ts` — bars cut at stock and lapped (Class B), hooks, counts at a spacing.
- Settings kept with each design's inputs as `takeoff`: the length the per-foot design covers,
  the chosen pay items, the line items' heading (`designInputs` keeps it for every take-off kind).

| Tool | Detailed as | Quantities (default pay items) |
|---|---|---|
| Box culvert | M-601-1/-2: transverse bars by face at the design's spacing (top mats hooked into the walls, outside wall bars hooked into the slabs), haunch bars, d1 #4 @ 1'-0" in every mat and face; covers 2", 3" bottom, 2½" top when fill ≤ 2 ft. Headwalls and toewalls (one of each per end) from M-601-1 Sheet 2's table: rebar lb/LF by clear span and bent angle, 0.086 CY/LF, per LF of headwall (W / sin of the bent angle); no standard (special design) where the table has none | 601-03030 Class D (Box Culvert); 602-00000 (black, as CDOT culverts); 515-00120 when fill ≤ 2 ft (top + 18 in down the walls); 206-00000 Structure Excavation by M-206-1 (W + 3 ft by length + 3 ft, original ground to the box's bottom; Case 1, ground < 1 ft above the bottom, not paid); 206-00100 Structure Backfill (Class 1) within the same limits to the finished surface, less the box. Inputs: original ground above the box's bottom (default: the finished surface), bent angle. With "Corner bars (M-601-1)" on and a single cell in M-601-1 Sheet 2's table (S, R, fill): t1/b1 straight, c1/c2 bent into the slabs and w1/w2 with the table's h1, h2, v1, v2, v3, the table's CY/LF and lb/LF given as a check set; the design check then counts t1 + c1 (b1 + c2) at a slab's end against an exterior wall. A new culvert is one barrel with a headwall and toewall at each end. An extension of an existing barrel is its pieces (e.g. South 19 ft, North 14 ft): each piece's bars run on their own (d1 bars stop at the joint), each has dowels at its joint with the existing barrel (across both slabs and up every wall; bar, length and spacing as the plans give) and a new headwall and toewall at its open end; excavation and backfill run 1'-6" past the open end only; and 202-00495 Removal of Portions of Present Structure (LS) is added. Wingwalls by M-601-20 (src/lib/design/culverts/m601-20.ts): steel from Sheet 2's table (m, k rounded; L/m to the next column), concrete stepped by h from Sheet 1, toe walls 0.049 CY and 5.1 lb per LF |
| CIP wall | BDM Example 11 / B-601-3: back-face verticals hooked into the footing, front-face verticals and horizontals each face (temperature bars), footing top and bottom transverse hooked, longitudinal, key dowels | 601-03050 Class D (Wall); 602-00000; 206-00000 by M-206-1 (retaining wall in cut: B + 3 ft by length + 3 ft, original ground to the footing's bottom; input, default the top of the wall); 206-00100 within the same limits to the top of the wall, less the wall |
| Wingwall | M-601-20 / BDM Example 8: retained-face horizontals (a series along the sloping top) into the abutment with hooks; front face and verticals #4 @ 12" assumed (5.10.6) | 601-03040; 602-00020 |
| Deck | B-601-5C/5S: transverse top and bottom, longitudinal top and bottom, lapped; with a CDOT standard rail (docs/bridge-rails.md) its bars too, drawn with the overhang | 601-03056 Class DF; 602-00020; 515-00120 between barriers; 606-10900 / 606-11035 rail by the foot (its bars paid there) |
| MSE wall | B-504: facing by area, reinforced zone by volume, leveling pad | 504-04420; 206-00360; 601-01000 |
| Pier column | `piers/column-detail.ts` (docs/pier-column.md): bars hooked into the cap, lapped to footing dowels or the shaft's bars; spiral, hoops or ties with cross-ties | 601-03040; 602-00020; 206-00000 / 206-00200 by M-206-2 around each column |
| Sign shaft | B-503-1: cage (longitudinal, hoops) | 503-000xx by diameter (LF); 602-00000 |
| Girders | quantity only | 618 item by shape, LF end to end |
| Bearings, strip seal | quantity only | 512 Bearing Device (EA); 518 Expansion Device (LF, skewed) |

References: CDOT M-Standards M-601-1, M-601-2 (2019), the Staff Bridge worksheets (June 2026 zip:
B-100-1, B-206-3/4, B-503-1, B-601-3/4/5C/5S, B-618), BDM Examples 8 and 11, the Bridge Detail
Manual Ch. 4, and the owner's sample sets (25250 CBC 007D064470BR, 24610 bridge and walls).
