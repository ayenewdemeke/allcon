# LRFD Bridge Design Check — Phase 1 spec (for review)

A new tool in **Design**: precast prestressed girder superstructures checked to **AASHTO LRFD Bridge
Design Specifications, 9th edition (2020)**. Phase 1 covers **simple spans**; multi-span continuity
is Phase 3. US customary units. Load rating is out of scope.

## Status (2026-11-05): Phase 1 built, in the desktop copy

Built as specified:
- `src/lib/design/girders/sections.ts`, `prestressed.ts`, `prestressed-calc.ts`;
- `src/components/design/girder-editor.tsx`, `girder-sketch.tsx`;
- registered in `kinds.ts`, on the design page, in the calc package action and in `createLinkedDesign`.

Validated (tests in `prestressed.test.ts` and `prestressed-calc.test.ts`):
- Every library shape's outline matches its published A, I and yb within 0.12%:
  - AASHTO and AASHTO-PCI shapes against their standard tables;
  - CBT shapes against CDOT sheet B-618-CBT2.
- Distribution factors match FHWA NHI-04-043 Design Step 5.1 (AASHTO Type VI, 110 ft, S = 9′-8″,
  20° skew):
  - Kg;
  - interior 0.796 / 0.973;
  - exterior lever rule 0.806 / 0.845;
  - e·g 0.772 / 0.762;
  - rigid section 0.776;
  - skew 1.047.
- HL-93 per-lane moments and shears against hand values.
- The calc package, evaluated by Calcs, matches the engine on three bridges.

**PGSuper benchmark (2026-11-05)** — `pgsuper-benchmark.test.ts`, 84 checks, fixtures in
`pgsuper-benchmarks.json`:
- PGSuper 9.0.4 (BridgeLink, installed from WSDOT) ran two bridges unattended in its NCHRP 12-50
  test mode, with its criteria set to plain AASHTO:
  - WF74G, 120 ft span, 6 girders at 8 ft, 30 strands;
  - WF58G, 85 ft span, 5 girders at 7.5 ft, 20 strands.
- The tool gets the same bridges: PGSuper's own girder outline and strand fill order, read from its
  file.
- Results at every tenth point, interior and exterior girders:

| Quantity | Agreement |
|---|---|
| Dead and live load moments, Strength I Mu and Vu | within 0.5% (in practice to 0.01%) |
| Shear dv, β, θ | dv within 1%, β within 3%, θ within 1.5% |
| Vc, Vs, Vn | Vc within 4%, Vs within 2%, Vn within 3% (about 1% in practice) |
| Elastic shortening | within 3% (1.4% in practice) |
| Flexural resistance | within 4% and never above PGSuper's |

  The flexural resistance is 2.6–2.7% lower here: the approximate fps of 5.6.3.1.1 against
  PGSuper's strain compatibility.
- Found and fixed through it: an exterior girder now carries half the diaphragm load (diaphragms on
  one side), as PGSuper does.
- Not compared:
  - **Long-term losses.** PGSuper's test mode crashes with the approximate method, so it ran
    WSDOT's refined method; its effective prestress still came within 1%.
  - **Time-dependent camber.** PGSuper uses its own creep-duration settings. Its deck-load
    deflection matched ours to about 0.2%.
- The generator scripts (`pgs-bench.mjs`, `pgs-fixture.mjs`) were kept outside the repo, in the
  session's scratch folder. Rerunning means rebuilding them; the fixtures are what the tests use.

Not yet done:
- The FHWA example's other numbers (losses, stresses) can't be compared directly: it predates the
  9th edition's loss and stress provisions.

