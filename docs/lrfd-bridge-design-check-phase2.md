# LRFD Bridge Design Check — Phase 2 spec (built)

Phase 2 makes the girder check usable for real long spans. Phase 1 needed temporary top strands to
pass release: with harped or debonded strands they are no longer needed, and refined losses lift the
Service III limit to its real value. Still simple spans; continuity is Phase 3. AASHTO LRFD 9th
edition, US units. Approved and built; see Status at the end.

## 1. Refined losses (5.9.3.4)

- A **Losses** choice:
  - Approximate (5.9.3.3, as now);
  - Refined (5.9.3.4), the new default.
- Refined, in two stages:
  - transfer to deck placement: shrinkage, creep and relaxation of the girder (ΔfpSR, ΔfpCR,
    ΔfpR1);
  - deck placement to final: ΔfpSD, ΔfpCD, ΔfpR2, and the deck's shrinkage gain ΔfpSS.
- New inputs:
  - the age at deck placement (already there) and the final age;
  - the deck's shrinkage strain, if it isn't left to the 5.4.2.3.3 default.
- The creep and shrinkage factors (ks, khs, khc, kf, ktd) come from 5.4.2.3. Most are shared with
  the Phase 1 camber.
- With refined losses, elastic gains from the deck and superimposed loads (5.9.3.2.3a / C5.9.3.4)
  can be counted, as an option that is off by default. With refined losses, Service III uses
  γLL = 1.0 (Table 3.4.1-4).
- The losses table shows each component at transfer, at deck placement and at final.

## 2. Harped strands

- Strands are entered in two groups:
  - **Straight:** rows as now, plus optional debonding (§3).
  - **Harped:** count, height at the girder ends, height at the harp points, and the harp point
    location (default 0.4L from each end, as in PGSuper's WSDOT girders).
- At every station, eccentricity and Aps follow the strand profile. Vp (the harped strands' vertical
  component) enters shear: Vn, εs and vu (5.7.3.3, 5.7.3.4.2).
- Release and service stresses are checked at the harp points and at the girder ends as well as the
  tenth points.
- Hold-down force and strand slope limits are PCI/WSDOT practice, not AASHTO, so they are left out
  (they could be optional owner limits later).

## 3. Debonded strands

- Per straight row, choose how many strands are debonded and for what length from each end.
- At each section, strands count only once bonded. Transfer and development lengths are measured
  from the bond start. For debonded strands κ = 2.0 (5.9.4.3.2).
- The debonding limits are checked per 5.9.4.3.3, cross-checked against PGSuper's built-in AASHTO
  criteria:
  - total debonded strands ≤ 25%; per row ≤ 45%;
  - strands terminated per section ≤ 4 (≤ 6 above 10 strands);
  - debonded length ≥ 60 db;
  - symmetric debonding;
  - no debonding in adjacent strands;
  - outermost strands in each row fully bonded.
- Shear resistance at sections in debonded regions: AASHTO's φ for those sections (PGSuper uses
  0.85) is to be confirmed against 5.5.4.2 before it is applied.

## 4. Longitudinal reinforcement for shear (5.7.3.5)

- Checked at every station from the face of the bearing to midspan: the bonded strands' (and any
  bars') tensile capacity, with the reduced stress within the development length, against the
  demand of Eq. 5.7.3.5-1.
- At the inside edge of the bearing area of a simple support: Eq. 5.7.3.5-2.
- New input: optional bottom bars (count, size), in case strands alone fall short.

## 5. Live load deflection (2.5.2.6.2, optional)

- Off by default. AASHTO makes this limit optional; owners such as WSDOT turn it on.
- Load: the design truck alone, or 25% of the truck plus the lane load (3.6.1.3.2), all lanes loaded
  with multiple presence. The load is shared equally by all girders.
- Section: the full composite stiffness.
- Limit: L/800 (L/1000 with pedestrians).

## 6. What else changes

- **Default example:** BT-72, 120 ft, with harped strands, no top strands, f′ci back near 6.5 ksi.
  It passes on refined losses with γLL = 1.0, as such girders are really designed.
