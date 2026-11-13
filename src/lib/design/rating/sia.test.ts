import { describe, expect, it } from "vitest";
import { DT_DEFAULTS } from "./double-tee";
import { applySia, readSia, textLines } from "./sia";

// Reading the SIA. The lines below follow the two report layouts as pdf.js gives them (pieces on a
// line joined with " | "), with a real bridge's values; the readings were checked against all ten
// SIAs of the five bridges rated (not kept here: they're the owner's files).

const SNBI = [
  "Structure Inspection and Inventory Report | Inspection Date: | 10/16/2025",
  "Structure Key: | AUR08.0-J.3",
  "Year Built 1983",
  "n | C02 - Superstructure Rating: | 6 - Satisfactory | n | C10 - Channel Protection Rating: | 7 - Good",
  "n | CL01 - Owner: | L03 - City or municipal highway agency | n | CL09A - Structure Type: | CDTPG - Concrete Double T Prestressed Girder",
  "n | CL01A - Responsible Party: | City of Aurora | n | CL10A - Construction Type 120B: | 21 - Concrete Twin 'T' Girder,",
  "n | CL02 - Maintenance Responsibility: | L03 - City or municipal highway | n | CL11A - Features Intersected: | EAST TOLLGATE CREEK",
  "n | CL03 - Federal or Tribal Land Access: | N - Not applicable | n | CL11B - Feature Carried: | 1ST AVENUE",
  "n | G01 - NBIS Length: | 130 | n | G10 - Median: | 0 - No median",
  "n | G02 - Total Length: | 134.2 | n | G11 - Skew: | 15",
  "n | G03 - Maximum Span: | 66 | n | G12 - Curved Bridge: | N - Not curved",
  "n | G04 - Minimum Span: | 66 | n | G13 - Maximum Height: | 14",
  "n | G05 - Out To Out: | 62 | n | G14 - Sidehill Bridge: | N - Not a sidehill bridge",
  "n | G06 - Width Curb to Curb: | 50 | n | G15 - Irregular Deck Area:",
  "n | G07 - Left Curb Or Sidewalk: | 5 | n | G16 - Federal Deck Area: | 8320",
  "n | G08 - Right Curb Or Sidewalk: | 5 | n | G17A - Asphalt / Fill Thickness: | 0",
  "n | ID01A - Structure Key: | AUR08.0-J.3 | n | ID06A - Parallel Structure Key 8P:",
  "n | IE03 - Inspection Date: | 2025-10-16 | n | IE09 - QA Date:",
  "n | SP02 - Number of Spans: | 2 | n | SP09 - Deck Material and Type: | C01 - Reinforced concrete, cast-in-place",
  "n | SP03 - Number of Beam Lines: | 9 | n | SP10 - Wearing Surface: | C01 - Concrete, Monolithic",
  "n | W01 - Year Built: | 1983 | n | W03A - Work Performed:",
  "n | LR02 - Design Method 31D: | Unknown | n | LR09A - Within 1 Mile 64LT10: | No",
];

const NBI = [
  "Bridge Key: | CENT 19-2.5 | Inspection Date: | 10/05/2023 | Suff Rating: | 86.0 | ND | G/F/P Condition: Fair",
  "Tran Region 2T: | 02 | Main Spans Unit 45: | 1 | Total Cost 96: | 0.00",
  "County Code 3: | 005 | Approach Spans 46: | 0 | Year of Cost Estimate 97: | 2017",
  "Place Code 4: | 12815 | Max Span 48: | 27.8 ft | Border Bridge Number 99:",
  "CENTENNIAL | Str Length 49: | 30.0 ft | Defense Highway 100: | 0",
  "Rte.(On/Under) 5A: | 1 | Curb Wdth L/R 50A/B: | 0.0 ft | 0.0 ft | Parallel Structure 101: | N",
  "Signing Prefix 5B: | 5 | Width Curb to Curb 51: | 29.80 ft | Direction of Traffic 102: | 2",
  "Level of Service 5C: | 1 | Width Out to Out 52: | 29.8 ft | Temporary Structure 103: | !",
  "Feature Intersected 6: | Min Clr Ovr Brdg 53: | 99.99 | Fed Lands Hiway 105: | 0",
  "BIG DRY CREEK | N | Year Reconstructed 106:",
  "Facility Carried 7: | Min Underclr 54B: | 0.0 ft | Deck Type 107: | 9",
  "FRANKLIN ST | Min Lat Clrnce Ref R 55A: | N | Wearing Surface 108A: | 6",
  "N/A | Super 59: | 6 | Trk Net 110: | 0",
  "Owner 22: | 04",
  "Year Built 27: | 1968",
  "Skew 34: | 0 ° | Inspector Name 90C: | Userkey 5, UW Sched:",
  "Rating Package Review Date (066R): | 01/01/1901 | Asphalt Thickness (066T): | 4.00",
  "109/1 | Pre Opn Conc Girder/Beam | ft | 360 | 98% | 351 | 3% | 9 | 0% | 0 | 0% | 0",
];

