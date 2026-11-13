# Pier Column (Design → Substructures)

A pier column under its cap, AASHTO LRFD 10th Edition. Kind `pier-column`; code in
`lib/design/piers/column*.ts`, editor `components/design/column-editor.tsx`.

- **Section** (`column-section.ts`): round, rectangular or oblong (half-round ends along the long
  side across the bridge). The concrete is modeled as fibers and the bars as points. Strain
  compatibility uses the rectangular stress block (5.6.2), εcu = 0.003, with bars elastic–plastic.
  φ comes from the net tensile strain (5.5.4.2). For biaxial bending, the neutral axis is turned
  until the resisting moment points the way the demand does (5.6.4.5). Axial resistance is capped
  at φ·0.85/0.80·P0 (5.6.4.4).
- **Loads from a pier cap's strut-and-tie design** (`column-link.ts`, action `pierCapLink`):
  - The cap's factored load cases are copied, every one, both ways a hammerhead turns. The
    cap's geometry comes too.
  - Data from the girder designs:
    - span lengths;
    - lanes and braking (3.6.4);
    - superstructure wind line loads (3.8.1.2).
  - The bent is analyzed as a plane frame (`frame2d.ts`): the cap is a beam on its columns,
    fixed at a footing or on a drilled shaft to its point of fixity, with gross stiffness and a
    rigid joint.
  - Wind on the column itself uses CD 1.6 (3.8.1.2.3b).
  - Loads can also be entered at the column's top instead.
- **Along the bridge, at the bearings, shared equally by the bent's columns:**
  - At a fixed pier, its share of the braking (with the live load's factor) and of the wind:
    WS (3.8.1.2.3a) is 25% of the transverse for the usual girder bridge (span ≤ 150 ft,
    Z ≤ 33 ft). Otherwise it is the girders' largest longitudinal coefficient, 0.38, with the
    full transverse, which is an upper bound. WL is 0.04 klf.
  - TU at a fixed pier is the column's stiffness, 3EI/h³ with EI = 0.4 EcIg, times α ΔT x.
  - An expansion pier takes only the entered bearing force, times γTU.
- **Slenderness:** K ℓu / r (5.6.4.3); neglected below 22, and the approximate method is limited
  to below 100. δs = 1/(1 − ΣPu/(0.75 ΣPe)) over the bent, with EI from Eqs. 5.6.4.3-1/-2 divided
  by 1 + βd. It is applied to the whole moment, each direction.
- **Other checks:**
  - shear in each direction (5.7.3.3, β = 2), 5.7.2.5 and 5.7.2.6;
  - bar limits (5.6.4.2) and clear spacing (5.10.3.1.1);
  - ties (5.10.4.3) or spiral (5.6.4.6, 5.10.4.2).
- **Spiral or tied:** a spiral short of Eq. 5.6.4.6-1's volumetric ratio is a continuously wound
  tie, so the column is designed as tied (0.80 φ P0, Eq. 5.6.4.4-3). This shows as an advisory,
  not a failure.
- **Restrained bars (5.10.4.3, 9th edition on):** for rectangular and oblong ties, the
  restrained bars on each face are no more than 24 in apart along the tie. The tie's corners
  and the cross-tie legs (spread evenly over the face's bars) restrain them. Legs running along
  the bridge restrain the faces across it, and the other way round. An oblong column's round
  ends are restrained by the curved tie.
- **Seismic Zone 1, SD1 ≥ 0.10 (5.11.2), a toggle:**
  - Hinge regions run from each end for the larger of the column's largest dimension, its clear
    height ÷ 6 and 18 in (5.11.4.1.3). The base region also covers the lap splices.
  - Spacing is at most a quarter of the least dimension or 4 in (5.11.4.1.5).
  - Confinement: ρs per Eq. 5.11.4.1.4-1, or Ash per Eqs. 5.11.4.1.4-2/-3 in each direction.
  - The detailing extends the closer spacing max(D/2, 15 in) into the cap and footing
    (5.11.4.3).
- **Collision toggle** (3.6.5.1, Extreme Event II):
  - 600 kip at both 2.0 and 5.0 ft above the ground (whichever is critical), at 0° and 15° to
    the roadway below. Shear is taken between the base and the impact.
  - A column at least 3.0 ft thick with more than 30 ft² of section is exempt (3.6.5.1 item 2);
    the checks are then shown as advisory.
  - Across the bridge it is applied to the bent frame, with each column struck in turn; along
    the bridge each column is a cantilever.
  - The permanent loads are taken at 1.25 and 0.90, and φ = 1.0.
- **Details and quantities** (`column-detail.ts`, `TAKEOFF_KINDS`):
  - The column bars hook into the cap and lap the footing dowels (hooked) or the shaft's bars
    (Class B).
  - Spiral: 1.5 extra turns each end, lapped 72 db. Ties: closed with 135° hooks, plus
    cross-ties.
  - Pay items: 601-03040 and 602-00020.
  - M-206-2 excavation (206-00000) is a frustum around each column, 1'-6" wider at the ground;
    the excavation less the column is Class 2 backfill (206-00200). A pier cap's STM quantities
    no longer carry it.
