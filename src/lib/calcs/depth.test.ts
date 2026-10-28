import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type Result, type SheetItem } from "./evaluate";

// Phase 2: matrices, ranges, calculus, piecewise, solving, tables and plots.

const math = (latex: string, displayUnit?: string): SheetItem => ({ id: latex, kind: "math", latex, displayUnit });
const run = (items: SheetItem[]) => {
  const results = evaluateSheet(items.map((it, i) => ({ ...it, id: String(i) })), DEFAULT_SETTINGS);
  return items.map((_, i) => results.get(String(i))!);
};
const shown = (r: Result) => (r.kind === "ok" ? r.result : r.kind === "error" ? `ERROR: ${r.message}` : r.kind);
const M = "\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}";

describe("matrices and vectors", () => {
  it("transpose, inverse, determinant, length, product and indices", () => {
    const r = run([
      math(`M\\coloneq${M}`),
      math("M^{T}="),
      math("M^{-1}="),
      math("\\left|M\\right|="),
      math("v\\coloneq\\begin{pmatrix}3\\\\4\\end{pmatrix}"),
      math("\\left|v\\right|="),
      math("M\\cdot v="),
      math("v\\left[1\\right]="),
      math("F\\coloneq\\begin{pmatrix}10kip\\\\20kip\\end{pmatrix}="),
    ]);
    expect(shown(r[1])).toBe("\\begin{bmatrix}1 & 3\\\\ 2 & 4\\end{bmatrix}");
    expect(shown(r[2])).toBe("\\begin{bmatrix}-2 & 1\\\\ 1.5 & -0.5\\end{bmatrix}");
    expect(shown(r[3])).toBe("-2");
    expect(shown(r[5])).toBe("5");
    expect(shown(r[6])).toBe("\\begin{bmatrix}11\\\\ 25\\end{bmatrix}");
    expect(shown(r[7])).toBe("4"); // ORIGIN 0
    expect(shown(r[8])).toBe("\\begin{bmatrix}10\\\\ 20\\end{bmatrix}\\,\\mathrm{kip}");
  });
});

describe("ranges and sums", () => {
  it("iterate, and sum", () => {
    const r = run([math("i\\coloneq0..4"), math("i^2="), math("\\sum_{k=1}^{4}k="), math("\\sum_{i}i="), math("x\\coloneq0,0.5..2"), math("\\max\\left(x\\right)=")]);
    expect(shown(r[1])).toContain("16");
    expect(shown(r[2])).toBe("10");
    expect(shown(r[3])).toBe("10");
    expect(shown(r[5])).toBe("2");
  });
});

describe("calculus", () => {
  it("integrals (with units) and derivatives at the variable's value", () => {
    const r = run([
      math("\\int_{0}^{2}x^2\\,dx="),
      math("w\\coloneq2klf"),
      math("\\int_{0}^{10ft}w\\,dx="),
      math("x\\coloneq3"),
      math("\\frac{d}{dx}x^3="),
    ]);
    expect(shown(r[0])).toBe("2.667");
    expect(shown(r[2])).toBe("20\\,\\mathrm{kip}");
    expect(shown(r[4])).toBe("27");
  });
});

describe("if / otherwise", () => {
  it("piecewise functions", () => {
    const r = run([math("f\\left(x\\right)\\coloneq\\begin{cases}-x&x<0\\\\x^2&\\text{otherwise}\\end{cases}"), math("f\\left(-3\\right)="), math("f\\left(2\\right)=")]);
    expect(shown(r[1])).toBe("3");
    expect(shown(r[2])).toBe("4");
  });
});

describe("solving", () => {
  it("root, minimize and polyroots", () => {
    const r = run([
      math("x\\coloneq1"),
      math("\\operatorname{root}\\left(x^2-2,x\\right)="),
      math("\\operatorname{root}\\left(\\cos\\left(t\\right),t,0,3\\right)="),
      math("f\\left(x\\right)\\coloneq\\left(x-3\\right)^2+1"),
      math("\\operatorname{minimize}\\left(f,x\\right)="),
      math("\\operatorname{polyroots}\\left(\\begin{pmatrix}-2\\\\0\\\\1\\end{pmatrix}\\right)="),
    ]);
    expect(shown(r[1])).toBe("1.414");
    expect(shown(r[2])).toBe("1.571");
    expect(shown(r[4])).toBe("3");
    expect(shown(r[5])).toMatch(/1\.414/);
  });

  it("a solve block: guesses, constraints, find", () => {
    const r = run([
      { id: "", kind: "solve", guesses: ["x\\coloneq1", "y\\coloneq1"], constraints: ["x+y=3", "x-y=1"], solver: "\\begin{pmatrix}a\\\\b\\end{pmatrix}\\coloneq\\operatorname{find}\\left(x,y\\right)" },
      math("a="),
      math("b="),
      { id: "", kind: "solve", guesses: ["L\\coloneq1ft"], constraints: ["\\frac{2klf\\cdot L^2}{8}=100kip\\cdot ft"], solver: "L_{req}\\coloneq\\operatorname{find}\\left(L\\right)=" },
    ]);
    expect(shown(r[1])).toBe("2");
    expect(shown(r[2])).toBe("1");
    const block = r[3];
    expect(block.kind === "solve" && shown(block.solver)).toBe("20\\,\\mathrm{ft}");
  });
});

describe("tables and plots", () => {
  it("a table defines vectors; a plot gets numbers in its units", () => {
    const r = run([
      { id: "", kind: "table", columns: [{ name: "x", unit: "ft" }, { name: "P", unit: "kip" }], rows: [["0", "1"], ["10", "3"], ["20", "2"]] },
      math("\\max\\left(P\\right)="),
      math("i\\coloneq0..2"),
      { id: "", kind: "plot", traces: [{ x: "x", y: "P" }, { x: "i", y: "i^2" }] },
      { id: "", kind: "plot", traces: [{ x: "t", y: "t^2" }] },
    ]);
    expect(shown(r[1])).toBe("3\\,\\mathrm{kip}");
    const plot = r[3];
    expect(plot.kind === "plot" && plot.traces[0]).toMatchObject({ xs: [0, 10, 20], ys: [1, 3, 2] });
    expect(plot.kind === "plot" && plot.xUnit).toBe("ft");
    const quick = r[4];
    expect(quick.kind === "plot" && quick.traces[0].xs.length).toBe(201); // QuickPlot: -10..10
  });
});
