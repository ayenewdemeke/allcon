# CDOT bridge rails in the Deck Slab tool

## In the girder design (LRFD Bridge Design Check)

- **Bridge rail and roadway section:**
  - A rail picked here sets the barrier's width, weight (dead load on the girders) and height
    (the wind's depth). `girders/bridge-deck.ts` `applyRail` runs whenever the inputs are
    normalized or edited.
  - The crown is at an offset from the deck's centerline, or the roadway has a one-way slope,
    at the cross-slope.
- **Typical section** (`components/design/bridge-section-sketch.tsx`), to scale and in the calc
  package:
  - the deck with its crown, the haunches, every girder in its shape, and both rails;
  - dimensions: out to out, between the rails, the overhangs, and n spaces @ S.
- **Quantities** (`girderTakeoff`):
  - the girders (618, LF);
  - the deck slab, out to out × as-cast thickness, plus the haunches (n × flange × haunch), under
    601-03056 Class DF;
  - the rails, 2 × the deck length (606);
  - waterproofing between the rails (515-00120, SY).
  
  The deck length is girder end to girder end over the spans, and adjustable. Skew doesn't change
  the area.
- **"Deck Slab" hand-off:** it starts a Deck Slab design with the rail and the deck length, marked
  `fromGirder`. That design then carries only the bars: the girder design keeps the deck
  concrete, rails and waterproofing, so they aren't paid twice.

## In the Deck Slab tool

The deck's "Bridge rail" section picks a CDOT standard rail (Staff Bridge worksheets B-606, June 2026,
in `lib/design/decks/rails.ts`) or keeps an entered barrier ("Other barrier").

| Rail | Sheet | Kind | Pay item |
|---|---|---|---|
| Bridge Rail Type 9, #4 option | B-606-9-4 | concrete parapet, 3'-7" high, 1'-6" base | 606-10900 |
| Bridge Rail Type 9, #3 option | B-606-9-3 | same section, #3 bars | 606-10900 |
| Bridge Rail Type 10 MASH | B-606-10MASH | concrete curb 1'-6" × 1'-1", W6x20 posts at 10'-0", two HSS 6x6 tubes | 606-11035 |

- **Sections, bars and per-foot quantities:** read off the worksheets. Concrete is within 3% of
  each sheet's table (0.12 and 0.059 CY/LF).
- **Bar layout:**
  - Type 9 #4: front face @ 1'-6" (@ 6" over 8'-0" end zones), back face @ 1'-6", lower stirrups
    @ 1'-0", head ties @ 1'-6", and #4 Cont (Tot 8).
  - Type 9 #3: front @ 6", back and lower stirrups @ 1'-0", and #3 Cont (Tot 10).
  - Type 10: curb stirrups 3 spa @ 7½" each side of each post with 10" max between, and #4 Cont
    (Tot 4).
- **Rail bar weights are approximate:** the scheduled rail bars come to about 15, 11 and 6 lb/LF,
  against the sheets' 19.0, 12.4 and 8.7. The bar shapes are simplified, and joints and end
  anchorages are not included. They are for information only, because the rail is paid by the
  foot under 606 with its bars included.
- **Rail bar steel:** ASTM A1035CS Grade 100 (fy 100) or stainless A955 (fy 75), as the
  worksheet assigns by location.
- **What the deck takes from the rail:**
  - the barrier's width, weight (concrete at γc plus the posts and tubes) and c.g.;
  - Fv and Lv from Table A13.2-1 for the test level (TL-5 by default, as the worksheets design
    it; TL-4 selectable);
  - Fv's lever arm, from the rail's top to its traffic face at the base.
- **Concrete parapets (Type 9), yield-line analysis (A13.3.1):**
  - Mc at each height comes from the traffic-face bars crossing it and the wall's thickness
    there, averaged over the height (CA13.3.1). Mw comes from the longitudinal bars, each with its
    own lever arm, with the two faces averaged. Mb = 0.
  - Lc and Rw within a segment and at an end (with the end zones' closer bars). Rw ≥ Ft is shown
    as advisory: the standard is crash tested or designed by Staff Bridge.
  - The deck's Case 1 uses that averaged Mc and T = Rw / (Lc + 2H) (A13.4.2). The end zones' larger
    values are an advisory Case 1 at the rail's ends and joints.
- **Type 10 MASH:** a post-and-tube rail on a curb. The deck's Case 1 forces stay as entered
  (A13.4.3: from the rail's design).
- **Take-off:**
  - The rail's bars go in the deck's bar schedule marked "paid under 606…". They are kept out of
    the 602 total (`BarGroup.paid`, `Schedule.elsewhere`).
  - The rail's length (both edges) is the 606 line.
  - A second view draws the rail and the overhang together: the rail's bars into the deck among
    the deck's transverse and longitudinal bars.
