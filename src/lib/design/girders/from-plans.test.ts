import { describe, expect, it } from "vitest";
import { designGirder } from "./prestressed";
import { currentValue, girderFromPlans, toConfirm, trackEdits, type ReadValue } from "./from-plans";

// A girder check started from plans: the values read off three real CDOT plan sets (the answer keys
// below; the plans themselves aren't kept here), built into the tool's inputs, with what the plans
// don't give marked as defaults, and the engineer's edits confirming values.

const src = (sheet: string) => ({ sheetId: "00000000-0000-0000-0000-000000000000", sheet, box: [0, 0, 10, 10] as [number, number, number, number], lines: null });
const r = (input: string, value: unknown, sheet: string, confidence: "read" | "unsure" = "read", note?: string): ReadValue => ({ input, value, confidence, source: src(sheet), note: note ?? null });

// CDOT 24610, Airport–Powers interchange, I-18-BD (eastbound): two CBT 54 spans made continuous.
const airport: ReadValue[] = [
  r("spans", [103.5, 103.5], "B01", "unsure", "B01 gives spans 103'-6\" (to the pier's centerline, as read); bearing to bearing not dimensioned"),
  r("girderLength", 103.23, "B19"),
  r("shape", "cbt-54", "B19"),
  r("nGirders", 5, "B21"),
  r("S", 10.375, "B21"),
  r("overhang", 3.75, "B21"),
  r("barrierWidth", 1.5, "B21"),
  r("skew", 25.07, "B01", "read", "Bent angle 64°56'05\" → skew 25.07°"),
  r("deckT", 8, "B21"),
  r("fcDeck", 4.5, "B01"),
  r("fci", 6.5, "B19"),
  r("fc", 8.5, "B19"),
  r("strandDia", 0.6, "B19"),
  r("fpjRatio", 0.75, "B19", "read", "Fj 1581.93 kip on 36 × 0.217 in² = 202.5 ksi"),
  r("strands", [{ y: 2, count: 16 }, { y: 4, count: 10 }, { y: 6, count: 4 }], "B19", "unsure", "The schedule gives 36 strands, CG 3.36 in at midspan and 11.03 in at the ends, not the pattern: 30 straight inferred"),
  r("harped", { count: 6, yEnd: 50.18, yHarp: 4, harpPoint: 0.4009 }, "B19", "unsure", "Harped count not shown: 6 inferred from E_MS and E_E; harp points Lh = 10.23 ft from midspan"),
  r("stirrupsFromEnd", [{ length: 1.17, bar: 4, legs: 2, spacing: 3 }, { length: 2, bar: 4, legs: 2, spacing: 4 }, { length: 10, bar: 4, legs: 2, spacing: 6 }, { length: 0, bar: 4, legs: 2, spacing: 9 }], "B19", "unsure", "#4 with D20 wires bundled; legs taken as 2"),
  r("fws", 36.67, "B01", "read", "Plus 5 psf for future utilities, not included"),
  r("pierBars", { topBar: 9, topSpacing: 6, botBar: 4, botSpacing: 5, coverTop: 2, coverBottom: 1 }, "B21", "unsure", "#9 bundled with #4 at the top over Pier 2; the #4 left out"),
  r("connection", { count: 2, bar: 7, y: 4 }, "B24", "unsure", "(2) #7 × 5'-0\" through sleeves; height not dimensioned"),
];

// CDOT 26956, D-11-Z (FIR sheets): three CBT 63 spans; layout and typical section only.
const d11z: ReadValue[] = [
  r("spans", [65, 130, 65], "B03", "unsure", "CL abutment / CL pier spans; bearings not shown"),
  r("shape", "cbt-63", "B04"),
  r("nGirders", 5, "B04"),
  r("S", 9, "B04"),
  r("overhang", 3.5, "B04"),
  r("barrierWidth", 1.5, "B04"),
  r("skew", 0, "B03"),
  r("deckT", 8, "B04"),
  r("fws", 36.75, "B04", "unsure", "3 in HMA over a waterproofing membrane, at 147 pcf"),
];

describe("a girder check from plans", () => {
  it("builds the Airport–Powers bridge: continuous CBT 54 spans, the stirrups converted to zones from the bearing", () => {
    const b = girderFromPlans(airport, "24610 Bridge Plans Award Set.pdf", []);
    expect(b.rejected).toEqual([]);
    expect(b.error).toBeNull();
    // The schedule's girder length (103.23 ft) doesn't fit spans read to the pier's centerline: flagged.
    expect(b.inputs.fromPlans!.findings.some((x) => x.includes("103.23 ft"))).toBe(true);
    const i = b.inputs;
    expect(i.shape).toBe("cbt-54");
    expect([i.L, i.extraSpans.length]).toEqual([103.5, 1]);
    expect(i.harped.count).toBe(6);
    // The first zone from the girder's end (1.17 ft) less the end distance (0.75 ft) is the first zone from the bearing.
    expect(i.stirrups[0].length).toBeCloseTo(1.17 - i.endDist, 6);
    expect(i.stirrups[i.stirrups.length - 1].length).toBe(0);
    const d = designGirder(i);
    expect(d.continuous).toBe(true);
    expect(d.piers).toHaveLength(1);
    // What the plans didn't give is marked default, and nothing is confirmed yet.
    const f = i.fromPlans!;
    expect(f.values.find((v) => v.input === "endDist")!.status).toBe("default");
    expect(f.values.find((v) => v.input === "humidity")!.status).toBe("default");
    expect(toConfirm(f).length).toBe(f.values.length);
  });

  it("builds the D-11-Z layout, leaving strands, concrete and reinforcement as defaults to confirm", () => {
    const b = girderFromPlans(d11z, "26956 D-11-Z FIR Plan Sheets.pdf", []);
    expect(b.rejected).toEqual([]);
    const f = b.inputs.fromPlans!;
    for (const k of ["strands", "fci", "fc", "stirrupsFromEnd", "pierBars"]) expect(f.values.find((v) => v.input === k)!.status, k).toBe("default");
    expect(designGirder(b.inputs).spans).toHaveLength(3);
  });

  it("rejects what isn't an I-girder or bulb-tee in the library (the SH 79 box girders), and values that don't fit", () => {
    const b = girderFromPlans([r("shape", "box-48", "B19"), r("spans", [92.06], "B19"), r("fc", -8.5, "B19"), r("color", "red", "B19")], null, ["Box girders: not supported"]);
    expect(b.rejected.length).toBe(3);
    expect(b.inputs.fromPlans!.findings[0]).toBe("Box girders: not supported");
    expect(b.inputs.fromPlans!.findings.some((x) => x.includes("Girder section"))).toBe(true);
    expect(b.inputs.shape).toBe("bt-72"); // the default stays, marked so
  });

  it("an edit to an input marks its value edited, which confirms it; the rest stay to confirm", () => {
    const b = girderFromPlans(airport, null, []);
    const edited = trackEdits({ ...b.inputs, S: 10.4 });
    const S = edited.fromPlans!.values.find((v) => v.input === "S")!;
    expect(S.status).toBe("edited");
    expect(edited.fromPlans!.values.find((v) => v.input === "nGirders")!.status).toBe("read");
    // Unchanged inputs (stirrups re-expressed from the girder's end) don't count as edits.
    expect(trackEdits(b.inputs)).toBe(b.inputs);
    expect(currentValue(b.inputs, "spans")).toEqual([103.5, 103.5]);
  });
});
