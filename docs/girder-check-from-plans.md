# LRFD Bridge Design Check from uploaded plans — spec (built)

Start a girder design check from a drawing set already uploaded to a project: the girder data is
read off the plans, the engineer confirms it value by value, and ALLCON's own engine runs the check.
Approved with the recommended choices; the connector route is built. The in-app button was built and then removed at the owner's request (2026-11-06). See Status at the end.

## 1. The principle

- **The plans give the inputs; the engine gives the answers.** AI only reads values off the sheets.
  Every calculation is the design check's own, benchmarked against PGSuper. A misread value shows
  up in the inputs, where the engineer can see and fix it, never hidden in a result.
- **Nothing runs unconfirmed.** Each value read from the plans is shown with where it came from on
  the sheet. A value that couldn't be read with confidence is asked, not guessed. One the plans
  don't give is filled with the tool's default and marked so.
- **The connector comes first**, as for plan review and the other AI features: the engineer's own
  Claude or ChatGPT does the reading through ALLCON's tools, on their own subscription. An in-app
  "Run here" with the low-cost model is the second option.

## 2. What is read, and from where

| Input | Usual sheet | Notes |
|---|---|---|
| Span lengths (bearing to bearing), number of spans, continuity | General plan, framing plan, girder elevation | CL bearing to CL bearing; continuous spans from the pier details |
| Girder type | Typical section, girder details | Matched to the library (e.g. "BT-72", "Type IV", "CBT 63"); otherwise a custom outline from the section dimensions |
| Number of girders, spacing, overhang, skew | Typical section, framing plan | Skew from the framing plan or the bearing line's angle |
| Girder end to bearing CL | Girder details, bearing details | |
| Deck: thickness, sacrificial (integral wearing) layer, haunch | Typical section, deck details | Haunch at the girder's centerline, or the "A" dimension less the deck |
| Concrete: f′ci, f′c (girder), f′c (deck), unit weight | General notes | |
| Strands: size, grade, jacking stress | General notes, girder details | |
| Strand pattern: straight rows (height, count), harped (count, heights at the ends and harp points, harp point location), debonding (count, length per row) | Girder details: strand pattern and its table | The values most prone to error; each row confirmed on its own |
| Stirrup zones (bar, legs, spacing, length from the end) | Girder reinforcement details | Converted from the girder's end to the bearing, as the tool takes them |
| Confinement bars | Girder end details | |
| Barriers (type, or weight), overlay (future wearing surface) | Typical section, general notes | Barrier weight from a standard type when only the type is shown |
| Diaphragms (number, weight) | Framing plan, diaphragm details | Weight from the dimensions when not stated |
| Deck bars over the piers, positive moment connection (continuous) | Deck and pier diaphragm details | |
| Design loading, exposure | General notes | "HL-93" expected; anything else is reported |

**Not usually on plans**, so filled with defaults and marked: relative humidity, the girder's age at
release and at deck placement, the final age, continuity age, lifting and hauling details, maximum
aggregate size, bearing length. The confirm screen lists these for the engineer to set.

**Cross-checks while reading** (reported, not fixed): a strand table count that doesn't match the
drawn pattern; spans that don't add up to the stated bridge length; a girder type not in the
library; values given two ways on different sheets.

## 3. The connector route (recommended first)

New connector tools, beside `list_sheets` and `read_sheet`, which already give each sheet's text as
numbered lines with their positions (and its image when it has no text layer):

- `list_designs` / `get_design`: a project's design checks, and one design's inputs and results
  summary (all design kinds, not only girders).
