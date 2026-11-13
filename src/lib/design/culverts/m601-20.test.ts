import { describe, expect, it } from "vitest";
import { takeoffFor } from "../takeoff";
import { CBC_DEFAULTS, designCbc } from "./cbc";
import { cbcCalcLines } from "./cbc-calc";
import { designH, kRange, L_MULTIPLES, m60120Wingwall, segments, sheet1, sheet2Row, type CulvertWingwall } from "./m601-20";

// CDOT M-601-20 (2019), Wingwalls for Pipe or Box Culverts: the tables as transcribed and the
// lookups the sheets describe.

const wall = (name: string, m: number, k: number, L: number, theta = 45): CulvertWingwall => ({ name, m, k, L, theta, toeWall: true });

describe("M-601-20 wingwalls", () => {
  it("Sheet 2's example: a 25.0 ft wall, m = 11.8, k = 6.3 → L ≤ 2.25 m, m 12, k 6: #6 @ 10\", 60.60 lb/LF, 1,515 lb", () => {
    const r = m60120Wingwall(wall("Ex", 11.8, 6.3, 25));
    expect(r.ratio).toBeCloseTo(2.12, 2);
    expect(r.colLabel).toBe("L ≤ 2.25 m");
    expect([r.mR, r.kR]).toEqual([12, 6]);
    expect(r.cell).toEqual({ cBars: { bar: 6, spacing: 10 }, lbPerLf: 60.6 });
    expect(Math.round(r.rebar)).toBe(1515);
    expect(r.inTable).toBe(true);
  });

  it("the table as transcribed: eleven cells a row, the k rows each m has, and steel growing with k in every column", () => {
    const rows: Record<number, [number, number]> = { 14: [4, 9], 13: [4, 9], 12: [2, 9], 11: [2, 9], 10: [2, 8], 9: [2, 8], 8: [2, 7], 7: [2, 6] };
    for (const [m, [lo, hi]] of Object.entries(rows).map(([m, v]) => [Number(m), v] as const)) {
      expect(kRange(m)).toEqual({ min: lo, max: hi });
      for (let k = lo; k <= hi; k++) {
        const row = sheet2Row(m, k)!;
        expect(row).toHaveLength(L_MULTIPLES.length);
        for (const c of row) {
          expect([4, 5, 6, 7]).toContain(c.cBars.bar);
          expect([6, 7, 8, 9, 10]).toContain(c.cBars.spacing);
          expect(c.lbPerLf).toBeGreaterThan(25);
          expect(c.lbPerLf).toBeLessThan(115);
        }
        if (k > lo)
          sheet2Row(m, k)!.forEach((c, col) => {
            // The standard's own misprint (m 8, k 4, L ≤ 2.75 m: 33.45) is kept as printed.
            if (m === 8 && k === 5 && col === 7) return;
            if (m === 8 && k === 4 && col === 7) return;
            expect(c.lbPerLf, `m ${m} k ${k} col ${col}`).toBeGreaterThan(sheet2Row(m, k - 1)![col].lbPerLf);
          });
      }
    }
  });

  it("Sheet 1: concrete per foot is the 10 in stem h high plus the 1'-0\" footing w wide (checks the transcription)", () => {
    for (let h = 2; h <= 14; h++) {
      const r = sheet1(h)!;
      const w = 2 + 8 / 12 + (h - 2) * 0.5; // 2'-8" at h = 2, 6 in more per foot
      const [ft, inch] = r.w.split("'-").map((s) => parseFloat(s));
      expect(ft + inch / 12).toBeCloseTo(w, 6);
      expect(r.cy).toBeCloseTo(((10 / 12) * h + w) / 27, 2);
    }
  });

  it("Sheet 1's design example: k = 4'-0\" to m = 9'-6\", each stretch designed for its height rounded (4'-6\" max for h = 4')", () => {
    expect(designH(4.5)).toBe(4);
    expect(designH(4.51)).toBe(5);
    expect(designH(9.5)).toBe(9);
    const s = segments(9.5, 4, 22);
    expect(s.map((x) => x.h)).toEqual([9, 8, 7, 6, 5, 4]);
    // Each foot of height takes 22 / 5.5 = 4 ft of wall; the last stretch (4.0 to 4.5 ft) half that.
    expect(s[1].length).toBeCloseTo(4, 9);
    expect(s[5].length).toBeCloseTo(2, 9);
    expect(s.reduce((a, x) => a + x.length, 0)).toBeCloseTo(22, 9);
  });

  it("outside the tables is a special design: the checks fail and say why", () => {
    expect(m60120Wingwall(wall("High", 15, 5, 20)).inTable).toBe(false);
    expect(m60120Wingwall(wall("Low k", 13, 2, 20)).issues[0]).toMatch(/k = 4 to 9/);
    expect(m60120Wingwall(wall("Long", 10, 4, 36)).col).toBe(-1);
    const r = designCbc({ ...CBC_DEFAULTS, wingwalls: [wall("Long", 10, 4, 36)] });
    expect(r.checks.find((c) => c.id === "ww-0-L")!.ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("25250 (CBC 007D064470BR, sheets C02/C06): the four wingwalls' steel, concrete and toe walls in the culvert's take-off", () => {
    const walls = [wall("NE", 11.3, 5.2, 13.1, 73.74), wall("NW", 11.3, 2.4, 21.2, 48.31), wall("SE", 11.3, 5.5, 20.5, 37.69), wall("SW", 11.3, 9.0, 17.8, 68.34)];
    const rs = walls.map(m60120Wingwall);
    expect(rs.map((r) => r.cell!.lbPerLf)).toEqual([46.1, 38.5, 51.38, 63.21]);
    expect(rs.map((r) => `#${r.cell!.cBars.bar}@${r.cell!.cBars.spacing}`)).toEqual(["#4@10", "#4@10", "#5@10", "#5@8"]);
    const steel = rs.reduce((s, r) => s + r.rebar + r.toe!.lb, 0);
    // Toe walls along the front and across the footing's end at the tip, as the original 25250 calc (JDC,
    // 1/24/2024) measures them (NE 13.1 + 4.167 = 17.267 ft, its 17.25), w for k's design h by Sheet 1's rule
    // (k 5.5 → h 5, 4'-2"; k 9.0 → h 9, 6'-2"; the calc took 4'-8" and 6'-8").
    const toeLen = 72.6 + (4 + 2 / 12) + (2 + 8 / 12) + (4 + 2 / 12) + (6 + 2 / 12);
    expect(steel).toBeCloseTo(13.1 * 46.1 + 21.2 * 38.5 + 20.5 * 51.38 + 17.8 * 63.21 + toeLen * 5.1, 6);
    const i = { ...CBC_DEFAULTS, cells: 1, span: 10, rise: 10, Tt: 10, Tb: 11, Ts: 11, haunch: 0, wingwalls: walls };
    const t = takeoffFor("box-culvert", i, { length: 33, angle: 90 })!;
    expect(t.schedule.extra!.filter((e) => e.label.includes("wingwall"))).toHaveLength(8);
    expect(t.schedule.concrete.filter((c) => c.label.includes("wingwall"))).toHaveLength(8);
    expect(designCbc(i).checks.filter((c) => c.id.startsWith("ww-")).every((c) => c.ok)).toBe(true);
    // The calc package: the wingwalls' tables and the summary in groups, wingwalls last.
    const lines = cbcCalcLines(i, "25250");
    expect(lines.some((l) => "text" in l && l.text === "Wingwalls (M-601-20):- all 12 checks pass.")).toBe(true);
  });
});
