# LRFD Bridge Design Check — Phase 3 spec (built)

Phase 3 adds multi-span bridges of precast girders made continuous for loads applied after a
cast-in-place continuity diaphragm (AASHTO LRFD 5.12.3.3). This is the most common way long
prestressed girder bridges are built. AASHTO LRFD 9th edition, US units. Approved and built; see
Status at the end.

> Article numbers below the 5.12.3.3 level are to be confirmed against the 9th edition text before
> building. Recent editions changed this article (see §4), and I could not read the 9th edition
> wording online.

## 1. Bridge layout

- **Spans:** 1 to 5, each with its own length. A single span works exactly as in Phase 2, so saved
  designs are unchanged.
- **Girder:** one shape and one girder spacing for the whole bridge.
- **Strands:** entered per span, because end spans and interior spans usually differ. A **Same as
  span 1** toggle covers the common case.
- **Continuity:**
  - when it is made: at deck casting (diaphragm cast with the deck: the usual case and the
    default), or after the deck;
  - the girder age when continuity is made (needed for the restraint moments, §4).
- **Interior supports:** continuity diaphragm width, and deck reinforcement over the piers (top and
  bottom mats: bar size and spacing, bars or rebars per the house style).
- **Positive moment connection** at each pier: extended strands, or bent bars (count and size).

## 2. Analysis

- **Method:** a line-girder stiffness analysis of the continuous beam.
  - Stiffness is the uncracked composite section along the full length (4.5.2.2 permits gross
    section properties).
  - Supports are knife-edge at each bearing line; the diaphragm width is neglected.
- **Staging:**
  - On the simple spans: the girder self-weight, plus the deck, haunch and intermediate diaphragms
    when continuity is made at deck casting.
  - On the continuous beam: barriers, overlay and other superimposed dead loads, live load, and the
    restraint moments.
- **Live load (3.6.1.3.1):**
  - HL-93 by influence lines on the continuous beam;
  - between points of contraflexure, for negative moment and the interior pier reactions: 90% of
    two design trucks (at least 50 ft apart, rear axles at 14 ft) plus 90% of the lane load;
  - IM 33% on the truck only (3.6.2.1).
- **Distribution factors (4.6.2.2):** for negative moment and interior reactions, L is the average
  of the two adjacent spans (Table 4.6.2.2.1-2). Positive moment and shear use the span's own
  length.

## 3. Checks

**Positive moment regions (each span):** everything Phase 2 does, with the continuous moments and
shears.

**Negative moment regions (over each pier):**
- **Strength I flexure:**
  - the tension tie is the deck reinforcement;
  - the compression block is in the girder's bottom flange, using the girder's f′c (C5.12.3.3);
  - the prestress is ignored in this check, as strands near the end are not developed.
- **Minimum reinforcement (5.6.3.3):** with Mcr of the composite section, its top in tension.
- **Crack control (5.6.7):** the bar spacing limit in the deck under Service I.
- **Service I compression** in the bottom flange at the diaphragm face.
- **Shear (5.7.3):**
  - near the piers, by the general procedure;
  - εs from the deck bars (5.7.3.4.2) on the flexural tension side;
  - the 5.7.3.5 longitudinal check uses the deck bars at the pier.

**Continuity connection (5.12.3.3):**
- **Restraint moments** at each pier, from creep and shrinkage after continuity (§4).
- **Fully effective joint:** the joint is fully effective if the bottom of the diaphragm is in
  compression under superimposed permanent loads, restraint moments and 50% live load. If it isn't,
  the positive moments are also checked as for simple spans, as AASHTO requires.
- **Positive moment connection:** designed for the positive restraint moment plus its live load
  share; the reinforcement stress at service is kept under the code limit (reported as 36 ksi).

## 4. Restraint moments (the main open question)

