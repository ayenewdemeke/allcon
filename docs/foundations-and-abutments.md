# Foundations and abutments (Foundations → Spread Footing, Pile Foundation, Drilled Shaft; Substructures → Abutment)

Four tools that carry a highway bridge from its bearings to the ground: a spread footing, a group of
driven H-piles under a cap, a drilled shaft, and the abutment itself (integral on H-piles or drilled
shafts, semi-integral, or seat type). Designed by AASHTO LRFD (10th Edition, 2024) with the CDOT
Bridge Design Manual (BDM, April 2025) where it adds to AASHTO, and the FHWA NHI reference manuals
for the methods AASHTO leaves to "accepted soil mechanics". Each has its checks with references, a
calc package in the owner's style, its bars detailed with a schedule, and CDOT quantities.

## Sources

- AASHTO LRFD 10th: 3.11.5 (earth pressure), 3.11.6.4 (live load surcharge), 3.12 (TU), 4.6.2.5
  (effective length), 5.6.3, 5.6.4, 5.7.3.3, 5.10.8, 5.12.8 (footings: 5.12.8.4 moment, 5.12.8.6
  shear, 5.12.8.8 transfer at the column), 6.5.4.2 (pile φ), 6.9.2.2 (axial with flexure), 6.9.4.1,
  6.12.2.2 (H-shape flexure), 6.15 (piles), 10.5.5.2 (resistance factors), 10.6.3.1.2a (bearing),
  10.6.3.3 (eccentricity), 10.6.3.4 (sliding), 10.6.2.4 (settlement), 10.7.1.2 (spacing, embedment),
  10.7.2.4 (horizontal movement, p-multipliers Table 10.7.2.4-1), 10.7.3.13 (pile structural
  resistance), 10.8.3.5 (drilled shaft side and tip resistance), 10.8.3.9 (shaft reinforcement),
  11.6 (abutments).
- CDOT BDM: 10.3.3 (extreme event φ 1.0, uplift ≤ 0.80), 10.4.2 (footing embedment ≥ 3 ft), 10.4.3
  (angular distortion 0.008 / 0.004), 10.5.1.1 (HP 12x53, 12x74, 14x89, Grade 50), 10.5.2.1 (soft
  or hard rock by penetration), 10.5.2.2 (groups of 3 or fewer piles: φ × 0.8), 10.5.3 (fixed pile
  head: Table 10-1 embedment 20/24/26 in), 10.6.1.1 (shafts ≥ 24 in, L/D < 25), 10.6.2.1 (claystone
  φ 0.60), 11.3 (abutment loads: half the approach slab's dead load on the cap, IM in the cap but not
  the foundation, foundation elements ≥ 10 ft below the cap), 11.3.1 (integral: unit length,
  movement ≤ 2 in, single row of piles, weak axis along the abutment, prebore of d + 1 ft with pea
  gravel k = 300 pci, φ = 40°, γ = 95 pcf, depth ≤ 13 ft, cap 3.5–6 ft, skew ≤ 30°, grade ≤ 5%),
  11.3.2 (semi-integral), 11.3.3 (seat type).
- FHWA NHI-06-089, Soils and Foundations Reference Manual Vol. II (2006), Ch. 8: the bearing
  equation with its correction factors (Eq. 8-6, Tables 8-2, 8-4, 8-5, 8-6), effective footing
  dimensions (Eqs. 8-7 to 8-9), Schmertmann's method (Eqs. 8-16 to 8-18, Fig. 8-21), Examples 8-1
  and 8-2 (the validation cases).
- FHWA GEC 6, Shallow Foundations (FHWA-SA-02-054): the footing design process and sliding.
- FHWA GEC 9, Laterally Loaded Deep Foundations (FHWA-HIF-18-031): the p–y method and its curves
  (API sand, Matlock soft clay, Reese stiff clay above water, Reese weak rock).
