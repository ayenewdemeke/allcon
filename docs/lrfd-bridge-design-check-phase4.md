# LRFD Bridge Design Check — Phase 4 spec (built)

Phase 4 adds PGSuper's specification checks that the tool doesn't do yet. With them, the tool's
design check covers what PGSuper's does for a precast prestressed girder. AASHTO LRFD 9th edition,
US units. Approved with the recommended choices and built; see Status at the end.

Sources for how PGSuper does each check: its Technical Guide, installed with BridgeLink
(`Docs\PGSuper\9.0`: tg_splitting_zone_checks, tg_fatigue, tg_principal_tensile_stress,
tg_stability), and BEToolbox's PGStable help for lifting and hauling.

> As in Phase 3, a few details below are to be confirmed against the 9th edition text before
> building; they are marked "to confirm".

## 1. Splitting resistance (5.9.4.4.1)

- **Check:** Pr = fs·As ≥ 4% of the prestressing force before transfer, Fpi.
- **fs:** at most 20 ksi.
- **As:** the vertical reinforcement within h/4 of the girder's end, where h is the girder's depth.
  - PGSuper's method: sum, over the stirrup zones inside h/4, legs × bar area × length in the zone /
    spacing.
  - So the tool's existing stirrup zones give As; there is no new input.
- **Where:** at both ends of every span.
- **To confirm:** whether Fpi is taken at jacking or just before transfer (after relaxation). I'll
  match PGSuper.
- WSDOT practice deviates from this article (a 2001 design memo); the tool follows AASHTO.

## 2. Confinement reinforcement (5.9.4.4.2)

- **Check:** bars of at least #3, at no more than 6 in, for at least 1.5d from each end, enclosing
  the strands in the bottom flange.
- **New inputs:** confinement bar size, spacing and zone length.
  - Defaults: #3 at 6 in over 1.5d, which passes.
- **Sketch:** the confinement zone is shown on the girder elevation.

## 3. Fatigue I compression (5.5.3.1)

- **Check:** the compressive stress from the Fatigue I load, plus half the sum of the effective
  prestress and permanent loads, ≤ 0.40 f′c.
- **Fatigue load (3.6.1.4):**
  - one design truck, its rear axles at a fixed 30 ft, IM 15%, load factor 1.75 (Table 3.4.1-1);
  - the single-lane distribution factor without the multiple presence factor (3.6.1.4.3b);
  - on continuous bridges, run on the influence lines of the Phase 3 engine.
- **Section properties:** uncracked, as PGSuper. AASHTO asks for cracked properties where the
  tension exceeds 0.095√f′c; at the deck and the top of the girder near the piers this can differ.
  To limit that, I'd flag any section where it applies.
- **Strand fatigue:** need not be checked for members within the Service III tension limit
  (5.5.3.1). The tool states this, and checks it only if that tension limit fails.

## 4. Principal tension in the webs (5.9.2.3.3)

- **Applies to:** pretensioned girders with f′c over 10 ksi only. Below that, the check is listed as
  "not required".
- **Check:** the principal tensile stress at Service III ≤ 0.110λ√f′c.
- **Method:** the LRFD equations, 5.9.2.3.3. PGSuper also offers NCHRP Report 849's method (see
  Decision 3).
  - Shear stress: the total Service III shear on the composite section (5.9.2.3.3-1).
  - Axial stress: at the web elevation being checked, from the moment that gives the most tension on
    that side of the centroid.
  - Like PGSuper, the maximum shear and that moment are taken together, though they may not occur
    together (conservative).
- **Where:** at every station, at the web elevations PGSuper checks (the top and bottom of the web
  and the centroid; to confirm), with the debonded and transfer regions included.

## 5. Lifting and hauling stability (5.5.4.3)

The 9th edition made this check mandatory. Following PGSuper, the method is PCI's *Recommended
Practice for Lateral Stability of Precast, Prestressed Concrete Bridge Girders* (CB-02-16-E), from
Mast's papers.

**Lifting from the form**
- **Inputs:**
  - lift point distance from each end;
  - f′c at lifting (the release strength by default);
  - impact up and down;
  - sweep tolerance;
  - lift point placement tolerance;
  - wind pressure.
