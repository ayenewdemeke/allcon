import { describe, expect, it } from "vitest";
import { girderInputs } from "../kinds";
import { girderFigures } from "../figures";
import { designGirder } from "./prestressed";
import { girderCalcLines } from "./prestressed-calc";
import { girderSchedule, scheduleCells } from "./schedule";

// The girder schedule as CDOT's B-618-CBT1 tabulates it, filled from the design.

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe("girder schedule (CDOT B-618-CBT1)", () => {
  it("each span's exterior and interior girders, with the design's numbers", () => {
    const i = girderInputs({});
    const d = designGirder(i);
    const s = girderSchedule(i, d);
    expect(s.rows.map((r) => r.girders)).toEqual(["A, F", "B–E"]);
    const ext = s.rows[0];
    const g = d.spans[0].exterior;
    close(ext.L, i.L + 2 * i.endDist);
    close(ext.Lh!, i.harped.harpPoint * (i.L + 2 * i.endDist));
    close(ext.As, g.strands.Aps);
    close(ext.Fj, g.strands.Aps * g.losses.fpj);
    close(ext.Ff, g.strands.Aps * g.losses.fpe);
    expect(ext.Ff).toBeLessThan(ext.Fj);
    // Harped strands raise the centroid at the girder's end.
    expect(ext.Ee).toBeGreaterThan(ext.Ec);
    close(ext.delta, -g.camber.dTotal);
    close(ext.camber, g.camber.cDeck);
    expect(s.final).toBe(d.spans.every((x) => x.ok));
    expect(scheduleCells(ext)).toHaveLength(15);
  });

  it("continuous spans each get their rows; straight strands have no harping point; debonding is listed", () => {
    const i = girderInputs({
      harped: { count: 0, yEnd: 6, yHarp: 6, harpPoint: 0.4 },
      strands: [
        { y: 2, count: 12, debonded: 4, debondLength: 10 },
        { y: 4, count: 12, debonded: 0, debondLength: 0 },
      ],
      extraSpans: [{ L: 120, strands: null, harped: null }],
    });
    const s = girderSchedule(i, designGirder(i));
    expect(s.rows.map((r) => r.span)).toEqual([1, 1, 2, 2]);
    expect(s.rows.every((r) => r.Lh === null)).toBe(true);
    expect(s.debond).toEqual([
      { span: 1, y: 2, strands: 12, debonded: 4, length: 10 },
      { span: 2, y: 2, strands: 12, debonded: 4, length: 10 },
    ]);
  });

  it("in the calc package: the schedule, the debonding table and the elevation on a page of their own", () => {
    const i = girderInputs({ strands: [{ y: 2, count: 12, debonded: 4, debondLength: 10 }, { y: 4, count: 12, debonded: 0, debondLength: 0 }] });
    const lines = girderCalcLines(i, "Girders", girderFigures(i));
    const head = lines.findIndex((l) => "text" in l && l.text === "Girder schedule");
    expect(head).toBeGreaterThan(0);
    const svgs = lines.slice(head).flatMap((l) => ("region" in l && l.region.kind === "image" ? [l.region.svg] : []));
    expect(svgs.some((x) => x.includes("GIRDER SCHEDULE") && x.includes("A, F"))).toBe(true);
    expect(svgs.some((x) => x.includes("DEBONDING"))).toBe(true);
    expect(svgs.some((x) => x.includes("Span (symmetrical)") && x.includes("#5 @ 3.5"))).toBe(true); // the half-span elevation with its stirrup zones
    // Valid SVG: no attribute given twice in a tag (a picture with one doesn't show in Calcs).
    for (const svg of svgs)
      for (const tag of svg.match(/<[a-z]+\s[^>]*>/g) ?? []) {
        const names = [...tag.matchAll(/\s([a-z-]+)="/g)].map((m) => m[1]);
        expect(new Set(names).size, tag).toBe(names.length);
      }
  });
});