- `create_girder_design_from_plans`: creates a girder design check in a project from a list of
  values, each with its source:
  - `value` and the input it sets (named as in the design's inputs);
  - `source`: the sheet id and the text line ids (or a box) it was read from, or "default" /
    "assumed";
  - `confidence`: "read" or "unsure", with a short note when unsure.
  The design is created in a "from plans, to confirm" state; the tool returns its link.
- A prompt, `girder_check_from_plans`, with the procedure: which sheets to look for, the inputs in
  section 2, how to read a strand table, and to report what's missing rather than guess.

The engineer asks their AI app something like "set up a girder check from the Riverside Bridge
plans". It lists the sheets, reads the relevant ones and creates the design. The engineer then
confirms it in ALLCON (section 4). No Anthropic API credit is used.

## 4. The confirm screen (in ALLCON)

A design created from plans opens with a "From plans" panel above its inputs:

- Every value read from the plans, grouped as the inputs are, each with:
  - a link that opens the sheet with its source lines highlighted (as plan review's clouds);
  - a status: confirmed, to confirm, unsure (in amber, with the reader's note), or default (in grey).
- "Confirm" per value and "Confirm this group"; editing a value confirms it.
- The cross-check findings from section 2.
- The checks run as usual, but the results carry a "not yet confirmed" banner, and the calc package
  stays disabled, until every value is confirmed or edited.
- The panel can be closed once everything is confirmed; the sources stay with the design (shown as
  a small "from sheet S-3" note by each input) and go into the calc package's input section.

## 5. The in-app route (second)

A "Read from plans" button on a new girder design: pick a drawing set, and ALLCON sends the
relevant sheets (text and image) to the low-cost model, one sheet at a time, as plan review does,
then fills the same confirm screen. The run's cost is shown before it starts and recorded, as for
plan review. It uses the same reading instructions as the connector's prompt, so both routes give
the same result.

## 6. What changes

- Design data: a `sources` record per design (input path → sheet, lines or box, status, note).
- `src/lib/tools`: the design tools; `src/lib/mcp/server.ts`: their registration and the prompt.
- The girder editor: the "From plans" panel and the per-input source notes.
- The sheet viewer: opening a sheet with given lines highlighted (reusing plan review's markup).
- Calc package: each input's source sheet in the inputs section.

## Validation

- **Real plan sets.** Two or three girder bridge plan sets of different styles (for example two
  state DOTs and one consultant's), with the values a person read off them as the answer key:
  - every value from section 2 compared, by count of correct, unsure and wrong;
  - the target: no wrong value marked "read" (a wrong value must at least be "unsure"), and the
    strand pattern exact.
- The plan sets aren't committed to the repository; the answer keys (values only) are.
- A scanned set (no text layer) among them, to test reading from the image.
- In-app runs cost API credit, so they're run only with the owner's go-ahead; the connector route
  is tested with the owner's own AI app.

## Order and effort

1. The design tools and `create_girder_design_from_plans`, the sources record, and the confirm
   screen. **Medium**, about the size of plan review.
2. The reading prompt, tuned on the sample plan sets. **Small to medium**, mostly testing.
3. The in-app "Read from plans" button. **Small**, reusing plan review's request code.

## Decisions for you

1. **Route:** the connector first, then the in-app button (recommended); or the in-app button first;
   or the connector only.
2. **Confirmation:** required before the calc package (recommended); or only a warning banner.
3. **Sample plans:** two or three girder bridge plan sets to test with (yours, or public DOT plans
   you choose), uploaded to a project in ALLCON.
4. **Scope:** girder checks only for now (recommended); or the same "from plans" route for the other
   design kinds later (walls, culverts, bearings), which the design tools in section 3 would allow.

## Status (built, 2026-11-06)

Decisions taken: the connector route first (the in-app button later); confirmation required before
the calc package; girder checks only; the owner's three CDOT plan sets to test with.

**Built**
- `src/lib/design/girders/from-plans.ts`: the inputs the plans can set (with their schemas), the ones
  they usually don't (defaults, listed), the builder (values → inputs; spans and stirrup zones from the
  girder's end converted; the girder's default strands fitted to the section read), the girder-length
  cross-check, and the confirm state (an edit to an input confirms its value).
- Stored in the design's inputs as `fromPlans`: no database change.
- Connector tools (`src/lib/tools/designs.ts`, registered in `src/lib/mcp/server.ts`): `list_designs`,
  `get_design`, `create_girder_design_from_plans`; the prompt `girder_check_from_plans`. Sources are the
  sheet and its line ids from `read_sheet`; the tool turns them into a box on the sheet.
- The girder editor's "From plans" panel: each value with its sheet link, status, note, and Confirm;
  "Confirm this group"; "Confirm all values read clearly"; the findings. A banner marks the results
  unconfirmed; the calc package is off (in the editor and on the server) until all are confirmed. The
  calc package lists each input's source sheet.
- Sheet links: `?focus=x0,y0,x1,y1` opens a sheet zoomed to the source, outlined.

**Tested on the owner's plans** (answer keys in `from-plans.test.ts`; the plans themselves aren't kept):
- CDOT 24610, Airport–Powers (I-18-BD): two CBT 54 spans made continuous. Read: layout, deck,
  concrete, strand size and jacking, overlay; unsure: spans (to the pier's centerline), the strand
  pattern and harped strands (the schedule gives only their count and centroids, so 6 harped were
  inferred), stirrup legs, the pier bars and the connection's height. The schedule's girder length
  (103.23 ft) against the spans (103.5 ft) is flagged by the cross-check. Against the designer's own
  numbers on the plans, with the defaults for what the plans don't give: final force 1,309 vs 1,362 kip,
  release camber 1.91 vs 1.54 in, deck deflection 1.50 vs 1.94 in, the differences coming from the
  values marked unsure and the defaults (humidity, ages), which is what the confirm step is for.
- CDOT 24898, SH 79 over I-70: prestressed box girders; not supported, and refused.
- CDOT 26956, D-11-Z (FIR sheets): three CBT 63 spans; layout and typical section only, so strands,
  concrete and reinforcement are left as defaults to confirm (and the default strands are fitted to
  the CBT 63).
- In the app: the panel, the source links, confirming, the banner and the calc package gate.

**Not done yet**
- An end-to-end run through the owner's own Claude or ChatGPT connector on an uploaded set (needs the
  owner's AI app; nothing in ALLCON stops it).
- The in-app "Read from plans" button: built, then removed at the owner's request; reading plans is through the connector only.