- **Results:**
  - stresses at the top and bottom flange corners, with tilt and lateral bending, against the
    release stress limits;
  - factor of safety against cracking (≥ 1.0) and against failure (≥ 1.5).

**Hauling to the site** (WSDOT method)
- **Inputs:**
  - support (bunk) locations;
  - f′c at hauling;
  - the truck's roll stiffness;
  - roll center height;
  - height of the girder above the road;
  - wheel spacing;
  - superelevation;
  - turning radius and speed (centrifugal force);
  - impact;
  - sweep;
  - wind.
- **Cases, as WSDOT and PGSuper check them:**
  1. stresses under normal hauling, with impact;
  2. stresses at slow speed on a superelevated road;
  3. stability at slow speed on a superelevated road: factor of safety against cracking (≥ 1.0)
     and against rollover (≥ 1.5).
- Camber, including its effect on the center of gravity, comes from the existing camber results.
- **Defaults:** PGSuper's WSDOT library values (read from its configuration, read-only).
- **Results UI:** a "Handling" view next to the span and pier views. The sketch shows the girder on
  its lift points and on the truck.
- **Calc package:** a lifting section and a hauling section, worked step by step as in PCI's
  examples.

## 6. What else changes

- **Checks list:** the new checks join the summary, with their articles.
- **Calc package:** a section per check. Splitting, confinement and fatigue are short; principal
  tension shows the governing station; lifting and hauling are worked fully.
- **Saved designs:** old designs open with the new inputs at their defaults.

## Validation

- **PGSuper**, on the existing benchmark bridges (Phases 1–3):
  - splitting, Fatigue I and principal tension, from its test mode output if it writes them, or
    else from its spec check report;
  - one bridge set to f′c above 10 ksi, for principal tension.
- **PGStable** (BEToolbox, installed with BridgeLink) for lifting and hauling: the same girder, and
  every factor of safety and stress compared.
- **PCI CB-02-16 worked examples** for lifting and hauling, as a second source.
- **Hand checks:**
  - splitting As from the stirrup zones;
  - the fatigue truck on a simple span by closed form.
- **Tolerances:** 0.5% on actions and stresses; 1% on the factors of safety.

## Order and effort

1. Splitting and confinement. **Small.**
2. Fatigue I: the fatigue truck in the engine, and the check. **Small to medium.**
3. Principal tension. **Medium.**
4. Lifting and hauling, with the Handling view and its calc sections. **Largest piece**, about the
   size of Phase 2.

Each step ends with its tests passing and the app checked. All of Phase 4 is about the size of
Phase 3, most of it in step 4.

## Not in Phase 4

- **Strand slope and hold-down force:** PCI/WSDOT practice, not AASHTO, so left out under the house
  rule unless you want them.
