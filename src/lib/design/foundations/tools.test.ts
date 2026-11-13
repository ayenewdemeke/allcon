import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { takeoffFor, takeoffPayLines } from "../takeoff";
import { designAbutment, ABUTMENT_DEFAULTS, continuousBeam } from "./abutment";
import { foundationCalcLines } from "./calc";
import { FOUNDATION_KINDS, foundationInputs, type FoundationKind } from "./kinds";
import { designMicropile, MICROPILE_DEFAULTS } from "./micropile";
import { pMultiplier } from "./piles";
import { runFoundation } from "./run";
import { shaftAxial, SHAFT_DEFAULTS } from "./shaft";

// The five tools end to end: each default passes its required checks, its calc package works out in
// Calcs with no errors and its checks there match the engine's, its take-off gives CDOT pay items;
// and hand checks of the micropile's sections, the shaft's resistance, the p-multipliers and the
// continuous beam under the abutment's cap.

function workOut(lines: ReturnType<typeof foundationCalcLines>) {
  const regions = readingOrder(layout(lines, { x: 0, y: 0 }));
  const items = regions.flatMap((r): SheetItem[] => (r.kind === "text" || r.kind === "image" ? [] : [r as SheetItem]));
  const values = new Map<string, Value>();
  const results = evaluateSheet(items, DEFAULT_SETTINGS, values);
  const errors = regions.flatMap((r) => (results.get(r.id)?.kind === "error" ? [`${r.kind === "math" ? r.latex : r.kind}: ${(results.get(r.id) as { message: string }).message}`] : []));
  const ng = regions.filter((r) => r.kind === "math" && r.latex.startsWith("\\operatorname{if}")).map((r) => (results.get(r.id) as { result?: string }).result ?? "").filter((x) => x.includes("NG"));
  return { errors, ng };
}

const variants: [FoundationKind, object][] = [
  ...FOUNDATION_KINDS.map((k) => [k, {}] as [FoundationKind, object]),
  ["spread-footing", { B: 9, L: 14, colShape: "rectangular", colB: 30, colL: 48, bearing: "entered", qn: 25, onRock: true, settlement: false }],
  ["drilled-shaft", { D: 48 }],
  ["abutment", { type: "integral-shafts" }],
  ["abutment", { type: "seat", foundation: "piles" }],
  ["abutment", { type: "semi-integral" }],
];

describe("foundation tools end to end", () => {
  for (const [kind, over] of variants) {
    it(`${kind} ${JSON.stringify(over)}: passes, works out in Calcs, has quantities`, () => {
      const i = foundationInputs(kind, over)!;
      const r = runFoundation(kind, i);
      if (Object.keys(over).length === 0) expect(r.checks.filter((c) => !c.ok && !c.advisory).map((c) => c.id)).toEqual([]);
      const w = workOut(foundationCalcLines(kind, i, "Test"));
      expect(w.errors).toEqual([]);
      if (r.checks.every((c) => c.ok || c.advisory)) expect(w.ng).toEqual([]);
      const t = takeoffFor(kind, i)!;
      expect(t).not.toBeNull();
      expect(takeoffPayLines(kind, t, {}, i).length).toBeGreaterThan(0);
    });
  }
  it("pay items: the pile by its section, the shaft by its diameter, the micropile by its casing", () => {
    const p = foundationInputs("pile-foundation", { section: "HP14x89" })!;
    expect(takeoffPayLines("pile-foundation", takeoffFor("pile-foundation", p)!, {}, p, "cdot").map((l) => l.code)).toContain("502-11489");
    const s = foundationInputs("drilled-shaft", { D: 48 })!;
    expect(takeoffPayLines("drilled-shaft", takeoffFor("drilled-shaft", s)!, {}, s, "cdot").map((l) => l.code)).toContain("503-00048");
    const m = foundationInputs("micropile", {})!;
    expect(takeoffPayLines("micropile", takeoffFor("micropile", m)!, {}, m, "cdot").map((l) => l.code)).toEqual(["503-01070"]);
  });
});

describe("hand checks", () => {
  it("micropile sections, AASHTO Eqs. 10.9.3.10.2a-2 and -2b-2, and the bond", () => {
    const r = designMicropile(MICROPILE_DEFAULTS);
    const Ab = 4.91;
    const ID = 7 - 1;
    const Ac = (Math.PI / 4) * (49 - 36);
    expect(r.Ac).toBeCloseTo(Ac, 9);
    expect(r.RnCC).toBeCloseTo(0.85 * (0.85 * 5 * ((Math.PI / 4) * ID ** 2 - Ab) + 75 * Ab + 80 * Ac), 6);
    expect(r.RnCU).toBeCloseTo(0.85 * (0.85 * 5 * ((Math.PI / 4) * 64 - Ab) + 75 * Ab), 6);
    expect(r.Rs).toBeCloseTo(Math.PI * (8 / 12) * 7 * 35, 6);
  });
  it("drilled shaft: the entered claystone layer's side resistance, qs·π·D·length", () => {
    const a = shaftAxial(SHAFT_DEFAULTS);
    const clay = a.rows.find((r) => r.name === "Claystone")!;
    expect(clay.Rs).toBeCloseTo(4 * Math.PI * 3.5 * (40 - 18), 6);
    expect(a.qp).toBe(40);
  });
  it("p-multipliers, AASHTO Table 10.7.2.4-1", () => {
    expect(pMultiplier(1, 3)).toBe(0.8);
    expect(pMultiplier(2, 5)).toBe(0.85);
    expect(pMultiplier(3, 4)).toBeCloseTo(0.5, 9);
  });
  it("a continuous beam: two equal spans under a uniform load, −wL²/8 over the middle support", () => {
    const b = continuousBeam(20, [0, 10, 20], [], 1);
    expect(b.Mneg).toBeCloseTo(12.5, 3);
    expect(b.Mpos).toBeCloseTo((9 / 128) * 100, 1);
  });
  it("integral abutment movement: α·L/2·(T − 60) and the BDM's 2 in limit", () => {
    const r = designAbutment(ABUTMENT_DEFAULTS);
    expect(r.expansion).toBeCloseTo(6e-6 * 120 * 12 * 40, 9);
    expect(r.contraction).toBeCloseTo(6e-6 * 120 * 12 * 60 + 0.4, 9);
    const long = designAbutment({ ...ABUTMENT_DEFAULTS, unitLength: 500 });
    expect(long.checks.find((c) => c.id === "unit-length")!.ok).toBe(false);
  });
});