- FHWA GEC 10, Drilled Shafts (FHWA-NHI-18-024) and GEC 12, Driven Piles (FHWA-NHI-16-009).
- AISC Shapes Database v16 (the repo's table) for the HP sections.

## Shared engine (src/lib/design/foundations/)

- `soil.ts`: soil layers (sand, soft clay, stiff clay, weak rock, or a linear spring), unit weights,
  water table, effective stress.
- `lateral.ts`: a laterally loaded pile or shaft by the p–y method: finite differences on the beam
  equation EI y'''' + Q y'' + p(y) = 0 (Reese), nonlinear springs iterated to convergence, head
  conditions free (V, M), fixed (V, θ = 0) or an imposed displacement with θ = 0 (an integral
  abutment's thermal movement), group p-multipliers, axial load for P–Δ. It gives deflection,
  slope, moment, shear and soil reaction with depth, the depth to the first zero deflection and the
  largest moment. Checked against the closed form of a long elastic pile on linear springs (Hetényi).
- `hpile.ts`: HP sections (AISC v16), axial resistance (6.9.4.1, λ = 0 fully embedded, or by the
  unsupported length plus depth to fixity), flexural resistance about either axis (6.12.2.2), the
  interaction of 6.9.2.2 with φc = 0.70 and φf = 1.00 (6.15.2), φc = 0.50 / 0.60 axial only.

## Spread Footing

Inputs: a column (rectangular or round) or wall on a rectangular footing; thickness, embedment,
bars both ways; load cases at the top of the footing (P, Mx, My, Hx, Hy) as Strength, Service or
Extreme Event; soil above and below, water table; bearing either computed (AASHTO 10.6.3.1.2a /
NHI Eq. 8-6: c, φ, Nc Nq Nγ, shape, water, optional depth factor; φb 0.45–0.50) or entered (rock or
a geotechnical report's nominal resistance); sliding (cast-in-place on sand φτ 0.80, clay 0.85);
settlement by Schmertmann (layers with E, or E from N160 per the NHI table) against a tolerable
value.

Checks: embedment ≥ 3 ft (BDM 10.4.2); eccentricity ≤ B/3 soil, 0.45B rock (10.6.3.3); bearing on
the effective area B′L′ (Strength); sliding (10.6.3.4); settlement (Service I); flexure at the
column face each way (5.12.8.4, bars banded in a rectangular footing), minimum (5.6.3.3), crack
control (5.6.7), one-way shear at dv (5.12.8.6.2 / 5.7.3.3 simplified β = 2), two-way punching
(5.12.8.6.3), development from the critical section (5.10.8.2.1), bearing at the column
(5.6.5). Quantities: 601-03040, 602-00020, 206-00000 / 206-00100 by M-206-1 limits.

## Pile Foundation

Inputs: an H-pile (CDOT's HP 12x53, 12x74, 14x89 and the other HP sizes) in a grid under a
rectangular cap, strong or weak axis along X, driven to soft or hard rock or a friction pile, the
nominal geotechnical resistance per pile from the report and its φ (dynamic testing 0.65), uplift
resistance; the soil profile for lateral analysis; load cases at the top of the cap.

Checks: spacing ≥ 30 in and 2.5 d (10.7.1.2), cover and embedment (BDM 10.5.3 fixity: 20/24/26 in),
pile reactions on a rigid cap (P/n ± M·x/Σx²), geotechnical axial (φ × 0.8 for ≤ 3 piles, BDM
10.5.2.2), uplift, structural axial (6.15.3.1), lateral: the most loaded pile's p–y analysis with
the row's p-multiplier and a fixed head, its deflection against a tolerable value and its moment in
the 6.9.2.2 interaction, the depth to fixity; the cap: flexure at the column face from the pile
reactions, one-way shear, punching at the column and at a corner pile. Quantities: 502-112xx /
502-114xx Steel Piling by section (LF), 502-00460 Pile Tip, 601-03040, 602-00020, 206 excavation.

## Drilled Shaft

Inputs: diameter, length, cover, bars and ties or spiral; layers (clay by α with Su, sand by β with
N60, rock by qu, or qs and qp entered from the report, e.g. CDOT's claystone method); load cases at
the top. Checks: diameter ≥ 24 in and L/D (BDM 10.6.1.1), side and tip resistance (10.8.3.5, top
5 ft and the bottom D in clay not counted), uplift, lateral p–y (deflection, moment and shear along
it), P–M by strain compatibility at the largest moment (5.6.4.5, the column tool's section), shear
(5.7.3.3), reinforcement limits (5.6.4.2, 10.8.3.9). Quantities: 503-000xx by diameter (LF),
503-00310 CSL tubes and testing (non-redundant shafts, BDM 10.6.3.2), 602-00000 cage.

## Micropile

Inputs: the composite section (casing OD, wall and Fy, area lost at its threads; the core threadbar
and its fy; grout f'c; the drill hole), the cased, plunge and bond lengths, any unsupported length,
the ground in the bond zone and the grouting type (A–E), αb (the table's lower bound, or a load
test's value), φ, the soil for the lateral analysis, load cases per micropile (compression, tension,
shear). Checks: spacing (30 in or three holes, AASHTO 10.9.1.2) and embedment; grout-to-ground bond
in compression and tension, Rs = π·db·αb·Lb (AASHTO 10.9.3.5.2, Table C10.9.3.5.2-1 after FHWA
NHI-05-039), φ 0.55 presumptive or up to 0.70 load tested (Table 10.5.5.2.5-1), tip on rock optional;
the cased length in compression 0.85·(0.85·f'c·Ag + fy·(Ab + Ac)) and tension fy·(Ab + Act), the
uncased length 0.85·(0.85·f'c·Ag + fy·Ab) and fy·Ab (10.9.3.10.2–3, φ 0.75 and 0.80, Table
10.5.5.2.5-2), steel at most 87 ksi for strain compatibility (C10.9.3.10.2a, FHWA-SA-97-070 5.E.7),
the plunge length's transfer (10.9.3.10.4, FHWA-SA-97-070 5.E.6); lateral by p–y with the casing's
axial and flexure and buckling with an unsupported length (10.9.3.10.6, FHWA-SA-97-070 5.F.5); the
elastic shortening P·L/(A·E) at the Service load (FHWA-SA-97-070 5.F.1). Quantities: 503-010x0
Micropile (by diameter, LF). References: AASHTO 10.9; FHWA NHI-05-039 (2005) and FHWA-SA-97-070
(1997, Ch. 5); Caltrans Geotechnical Manual, Micropiles (2021).

## Abutment

Types (BDM 11.3): integral on one row of H-piles (CDOT's preferred) or on drilled shafts with a pin;
semi-integral (bearings on the cap, cap fixed to its foundation); seat type (backwall and stem on a
footing or piles). Inputs: the bridge (span lengths and unit length, girders, reactions DC, DW, LL
with and without IM, braking), the abutment's geometry, the approach slab, backfill, temperature
range and CDOT's creep and shrinkage, the foundation (from the three tools' engines).

Checks, integral: unit length (Table 11-1), factored movement ≤ 2 in, grade ≤ 5%, skew ≤ 30°,
depth ≤ 13 ft, cap 3.5–6 ft, pile embedment and single row, weak axis along the abutment; each pile
under the girder reactions and the imposed thermal displacement (p–y with an imposed head
displacement, prebore with pea gravel), its 6.9.2.2 interaction, depth to fixity and buckling
(10.7.3.13.4), geotechnical axial; the cap as a continuous beam over the piles (flexure, shear),
the backwall and cap under passive pressure. Semi-integral and seat: stability on its footing or
piles (bearing, sliding, eccentricity as the footing tool), the stem and backwall in flexure and
shear under earth pressure (3.11.5), live load surcharge (3.11.6.4) and the bridge's forces, the
bearing seat width (4.7.4.4). Quantities: abutment concrete 601-03040, 602-00020, piles or shafts,
206 excavation and backfill.

## Validation

- Bearing: NHI-06-089 Example 8-1 (qult = 13,425 psf; 12,414 psf with water at the base).
- Settlement: NHI-06-089 Example 8-2 (Si = 0.130 in at the end of construction).
- p–y: a long elastic pile on linear springs against Hetényi's closed form (free head
  y0 = 2Hβ/k + 2Mβ²/k), and each p–y curve against its defining equations at sample points.
- Piles: hand checks of 6.9.4.1 and 6.9.2.2 for an HP 12x53.
- Shaft: AASHTO's α, β and rock equations at sample values.

## Where CDOT differs from AASHTO

- Small pile groups: φ × 0.8 is AASHTO's commentary (C10.5.5.2.3) made a requirement (BDM 10.5.2.2).
- Uplift at the extreme event: φ ≤ 0.80 (BDM 10.3.3), AASHTO 1.0.
- Drilled shafts may be smaller than the columns on them (BDM 10.6.1.1), unlike AASHTO 10.8.1.3.
- Claystone: CDOT's φ 0.60 for the Abu-Hejleh method (BDM 10.6.2.1); its qs and qp are entered.
- No expansion joints in abutments (BDM 11.3), unlike AASHTO 11.6.1.6.
- The integral abutment rules (BDM 11.3.1) are CDOT's; AASHTO leaves them to the owner.