- **Automatic design** of strands and f′c (PGSuper's "Design" command): a possible Phase 5.
- **Load rating** (LRFR), time-step analysis and temporary strands.

## Decisions for you

1. **Scope:** all four steps (recommended); or steps 1–3 now and lifting and hauling later.
2. **Hauling method:** WSDOT (recommended; it checks stability, as 5.5.4.3 requires); or KDOT's,
   which checks stresses only.
3. **Principal tension method:** the LRFD equations (recommended, the code's own); or NCHRP 849's,
   which sums the girder's and the composite section's shear stresses separately.
4. **Lifting and hauling defaults:** PGSuper's WSDOT values (recommended); or values you supply.

## Status (built, 2026-11-06)

Decisions taken: all four steps; WSDOT's hauling method; the LRFD principal tension method; PGSuper's
WSDOT values as defaults.

**Built**
- `stability.ts`: lifting and hauling by PCI's method, following WSDOT's WBFL Stability library (used
  by PGSuper and PGStable) equation by equation: impact up and down, wind both ways, the sweep and
  placement eccentricities, camber, inclined lifting cables, the normal crown and maximum
  superelevation, centrifugal force; factors of safety against cracking, failure and rollover.
- Checks added to every span and girder:
  - Fatigue I (`fatigue`): the fatigue truck in the simple-span and continuous analyses, one-lane DF
    ÷ 1.2, at the girder's top (and its bottom near piers);
  - principal tension (`principal`), f′c over 10 ksi only, at PGSuper's web elevations (top and
    bottom of the web, the fillets' ends, both centroids);
  - splitting (`splitting`) and confinement (`conf-bar`, `conf-spacing`, `conf-length`);
  - lifting (`lift-…`: FS cracking ≥ 1.0, FS failure ≥ 1.5, 0.65 f′ci plumb, 0.70 f′ci tilted,
    tension) and hauling (`haul-…`: FS cracking, failure and rollover for both slopes, 0.65/0.70 f′c,
    tension on the crown and at superelevation, and the truck's span, overhang and weight).
- Inputs: confinement bars; a "Lifting and hauling" section with WSDOT's six haul trucks (HT40-72 to
  HT80-96) to pick from.
- Results: an "Anchorage zone and fatigue" card; a lifting and hauling card with a sketch (the girder
  on its lifting devices and on the truck, and the section tilted on the truck's roll center).
- Calc package: fatigue at midspan, principal tension at its largest, the anchorage zone, and lifting
  and hauling worked out without impact or wind (Calcs evaluates them; they match the engine), with
  every case's minimum from the engine.

**Changes to the default example** (saved designs keep their own inputs): 4 harped strands instead of
8, a first stirrup zone of #5 pairs at 3.5 in for 1.5 ft (splitting), the HT60-72 truck, and the
girder hauled at 10 days (WSDOT's). With 8 harped strands the 121.5 ft BT-72 fails hauling at 6%
superelevation (top flange tension 0.85 ksi against 0.70 ksi), as PGSuper's criteria would also show.

**Validation**
- PCI CB-02-16 examples 6.1.1–6.1.4 (lifting, with impact, wind and inclined cables) and 6.2.1–6.2.2
  (hauling, with centrifugal force): every value WSDOT's own unit tests assert, to 0.001
  (`stability.test.ts`).
- PGSuper 9.0.4 on the four single-span benchmark girders (`pgsuper-handling.test.ts`), from its test
  mode output (codes 100001–100013, 100220–100249):
  - lifting and hauling factors of safety within 1% (cracking within 2%), stresses within 2%;
  - splitting force within 1.5%; splitting resistance exact from PGSuper's own stirrup zones; the
    confinement length 1.5d exact.
- PGSuper principal tension on the harped WF74G with f′c = 10.5 ksi (`pgsuper-principal.test.ts`):
  within 8% (0.01 ksi) at the tenth points.
- Hand checks (`phase4.test.ts`): the fatigue truck at midspan (1,624 kip·ft per lane on 120 ft), the
  Fatigue I stress, splitting As, the overhang moments.

**Differences from PGSuper, kept**
- PGSuper adds the strands' relaxation before transfer (about 2 ksi, not in the 9th edition's refined
  method), so at handling the tool's prestress is about 1% higher and its stresses up to about 2% more
  compressive.
- Splitting: Fpi is the bonded strands' force just after transfer, as PGSuper; AASHTO's wording is
  "immediately before transfer" (about 7% more).
- Principal tension: the shear stress differs by up to about 5% (PGSuper's Service III shear envelope).
- Fatigue I uses uncracked sections, as PGSuper (AASHTO asks for cracked ones where tension exceeds
  0.095√f′c); the check notes when Service III tension exceeds its limit, so strand fatigue needs a look.

**AASHTO Type IV against PGSuper (2026-11-06), `pgsuper-typeiv.test.ts`, 112 checks.** PGSuper's
installed libraries have no AASHTO-PCI bulb-tees or CDOT CBTs, but TxDOT's has the AASHTO Type IV.
Its dimensions went into WSDOT's WF58G benchmark project (the same plain-AASHTO setup as the WF
benchmarks), with TxDOT's straight strand grid and a two-point harped grid in the web. Two 90 ft
bridges: 28 straight strands, and 20 straight with 6 harped. The tool ran its own library outline
(`aashto-iv`, without PGSuper's ¾ in bottom corner chamfers). Largest differences:
- dead load, live load, Mu and Vu: 0.07% or less (the girder weight's 0.07% is the chamfers);
- Vn 0.8%; prestress at release 2.3%; φMn 3.1% low (conservative, as on the WF girders);
- lifting and hauling factors of safety within 1%; splitting force within 1.1%.
Every library girder also runs every check without errors (`phase4.test.ts`).