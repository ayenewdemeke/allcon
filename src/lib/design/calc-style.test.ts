import { describe, expect, it } from "vitest";
import { verdictColor, NG_COLOR, OK_COLOR } from "@/lib/calcs/colors";
import { cbcCalcLines } from "./culverts/cbc-calc";
import { CBC_DEFAULTS } from "./culverts/cbc";
import { INPUT_COLOR, isInput } from "./calc-style";

describe("calc colors", () => {
  it("tells values entered from values worked out", () => {
    expect(isInput("S\\coloneq 10\\mathrm{ft}")).toBe(true);
    expect(isInput("A_{s}\\coloneq 0.64\\mathrm{in}^{2}")).toBe(true);
    expect(isInput("T_1\\coloneq 0.25\\frac{\\mathrm{in}}{\\mathrm{ft}}\\cdot h_s=")).toBe(false);
    expect(isInput("B\\coloneq S+T_s=")).toBe(false);
    expect(isInput("\\eta\\coloneq 1.05")).toBe(true);
    expect(isInput("\\operatorname{if}\\left(a\\le b,\\text{OK},\\text{NG}\\right)=")).toBe(false);
  });

  it("colors verdicts", () => {
    expect(verdictColor("\\text{OK}")).toBe(OK_COLOR);
    expect(verdictColor("\\text{NG}")).toBe(NG_COLOR);
    expect(verdictColor("\\text{Not OK}")).toBe(NG_COLOR);
    expect(verdictColor("3.2\\,\\mathrm{ft}")).toBeUndefined();
  });

  it("colors a calc package's inputs, not the analysis's values", () => {
    const lines = cbcCalcLines(CBC_DEFAULTS, "Box");
    const color = (start: string) => lines.find((l) => "math" in l && l.math.startsWith(start)) as { color?: string } | undefined;
    expect(color("S\\coloneq")?.color).toBe(INPUT_COLOR);
    expect(color("M_{DCti}\\coloneq")?.color).toBeUndefined();
    expect(color("b\\coloneq")?.color).toBeUndefined();
  });
});