const val = (r: ReturnType<typeof readSia>, input: string) => r.values.find((v) => v.input === input)?.value;

describe("SIA, SNBI items (2025 on)", () => {
  const r = readSia(SNBI);
  it("reads the bridge, its geometry and its units", () => {
    expect(r.format).toBe("snbi");
    expect(r.structure).toBe("AUR08.0-J.3");
    expect(r.date).toBe("2025-10-16");
    expect([val(r, "bridge.facility"), val(r, "bridge.feature"), val(r, "bridge.owner")]).toEqual(["1ST AVENUE", "EAST TOLLGATE CREEK", "City of Aurora"]);
    expect([val(r, "bridge.yearBuilt"), val(r, "bridge.nbiSuper"), val(r, "numSpans"), val(r, "span"), val(r, "skew")]).toEqual([1983, 6, 2, 66, 15]);
    expect([val(r, "units.count"), val(r, "deck.present"), val(r, "loads.asphalt")]).toEqual([9, true, 0]);
    expect([val(r, "roadway.railToRail"), val(r, "roadway.curbToCurb"), val(r, "roadway.curbFaceOffset")]).toEqual([62, 50, 72]);
    expect(val(r, "loads.sidewalks")).toEqual([
      { width: 5, thk: 6 },
      { width: 5, thk: 6 },
    ]);
  });
  it("reads whether the bridge is within 1 mile of an Interstate (LR09A), for posting emergency vehicles", () => {
    expect(val(r, "bridge.nearInterstate")).toBe(false);
    const yes = readSia(SNBI.map((l) => l.replace("64LT10: | No", "64LT10: | Yes")));
    expect(val(yes, "bridge.nearInterstate")).toBe(true);
    expect(applySia(DT_DEFAULTS, yes, yes.values.filter((v) => v.input === "bridge.nearInterstate")).bridge.nearInterstate).toBe(true);
    // Left blank in the report: not read, so it stays the rater's call.
    const blank = readSia(SNBI.map((l) => l.replace("64LT10: | No", "64LT10:")));
    expect(val(blank, "bridge.nearInterstate")).toBeUndefined();
  });
  it("flags what the SIA can't say exactly", () => {
    const len = r.values.find((v) => v.input === "structureLength")!;
    expect(len.value).toBe(67.1);
    expect(len.note).toMatch(/piers/);
    expect(r.values.find((v) => v.input === "loads.sidewalks")!.note).toMatch(/rail edge/);
    expect(r.values.find((v) => v.input === "deck.present")!.note).toMatch(/thickness/);
  });
  it("applies only the values chosen, noting their sources and keeping a sidewalk thickness entered", () => {
    const start = { ...DT_DEFAULTS, loads: { ...DT_DEFAULTS.loads, sidewalks: [{ width: 6, thk: 8 }] } };
    const o = applySia(start, r, r.values.filter((v) => ["span", "units.count", "loads.sidewalks"].includes(v.input)));
    expect([o.span, o.units.count, o.skew]).toEqual([66, 9, DT_DEFAULTS.skew]);
    expect(o.loads.sidewalks).toEqual([
      { width: 5, thk: 8 },
      { width: 5, thk: 6 },
    ]);
    expect(o.notes.span).toMatch(/^SIA 2025-10-16, G03 Maximum Span: 66 \(Sometimes the clear span/);
    expect(start.span).toBe(DT_DEFAULTS.span);
  });
});

describe("SIA, NBI items (full reports before 2025)", () => {
  const r = readSia(NBI);
  it("reads the items, with values on the line below their labels", () => {
    expect(r.format).toBe("nbi");
    expect(r.date).toBe("2023-10-05");
    expect([val(r, "bridge.id"), val(r, "bridge.facility"), val(r, "bridge.feature"), val(r, "bridge.owner")]).toEqual(["CENT 19-2.5", "FRANKLIN ST", "BIG DRY CREEK", "City or municipal highway agency"]);
    expect([val(r, "bridge.yearBuilt"), val(r, "bridge.nbiSuper"), val(r, "numSpans"), val(r, "span"), val(r, "skew"), val(r, "structureLength")]).toEqual([1968, 6, 1, 27.8, 0, 30]);
    expect([val(r, "roadway.railToRail"), val(r, "loads.asphalt"), val(r, "deck.present"), val(r, "loads.sidewalks")]).toEqual([29.8, 4, false, []]);
  });
  it("counts the units from the girder element (two stems a unit) and flags item 48", () => {
    expect(val(r, "units.count")).toBe(6);
    expect(r.values.find((v) => v.input === "span")!.note).toMatch(/bearing to bearing/);
  });
  it("doesn't offer a rail face offset when the widths are equal", () => {
    expect(val(r, "roadway.railFaceOffset")).toBeUndefined();
    expect(r.findings.join(" ")).toMatch(/rail face/);
  });
});

describe("SIA with a sidewalk on one side (a 2026 report: IE03A for the inspection date)", () => {
  // G07 4.3 ft, G08 0: the sketch puts the curb faces 5'-0 1/2" and 1'-3" in from the edges.
  const r = readSia([
    "n | G02 - Total Length: | 47.2 | n | G11 - Skew: | 0",
    "n | G03 - Maximum Span: | 44.5 | n | G12 - Curved Bridge: | N - Not curved",
    "n | G05 - Out To Out: | 30.1 | n | G14 - Sidehill Bridge: | N - Not a sidehill bridge",
    "n | G06 - Width Curb to Curb: | 23.9 | n | G15 - Irregular Deck Area:",
    "n | G07 - Left Curb Or Sidewalk: | 4.3 | n | G16 - Federal Deck Area: | 1421",
    "n | G08 - Right Curb Or Sidewalk: | 0 | n | G17A - Asphalt / Fill Thickness: | 0",
    "n | ID01A - Structure Key: | TELLRD-PINE ST | n | ID06A - Parallel Structure Key 8P:",
    "n | IE03 - Field End Date: | 2026-06-24 | n | IE09 - QA Date:",
    "n | IE03A - Inspection Date: | 2026-06-24 | n | IE10 - Inspection Finalized: | 2026-09-25",
    "n | SP02 - Number of Spans: | 1 | n | SP09 - Deck Material and Type: | C01 - Reinforced concrete, cast-in-place",
    "n | SP03 - Number of Beam Lines: | 5 | n | SP10 - Wearing Surface: | C01 - Concrete, Monolithic",
  ]);
  it("reads the bridge and its one sidewalk", () => {
    expect([r.structure, r.date, val(r, "span"), val(r, "units.count"), val(r, "deck.present")]).toEqual(["TELLRD-PINE ST", "2026-06-24", 44.5, 5, true]);
    expect(val(r, "loads.sidewalks")).toEqual([{ width: 4.3, thk: 6 }]);
  });
  it("takes the narrower side's curb offset (both exterior girders are rated alike) and says why", () => {
    // Edge beyond the sidewalks: (30.1 − 23.9 − 4.3 − 0) / 2 = 0.95 ft, so 63 in and 11.4 in.
    expect(val(r, "roadway.curbFaceOffset")).toBeCloseTo(11.4, 6);
    expect(r.findings.join(" ")).toMatch(/sidewalks differ/);
  });
});

it("refuses a PDF that isn't an SIA", () => {
  expect(() => readSia(["SECTION | LOOKING NORTH", "(6) PRECAST, PRESTRESSED CONCRETE DOUBLE TEE GIRDERS"])).toThrow(/SIA/);
});

it("groups a page's text pieces into lines, top to bottom and left to right", () => {
  expect(
    textLines([
      { str: "66", x: 200, y: 500.5 },
      { str: "G03 - Maximum Span:", x: 50, y: 501 },
      { str: "Geometry (G)", x: 50, y: 520 },
      { str: " ", x: 10, y: 400 },
    ]),
  ).toEqual(["Geometry (G)", "G03 - Maximum Span: | 66"]);
});
