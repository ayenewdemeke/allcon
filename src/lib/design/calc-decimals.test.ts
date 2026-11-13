import { describe, expect, it } from "vitest";
import { TELLRD } from "./rating/benchmarks";
import { dtRatingCalcLines } from "./rating/double-tee-calc";
import type { Line } from "@/lib/calcs/library/templates";
import { fitsAcross, mathChars } from "@/lib/calcs/library/fit";
import { bearingCalcLines } from "./bearings/elastomeric-calc";
import { cbcCalcLines } from "./culverts/cbc-calc";
import { deckCalcLines } from "./decks/deck-calc";
import { cell, MAX_DECIMALS, num } from "./calc-style";
import { haunchCalcLines } from "./girders/haunch-calc";
import { girderCalcLines } from "./girders/prestressed-calc";
import { stripSealCalcLines } from "./joints/strip-seal-calc";
import { bearingInputs, cbcInputs, cipInputs, deckInputs, dtRatingInputs, girderInputs, haunchInputs, mseInputs, ptfeInputs, signInputs, stripSealInputs, wingwallInputs, zone1Inputs } from "./kinds";
import { columnCalcLines } from "./piers/column-calc";
import { columnInputs } from "./piers/column";
import { zone1CalcLines } from "./seismic/zone1-calc";
import { signCalcLines } from "./signs/cantilever-calc";
import { cipCalcLines } from "./walls/cip-calc";
import { mseCalcLines } from "./walls/mse-calc";
import { wingwallCalcLines } from "./walls/wingwall-calc";

// The rule for every design output: no number shows more than three decimals. Calcs shows its
// results to three; this checks what each calc package writes in (values, references, tables).

it("writes numbers to three decimals at most, small ones in powers of ten", () => {
  expect([num(933.564101161), num(1.1794871795), num(0.153), num(0.0857142857), num(0.000486), num(-0.0999999), num(0), num(-0.0001), num(32.75, 2)]).toEqual(["933.564", "1.179", "0.153", "8.571\\cdot10^{-2}", "4.86\\cdot10^{-4}", "-1\\cdot10^{-1}", "0", "-1\\cdot10^{-4}", "32.75"]);
  expect([cell(-0.05198), cell(1234.56789)]).toEqual(["-0.052", "1234.568"]);
});

const PACKAGES: [string, () => Line[]][] = [
  ["LRFD girder check", () => girderCalcLines(girderInputs({}), "Test")],
  ["CIP cantilever wall", () => cipCalcLines(cipInputs({}), "Test")],
  ["MSE wall", () => mseCalcLines(mseInputs({}), "Test")],
  ["Cantilever wingwall", () => wingwallCalcLines(wingwallInputs({}), "Test")],
  ["Box culvert", () => cbcCalcLines(cbcInputs({}), "Test")],
  ["Deck slab", () => deckCalcLines(deckInputs({}), "Test")],
  ["Seismic Zone 1", () => zone1CalcLines(zone1Inputs({}), "Test")],
  ["Pier column", () => columnCalcLines(columnInputs({}), "Test")],
  ["Camber and haunch", () => haunchCalcLines(haunchInputs({}), "Test")],
  ["Sign foundation", () => signCalcLines(signInputs({}), "Test")],
  ["Elastomeric bearing", () => bearingCalcLines(bearingInputs({}), "Test")],
  ["PTFE bearing", () => bearingCalcLines(ptfeInputs({}), "Test")],
  ["Strip seal joint", () => stripSealCalcLines(stripSealInputs({}), "Test")],
  ["Double-tee load rating", () => dtRatingCalcLines({ ...dtRatingInputs({}), ...TELLRD }, "Test")],
  [
    "Box culvert, corner bars and M-601-20 wingwalls (25250)",
    () =>
      cbcCalcLines(
        cbcInputs({ span: 10, rise: 10, Tt: 10, Tb: 11, Ts: 11, haunch: 0, fill: 12, fc: 4.5, cornerBars: true, bars: { topIn: { bar: 6, spacing: 6 }, topOut: { bar: 4, spacing: 6 }, botIn: { bar: 6, spacing: 6 }, botOut: { bar: 4, spacing: 6 }, wallIn: { bar: 4, spacing: 6 }, wallOut: { bar: 5, spacing: 6 } }, wingwalls: [{ name: "NW", m: 11.3, k: 2.4, L: 21.2, theta: 48, toeWall: true }] }),
        "Test",
      ),
  ],
];

// Every line of math fits on the page (the layout puts one too wide for its note across the page,
// with the note above), so the package prints with nothing cut off or overlapping.
describe("every design's calc package fits the page", () => {
  it.each(PACKAGES)("%s", (_, make) => {
    expect(make().flatMap((l) => ("math" in l && !fitsAcross(l.math) ? [`${mathChars(l.math)}: ${l.math.slice(0, 90)}`] : []))).toEqual([]);
  });
});

/**
 * The one exception: coefficients of the code's own equations, written as the code prints them so the
 * line reads like the equation it cites (AASHTO LRFD 5.7.3.3's 0.0316√f′c; 5.12.7.3's 0.0676√f′c and
 * 5.7.2.3's 0.0948√f′c and 0.126√f′c; 4.7.4.4's 0.000125S²).
 */
const CODE_COEFFICIENTS = new Set(["0.0316", "0.0676", "0.0948", "0.000125", "0.0018", "0.0014"]); // and ACI 318-19 7.6.1.1's 0.0018 and 0.0014

/** Numbers with more than three decimals (not counting exponents or the code's coefficients). */
const tooLong = (s: string) => (s.match(new RegExp(String.raw`(?<![\^{\w])\d+\.\d{${MAX_DECIMALS + 1},}`, "g")) ?? []).filter((m) => !CODE_COEFFICIENTS.has(m));

describe("every design's calc package", () => {
  it.each(PACKAGES)("%s", (_, make) => {
    const found: string[] = [];
    for (const l of make()) {
      const parts = "math" in l ? [l.math, l.ref ?? ""] : "text" in l ? [l.text] : "region" in l && l.region.kind === "table" ? l.region.rows.flat() : [];
      for (const p of parts) for (const m of tooLong(p)) found.push(`${m} in "${p.slice(0, 100)}"`);
    }
    expect(found).toEqual([]);
  });
});
