import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type Result, type SheetItem } from "./evaluate";
import { materials } from "./library/materials";
import { findShape, loadShapes, searchShapes } from "./library/shapes";
import { layout, snippetLines, TEMPLATES, type Line } from "./library/templates";
import { readingOrder } from "./types";

const math = (latex: string): SheetItem => ({ id: latex, kind: "math", latex });
const run = (items: SheetItem[], settings = DEFAULT_SETTINGS) => {
  const r = evaluateSheet(items, settings);
  return items.map((i) => r.get(i.id)!);
};
const shown = (r: Result) => (r.kind === "ok" ? r.result : r.kind === "error" ? `error: ${r.message}` : r.kind);

beforeAll(() => loadShapes());

describe("steel shapes", () => {
  it("finds shapes by either designation", () => {
    expect(findShape("w14x22")?.values.A).toBe(6.49);
    expect(findShape("W 14 × 22")?.label).toBe("W14X22");
    expect(findShape("W360X32.9")?.label).toBe("W14X22");
    expect(findShape("HSS6X6X1/4")?.values.tdes).toBe(0.233);
    expect(searchShapes("W14X2", "W").map((s) => s.label)).toContain("W14X26");
  });

  it("defines a section's properties", () => {
    const r = run([{ id: "s", kind: "section", shape: "W14X22" }, math("Z_x="), math("F_y\\coloneq50ksi"), math("M_p\\coloneq F_y\\cdot Z_x="), math("\\lambda_f="), math("w_{sw}=")]);
    expect(r[0].kind).toBe("section");
    expect(shown(r[1])).toBe("33.2\\,\\mathrm{in}^{3}");
    expect(shown(r[3])).toBe("138.333\\,\\mathrm{kip}\\cdot \\mathrm{ft}");
    expect(shown(r[4])).toBe("7.46");
    expect(shown(r[5])).toBe("0.022\\,\\mathrm{kip}/\\mathrm{ft}");
  });

  it("adds a subscript to tell sections apart, and looks properties up by function", () => {
    const r = run([{ id: "b", kind: "section", shape: "W18X50", suffix: "b" }, math("I_{x,b}="), math("A_b="), math('\\operatorname{section}\\left(\\text{W14X22},\\text{Sx}\\right)='), math('\\operatorname{section}\\left(\\text{W14X22},\\text{nope}\\right)=')]);
    expect(shown(r[1])).toBe("800\\,\\mathrm{in}^{4}");
    expect(shown(r[2])).toBe("14.7\\,\\mathrm{in}^{2}");
    expect(shown(r[3])).toBe("29\\,\\mathrm{in}^{3}");
    expect(shown(r[4])).toBe("error: W14X22 has no nope");
  });

  it("shows properties in SI, and says when a shape doesn't exist", () => {
    const [s] = run([{ id: "s", kind: "section", shape: "W14X22" }], { ...DEFAULT_SETTINGS, system: "SI" });
    expect(s.kind === "section" && s.rows.find((r) => r.name === "A")?.value).toBe("4187.088\\,\\mathrm{mm}^{2}");
    const [bad] = run([{ id: "x", kind: "section", shape: "W14X23" }]);
    expect(shown(bad)).toBe("error: There's no W14X23 in the AISC tables");
  });
});

describe("templates and materials", () => {
  const evaluateLines = (lines: Line[], settings = DEFAULT_SETTINGS) => {
    const regions = readingOrder(layout(lines, { x: 0, y: 0 }));
    const items = regions.flatMap((r): SheetItem[] => (r.kind === "text" ? [] : [r as SheetItem]));
    const results = evaluateSheet(items, settings);
    return { regions, results, at: (latex: string) => results.get(regions.find((r) => r.kind === "math" && r.latex === latex)!.id)! };
  };

  for (const t of TEMPLATES)
    it(`works out the ${t.id} template with no errors`, () => {
      const { regions, results } = evaluateLines(t.lines);
      const errors = regions.flatMap((r) => {
        const res = results.get(r.id);
        return res?.kind === "error" ? [`${r.kind === "math" ? r.latex : r.kind}: ${res.message}`] : [];
      });
      expect(errors).toEqual([]);
      const checks = regions.filter((r) => r.kind === "math" && r.latex.startsWith("\\operatorname{if}")).map((r) => shown(results.get(r.id)!));
      expect(checks.every((c) => !c?.includes("NG"))).toBe(true);
    });

  it("gets the steel beam's numbers", () => {
    const { at } = evaluateLines(TEMPLATES[0].lines);
    expect(shown(at("L_p\\coloneq1.76\\cdot r_y\\cdot\\sqrt{\\frac{E}{F_y}}="))).toBe("5.828\\,\\mathrm{ft}");
    expect(shown(at("\\phi_b\\cdot M_n="))).toMatch(/^30\d\.\d+\\,\\mathrm{kip}/);
  });

  it("inserts every material in both unit systems without errors", () => {
    for (const system of ["USCS", "SI"] as const)
      for (const group of materials(system))
        for (const item of group.items) {
          const { regions, results } = evaluateLines(snippetLines(item), { ...DEFAULT_SETTINGS, system });
          const errors = regions.filter((r) => results.get(r.id)?.kind === "error").map((r) => (r.kind === "math" ? r.latex : r.kind));
          expect(errors, `${group.id} ${item.label}`).toEqual([]);
        }
  });
});
