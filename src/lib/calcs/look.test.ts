import { describe, expect, it } from "vitest";
import { INPUT_COLOR } from "../design/calc-style";
import { boldVerdict, INPUT_BLUE, mathColor, styleUnits, UNIT_COLOR } from "./look";

describe("a worksheet's look, as Mathcad Prime's", () => {
  it("units bold, italic and dark blue, with their powers; subscripts and NaN left alone", () => {
    expect(styleUnits("f_y\\coloneq120\\,\\mathrm{ksi}")).toBe(`f_y\\coloneq120\\,\\textcolor{${UNIT_COLOR}}{\\mathbfit{ksi}}`);
    expect(styleUnits("A\\coloneq3\\,\\mathrm{in}^{2}")).toContain("\\mathbfit{in}^{2}}");
    expect(styleUnits("M_{\\mathrm{u}}\\coloneq1")).toBe("M_{\\mathrm{u}}\\coloneq1");
    expect(styleUnits("\\mathrm{NaN}")).toBe("\\mathrm{NaN}");
  });

  it("verdicts bold", () => {
    expect(boldVerdict("\\text{OK}")).toBe("\\textbf{OK}");
    expect(boldVerdict("3\\,\\mathrm{ft}")).toBe("3\\,\\mathrm{ft}");
  });

  it("values entered black, blue when asked; a color chosen stays", () => {
    const input = { latex: "E\\coloneq29000\\,\\mathrm{ksi}", color: INPUT_COLOR };
    expect(mathColor(input, { show: true, size: "standard" })).toBeUndefined();
    expect(mathColor(input, { show: true, size: "standard", inputsBlue: true })).toBe(INPUT_BLUE);
    expect(mathColor({ latex: "E\\coloneq2" }, { show: true, size: "standard", inputsBlue: true })).toBe(INPUT_BLUE);
    expect(mathColor({ latex: "E\\coloneq2", color: "#dc2626" }, undefined)).toBe("#dc2626");
  });
});
