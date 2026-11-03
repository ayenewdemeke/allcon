import { describe, expect, it } from "vitest";
import { cbcCalcLines } from "./culverts/cbc-calc";
import { CBC_DEFAULTS } from "./culverts/cbc";
import { bearingCalcLines } from "./bearings/elastomeric-calc";
import { BEARING_DEFAULTS } from "./bearings/elastomeric";
import { DECK_DEFAULTS } from "./decks/deck";
import { bearingFigures, cbcFigures, cipFigures, deckFigures, mseFigures, wingwallFigures } from "./figures";
import { WINGWALL_DEFAULTS } from "./walls/wingwall";
import { cipCalcLines } from "./walls/cip-calc";
import { CIP_DEFAULTS } from "./walls/cip";
import { mseCalcLines } from "./walls/mse-calc";
import { MSE_DEFAULTS } from "./walls/mse";

const pictures = (lines: ReturnType<typeof cbcCalcLines>) => lines.filter((l) => "region" in l && l.region.kind === "image");

describe("design figures", () => {
  it("draws the sketches as standalone SVG", () => {
    const { section, moments } = cbcFigures({ ...CBC_DEFAULTS, cells: 2 });
    for (const f of [section, moments]) {
      expect(f.width).toBe(520);
      expect(f.height).toBe(380);
      expect(f.svg).toMatch(/^<svg width="520" height="380" font-family="[^"]+" viewBox="0 0 520 380"/);
      expect(f.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(f.svg).toContain('stroke-width="1.2"');
      expect(f.svg).toContain('patternUnits="userSpaceOnUse"');
      expect(f.svg).not.toMatch(/className|class=|currentColor|strokeWidth/);
      expect(f.svg).toContain("2 cells × 10'-0&quot; span");
    }
    // The envelope (and its peak labels) only on the moment figure.
    expect(moments.svg).toContain("#2563eb");
    expect(section.svg).not.toContain("#2563eb");
  });

  it("draws a bearing pad's plan and section, layer by layer", () => {
    const { section } = bearingFigures(BEARING_DEFAULTS);
    expect(section.width).toBe(520);
    expect(section.height).toBe(260);
    expect(section.svg).not.toMatch(/className|class=|strokeWidth/);
    expect(section.svg.match(/fill="#64748b"/g)).toHaveLength(BEARING_DEFAULTS.n + 1); // the shims
    expect(section.svg).toContain("9 layers of 0.5&quot;");
    expect(pictures(bearingCalcLines(BEARING_DEFAULTS, "Bearing", bearingFigures(BEARING_DEFAULTS)))).toHaveLength(1);
  });

  it("draws a wingwall's elevation with the loaded face and the thrust", () => {
    const { section } = wingwallFigures(WINGWALL_DEFAULTS);
    expect(section.width).toBe(520);
    expect(section.svg).toContain("#fde68a");
    expect(section.svg).toContain("P = 41.5 kip (service)");
    expect(section.svg).not.toMatch(/className|class=|strokeWidth/);
  });

  it("draws a deck's cross-section with its girders and design sections", () => {
    const { section } = deckFigures(DECK_DEFAULTS);
    expect(section.height).toBe(300);
    expect(section.svg.match(/width="6"/g)).toHaveLength(DECK_DEFAULTS.nGirders); // the girder webs
    expect(section.svg).toContain("−M");
    expect(section.svg).not.toMatch(/className|class=|strokeWidth/);
  });

  it("puts them in the calc packages", () => {
    expect(pictures(cbcCalcLines(CBC_DEFAULTS, "Box", cbcFigures(CBC_DEFAULTS)))).toHaveLength(2);
    expect(pictures(cipCalcLines(CIP_DEFAULTS, "Wall", cipFigures(CIP_DEFAULTS)))).toHaveLength(1);
    expect(pictures(mseCalcLines(MSE_DEFAULTS, "MSE", mseFigures(MSE_DEFAULTS)))).toHaveLength(1);
    expect(pictures(cbcCalcLines(CBC_DEFAULTS, "Box"))).toHaveLength(0);
  });
});