Choices made while building:
- The shear critical section is taken at dv from the bearing centerline (conservative, not from the
  support's face).
- Interface shear counts no permanent clamping force (Pc = 0).
- Camber at the deck is the release camber × (1 + ψ), with ψ from 5.4.2.3.2.
- The skew correction for shear is applied to interior girders too by default (as FHWA's example
  does); it's an option.
- The default example is a BT-72 with 30 bottom strands, 2 temporary top strands, and f′ci = 7.0 ksi.

---

Original spec, approved before the build:

## Where it lives

- Design → new category **Superstructures** → **LRFD Bridge Design Check** (kind
  `lrfd-girder-check`), next to the existing Bridge Components.
- Code, kept self-contained so it ports cleanly to the repo:
  - `src/lib/design/girders/prestressed.ts` (engine), `sections.ts` (shape library),
    `prestressed-calc.ts` (calc package), with tests beside each.
  - `src/components/design/girder-editor.tsx` and `girder-sketch.tsx`.
- Same pattern as the other designs: inputs on the left, results recomputed as you type, a
  Check / Demand / Capacity / Ratio table, and **Create calc package** into Calcs.
- Built in this desktop copy first; moved into the repo later as a pull request on a branch
  (desktop-only changes such as the "ALLCON" name stay out of it).

## Inputs

**Layout**
- Span length (CL bearing to CL bearing), girder spacing, number of girders, overhangs, skew.
- Girder checked: interior or exterior (both are computed; the summary shows the controlling one).

**Girder section**
- Library shape, or custom (polygon; properties computed: A, I, yb, yt, Sb, St).
- Library:
  - AASHTO I-beams Types I–VI.
  - AASHTO-PCI bulb-tees BT-54, BT-63, BT-72.
  - **CDOT Colorado Bulb Tees (CBT)** — the full CDOT series.
  - State shapes beyond CDOT (NU, WSDOT WF, …) can be added later the same way.
- Dimensions are taken from the published standards and checked against PGSuper's girder
  library (see "Open items").

**Deck and composite section**
- Deck thickness, sacrificial (wearing) thickness, haunch thickness (used for loads, ignored for
  section properties by default), deck f′c.
- Effective flange width per 4.6.2.6.1 (tributary width); modular ratio from the two concretes'
  Ec (5.4.2.4).

**Materials**
- Girder f′ci and f′c, unit weight, K1 (5.4.2.4).
- Strands: 0.5 in or 0.6 in, Grade 270 low-relaxation, Ep = 28,500 ksi (5.4.4.2), jacking stress
  fpj ≤ 0.75 fpu (Table 5.9.2.2-1).
- Mild steel fy = 60 ksi.

**Strands** (Phase 1: straight strands)
- Rows of strands: count per row and height from the bottom.
- Harping and debonding are Phase 2.

**Loads**
- DC1: girder self-weight, deck, haunch, intermediate diaphragms (point loads at given
  locations).
- DC2: barriers, other superimposed dead load.
- DW: future wearing surface.
- How DC2 and DW are shared among the girders: equally to all girders (4.6.2.2.1), or the
  barrier to the exterior girders only.
- Live load: HL-93 (3.6.1.2), dynamic load allowance IM = 33% on truck and tandem only (3.6.2.1),
  multiple presence factors (3.6.1.1.2).

**Shear reinforcement**
- Stirrup bar size, legs and spacing by zone; stirrups extending into the deck for interface
  shear.

**Factors**
- η factors (1.3.2), and editable load and resistance factors with AASHTO defaults.

## Checks

All at tenth points, plus the critical section for shear (5.7.3.2), the transfer length (60 db,
5.9.4.3.1) and the diaphragm locations.

**Section properties**
- Non-composite and composite (transformed deck), at both the girder and deck concretes.

**Live load distribution factors** (4.6.2.2), cross-section type (k)
- Interior moment, Table 4.6.2.2.2b-1, with Kg from 4.6.2.2.1-1; interior shear, Table
  4.6.2.2.3a-1.
- Exterior moment, Table 4.6.2.2.2d-1, plus the lever rule and the rigid method (4.6.2.2.2d-1);
  exterior shear, Table 4.6.2.2.3b-1.
- Skew: moment reduction (4.6.2.2.2e-1) and shear correction (4.6.2.2.3c-1).
- Range of applicability flagged; outside it, the lever rule is offered and the user decides.

**Analysis**
- Simple-span influence lines. HL-93 envelopes: the design truck (14 ft rear spacing for moment;
  the governing spacing checked), the design tandem, and the lane load.
- Dead loads by stage: girder alone at release and erection, the deck on the non-composite
  girder, DC2 and DW on the composite section.

**Prestress losses**
- Elastic shortening (5.9.3.2.3a).
- Long-term losses, approximate estimate (5.9.3.3).
- Shown as a stage table: jacking → transfer → final.

**Stresses — temporary, at release** (5.9.2.3.1)
- Compression 0.65 f′ci (5.9.2.3.1a).
- Tension per Table 5.9.2.3.1b-1, with the bonded-reinforcement alternative and the rebars needed.

**Stresses — service**, final (5.9.2.3.2)
- Compression, Service I: 0.45 f′c (effective prestress plus permanent loads) and 0.60 φw f′c
  (all loads) (5.9.2.3.2a).
- Tension, Service III, bottom of the girder: Table 5.9.2.3.2b-1 for the chosen exposure. γLL is
  0.8 with approximate losses (Table 3.4.1-4).
- Deck compression.

**Flexure, Strength I** (Table 3.4.1-1)
- fps for bonded strands (5.6.3.1.1).
- Rectangular or T-section behavior; when the neutral axis drops below the deck, the girder's
  concrete is handled per 5.6.2.2.
- φ from net tensile strain (5.5.4.2).
- Minimum reinforcement: Mn ≥ min(Mcr, 1.33 Mu) (5.6.3.3).

**Shear, Strength I**
- General procedure (5.7.3.4.2): εs, β, θ.
- Vc, Vs, Vp, and Vn ≤ 0.25 f′c bv dv + Vp (5.7.3.3).
- Minimum transverse reinforcement (5.7.2.5) and maximum spacing (5.7.2.6).
- Interface shear between the girder and the deck (5.7.4).

**Camber and deflection**
- Camber at release; camber at deck placement with creep coefficients per 5.4.2.3.2.
- Deck and superimposed dead load deflections.
- Results handed to the existing **Camber and Haunch** design (its camber and deflection inputs)
  with one click.
- Creep follows AASHTO 5.4.2.3.2, not the PCI multipliers.

**Hand-off to Deck Slab**
- One click opens the existing Deck Slab design with the girder spacing, overhang, deck thickness
  and f′c filled in. Deck design is not rebuilt.

## Outputs

- **Summary**: every check by limit state (Release, Service I, Service III, Strength I) and
  location, with Demand / Capacity / Ratio and OK/NG, interior and exterior girders, and the
  controlling ratio at the top.
- **Sketches**: the cross-section with its strands; the elevation with the check locations.
- **Calc package** (Calcs worksheet, printable as PDF): inputs, section properties, distribution
  factors, load and moment/shear tables, losses, each check with its AASHTO article.

## Validation

Locked in as unit tests before the tool is called done:

1. **PGSuper** (free, WSDOT): 3–4 simple-span bridges run in PGSuper and in this tool, compared at
   tenth points. Tolerances: section properties and DFs ±0.5%; moments, shears, stresses, losses
   ±2%; capacities ±3%. Bridges:
   - AASHTO Type IV, ~80 ft;
   - BT-72, ~130 ft;
   - a CDOT CBT, ~110 ft;
   - a skewed one.
2. **FHWA's public-domain prestressed girder design example** (BT-72): its simple-span stages
   (section properties, DFs, losses, release stresses) as a second reference.
3. **sectionproperties** (Python, already installable in the app's Python) to check every library
   shape's A, I and yb.
4. NBI / InfoBridge used only to pick realistic span and girder combinations.

## Open items for you

1. **CDOT CBT dimensions**: I'll take them from CDOT's published Colorado Bulb Tee standard
   (Staff Bridge) and cross-check against PGSuper's library. If you have a preferred source (a
   CDOT worksheet or standard sheet), send it.
2. **Defaults**: the tool opens with a worked example. Proposed: a BT-72, 120 ft span, 8 ft
   spacing, 8.5 in deck. Or a CBT, if you'd rather start Colorado-first.
3. **Exposure** for the Service III tension limit: default to "moderate corrosion"
   (0.19 λ √f′c ≤ 0.6 ksi)?

## Later phases (not in Phase 1)

- **Phase 2**:
  - refined losses (5.9.3.4), then γLL = 1.0 for Service III;
  - harped and debonded strands, with transfer and development lengths (5.9.4.3);
  - the longitudinal reinforcement check (5.7.3.5);
  - optional live load deflection (2.5.2.6.2).
- **Phase 3**: multi-span made continuous:
  - continuity diaphragms and negative-moment deck rebars;
  - dual trucks for negative moment (3.6.1.3.1);
  - the positive moment connection (5.12.3.3);
  - restraint moments as an option.
- **Out**: load rating; reading inputs from plan sheets.