- Older editions let restraint moments be neglected when the girders were at least 90 days old at
  continuity, with a positive connection of at least 1.2 Mcr. Recent editions removed this shortcut
  ([TRID 2078697](https://trid.trb.org/View/2078697): "prior to 2021"). The restraint moment must
  now be computed for every pier, whatever the girder age.
- AASHTO gives the method only in commentary, citing two published methods:
  - the PCA method (Freyermuth, 1969);
  - the P-method (Peterman and Ramirez; also NCHRP Report 519).
- **Recommended: the P-method.** It works span by span.
  1. Find the fixed-end moments from the girder creep under prestress and dead load.
  2. Find the fixed-end moments from the differential shrinkage between deck and girder.
  3. Apply them to the continuous beam with an age-adjusted creep factor.
  4. Take the creep and shrinkage coefficients from 5.4.2.3, the same functions as the refined
     losses use.
- The calc package shows each step, so a reviewer can follow it.
- **Alternative:** a full time-step analysis (as in PGSuper's time-step mode). It is more exact but
  about twice the work. I suggest it as a later option.

## 5. What else changes

- **UI:**
  - a span table (length, strand set);
  - a pier panel (deck bars, positive connection);
  - a span/pier picker over the results;
  - the "Controlling" badge names the span or pier.
- **Sketch:** a bridge elevation (spans, piers, continuity diaphragms) with the moment envelope
  under it. The girder section and strand-profile sketches follow the picked span.
- **Calc package:** one section per span (as Phase 2), plus sections for the continuous analysis
  (the moment and shear envelopes by table), each pier's negative moment design, and the restraint
  moments.
- **Camber:** per span. It is unchanged up to continuity; later loads use the continuous beam's
  deflections.
- **Hand-off:** Camber and Haunch, per span.

## Validation

- **PGSuper benchmarks.** PGSuper models precast girders made continuous with continuity
  diaphragms.
  1. Two equal spans (WF74G, 2 × 120 ft): moments, shear and reactions by load case, negative
     moment Mn, deck bar checks, and the HL-93 negative moment loading.
  2. Three spans, 100–130–100 ft: unequal spans, the distribution factors with the average L, and
     interior and end span strands.
  3. Restraint moments: I'll try PGSuper's time-step analysis in test mode. If it crashes or can't
     be isolated, the P-method is checked against NCHRP 519's worked example.
- **Hand checks:**
  - continuous beam results against closed forms for two equal spans;
  - the 90%-two-truck loading by hand.
- **Tolerances:** as in Phases 1 and 2 (0.5% on actions).

## Order and effort

1. Continuous line-girder analysis: stiffness, staging and HL-93 influence (including the negative
   moment loading), plus the span inputs and per-span strands. **Largest piece.**
2. Negative moment design over piers (flexure, minimum, crack control, shear and 5.7.3.5 with deck
   bars), plus the PGSuper two-span benchmark.
3. Restraint moments (P-method), the fully effective check and the positive connection.
4. Three-span benchmark, the elevation sketch with envelopes, and the calc package sections.

Each step ends with its tests passing and the app checked. Phase 3 is somewhat larger than Phase 2,
mostly because of the analysis engine and per-span inputs.

## Decisions for you

1. **Restraint moments:** the P-method (recommended); a full time-step analysis (about twice the
   work); or leave them for a later phase and only flag them (not code-compliant on its own).
2. **Spans:** up to 5 (recommended), or only 2–3 for now.
3. **Strands per span:** per span with a "Same as span 1" toggle (recommended), or one pattern for
   all spans.
4. **Continuity made at deck casting** as the default (recommended), with "after the deck"
   selectable.

## Status (built, 2026-11-05)

Decisions taken: the P-method family of restraint moments (below); up to 5 spans; strands per span
with "Same as span 1"; continuity at deck casting by default (the girder age at continuity is an
input, at least the deck's age).

**Built**
- `continuous.ts`: three-moment line-girder analysis, HL-93 influence lines (truck with 14–30 ft rear
  spacing, tandem, lane on the adverse parts), and 90% of two trucks with 90% of the lane for
  negative moment between the points of contraflexure (3.6.1.3.1).
- The engine runs each span over its whole length (piers at either end), with the negative moment
  distribution factor from the average of the two spans at the pier.
- Checks added:
  - negative moment strength over the piers (deck bars, the girder's f′c in compression);
  - minimum reinforcement (γ3 = 0.67) and crack control (5.6.7);
  - Service I bottom compression near the piers;
  - shear and 5.7.3.5 with the deck bars in negative regions (5.7.3.5-2 only at abutments);
  - the positive moment connection (strength, and bar stress ≤ 36 ksi at service);
  - the fully effective joint, which triggers simple-span positive moments when it isn't.
- UI:
  - a span list;
  - per-span strands;
  - a continuity panel;
  - span/pier result views;
  - a bridge elevation with the moment envelope.
- Calc package: the controlling span worked out, plus a continuity section: the envelope table, the
  governing pier's negative moment, crack control, restraint moments, the joint and the connection.
  The summary covers every span and pier.

**Restraint moments.** Each span's free end rotations after continuity are restrained by the
continuous beam and relaxed by (1 − e^−φ)/φ:
- creep of the prestress and girder weight, with ψ after continuity;
- creep of the deck's weight;
- differential deck shrinkage, with its creep factor 1/(1 + 0.7ψd).

Restraint moments are selectable:
- all (conservative, the default);
- positive only (common practice where negative restraint is relieved by deck cracking);
- none.

On a BT-72 2 × 120 ft bridge with continuity at 90 days, shrinkage gives about −1,150 kip·ft at the
pier. That makes the bottom-flange compression near the piers govern. The owner chose
to keep "all" as the default (2026-11-05).

**Validation**
- Closed forms:
  - two- and three-span uniform loads;
  - pier influence lines;
  - unequal spans;
  - the single-span HL-93 envelope;
  - a hand-worked 90%-two-truck pier moment (within 0.2%);
  - Mn over the pier by hand (1%);
  - the shrinkage restraint, −1.5·EIκ·ρ for two equal spans.
- The calc package evaluates in Calcs and matches the engine for two- and three-span bridges.
- **PGSuper benchmark (2026-11-06), `pgsuper-continuous.test.ts`, 174 checks.**
  - Bridges: the WF74G harped girder in 2 × 120 ft, 100 + 130 ft and 100 + 130 + 100 ft, made
    continuous after the deck. PGSuper ran in continuous analysis with no restraint moments.
  - Only span 1 is compared, because PGSuper's test mode reports the first span only.
  - Agreement:
    - barriers and overlay on the continuous beam within 0.5% (exact to the kip·ft);
    - HL-93 per lane: positive within 0.5%, negative within 0.5% where the truck or tandem governs;
    - at the pier: LL− within 1% and Strength I Mu− within 1.5%;
    - Mu within 0.5% (3% beyond 0.75L, where it is small);
    - Mn over the pier about 3% lower (conservative); Mcr within 1%.
  - Changes the benchmark led to:
    - the continuous beam now spans to the piers' centerlines (new input "Pier centerline to the
      bearings", default 1.25 ft), as PGSuper does;
    - each dead load (girder, deck, barriers, overlay) takes its own maximum or minimum factor.
  - A difference kept on purpose: the 90% two-truck load. The tool applies it between the points of
    contraflexure under a uniform load on all spans, as 3.6.1.3.1 words it. PGSuper uses a shorter
    length near the pier. So at 0.7–0.9L of an end span next to a longer span, the tool's negative
    live load is up to 5% larger (conservative); at the piers the two agree.
  - How the PGSuper model was made: the single-span benchmark file, with piers, spans and girder
    groups added. Each segment's StartSpan/EndSpan must name its own span, or PGSuper crashes;
    a reference two-span file saved from PGSuper's own editor showed this.
  - PGSuper's default for WSDOT is the simple/continuous envelope (AnalysisType 2), which designs
    positive moments as the larger of simple and continuous. The tool uses continuous analysis, and
    falls back to simple spans only where a joint isn't fully effective (5.12.3.3).

**Differences from the spec**
- The diaphragm width isn't an input: negative moments are checked at the bearing centerline
  (conservative).
- The positive moment connection takes bars only (no extended strands).
- Camber at the deck is unchanged; the superimposed dead load deflection uses the continuous beam.
- Live load deflection stays simple-span (conservative).
- The calc package works out the controlling span fully and summarizes the others, rather than
  repeating every span.