- **Camber:**
  - adds the harped strands' contribution (two-point drape);
  - computes debonded strands over their bonded length;
  - with refined losses, takes the force at deck placement from the loss stages.
- **Calc package:** a refined-loss worksheet section, a strand profile table, the harped- and
  debonded-strand terms, and the 5.7.3.5 check.
- **Sketch:** an elevation of the strand profile (harp points, debond lengths) next to the
  cross-section.

## Validation

- **PGSuper benchmarks**, the same method as Phase 1, with fixtures added to
  `pgsuper-benchmarks.json`:
  1. A WF girder with harped strands (WSDOT template grid, harp points 0.4L): eccentricity profile,
     Vp, release stresses at the end and the harp point, Mn, and shear with Vp.
  2. A WF girder with debonded straight strands: bonded Aps along the span, development length
     with κ = 2.0, the debonding limit checks, and shear and 5.7.3.5 near the ends.
  3. Refined losses. PGSuper's test mode crashed on the AASHTO 2005 refined method in Phase 1.
     I'll try it again with the bridge fully defined. If it still crashes, I compare component by
     component against WSDOT's refined method (its only difference is the initial relaxation,
     which can be backed out).
- **Hand checks:**
  - FHWA NHI-04-043's refined loss steps (its 5.9.3.4 arithmetic, with the 2005 interim
    equations: the same form as the 9th edition);
  - closed-form strand profile and Vp.
- **Tolerances:** as in Phase 1. Losses within 5% per component and 3% in total.

## Order and effort

1. Strand model (harped, debonded) with transfer and development by strand group, plus the profile
   sketch. **Largest piece; everything else rests on it.**
2. Harped strands through stresses, flexure and shear (Vp), and the PGSuper harped benchmark.
3. Debonding, its limits, the PGSuper debonded benchmark.
4. Refined losses, γLL = 1.0, the loss benchmark.
5. Longitudinal reinforcement (5.7.3.5).
6. Live load deflection, the camber update, and the calc package sections.

Each step ends with its tests passing and the app checked. Overall Phase 2 is about the size of
Phase 1.

## Decisions for you

1. Refined losses as the **default**, with approximate still selectable (recommended)? Or keep
   approximate as the default?
2. Live load deflection: off by default (AASHTO optional), or on with L/800?
3. Debonding: per-row "N strands debonded for length X" (simple, recommended), or strand-by-strand
   like PGSuper's grid?
4. Keep the Phase 1 tool's saved designs working unchanged? Their strand rows become straight
   strands; approximate losses stay selected for them (recommended).

## Status (built, 2026-11-05)

- Decisions taken: refined losses by default (approximate selectable); LL deflection off by
  default; debonding per row; Phase 1 designs open with approximate losses and straight strands.
- **One change from this spec:** elastic gains are **on** by default, not off. Table 3.4.1-4 gives
  γLL = 1.0 at Service III only when refined losses are used *with* elastic gains; otherwise 0.8.
  Turning gains off returns γLL to 0.8.
- φv = 0.85 in debonded regions (5.5.4.2, 8th edition on) was confirmed and is applied.
- ΔfpES takes fcgp at midspan (5.9.3.2.3a), one value for the girder; PGSuper computes it section
  by section, so release stresses near the ends differ by up to about 3%.
- Validated against PGSuper 9.0.4 on four WSDOT WF bridges (straight, short span, 8 harped,
  6 debonded), 216 checks within the stated tolerances (`pgsuper-benchmark.test.ts`):
  - moments, Mu and Vu within 0.5%; Mn conservative, within 4% (approximate fps);
  - dv 1%, β 4%, θ 1.5%, Vc 4%, Vs 2%, Vp 3%, Vn 3%;
  - prestress at release 3%; ΔfpES 3%; total refined loss within 2% (with WSDOT's ΔfpR0 added
    and ΔfpSS left out, as PGSuper was set).
- The calc package evaluates in Calcs and matches the engine to 1e-5 on four bridges.
- Not in Phase 2: continuity (Phase 3), rating, temporary strands, strain-compatibility Mn.
