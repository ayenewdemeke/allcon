import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, formatNumber } from "./evaluate";
import { greekify, parseStatement } from "./parse";

// Worksheets as Mathcad evaluates them, with math as MathLive writes it.

const run = (latex: string[], settings = DEFAULT_SETTINGS, units: Record<number, string> = {}) => {
  const results = evaluateSheet(latex.map((l, i) => ({ id: String(i), kind: "math" as const, latex: l, displayUnit: units[i] })), settings);
  return latex.map((_, i) => results.get(String(i))!);
};
const shown = (r: ReturnType<typeof run>[number]) => (r.kind === "ok" ? r.result : r.kind === "error" ? `ERROR: ${r.message}` : r.kind);

describe("reading math", () => {
  it("names, subscripts, primes, juxtaposition and definitions", () => {
    expect(parseStatement("M_{u}\\coloneq\\frac{w\\cdot L^2}{8}=")).toMatchObject({ k: "define", name: "M_u", show: true });
    expect(parseStatement("f^{\\prime}_{c}\\coloneq4000\\,psi")).toMatchObject({ k: "define", name: "f'_c" });
    expect(parseStatement("f\\left(x,y\\right)\\coloneq x+y")).toMatchObject({ k: "define", name: "f", params: ["x", "y"] });
    expect(parseStatement("5ft+3")).toMatchObject({ k: "expression" });
    expect(() => parseStatement("x\\coloneq\\placeholder{}")).toThrow();
    expect(greekify("phi\\coloneq0.9\\cdot beta_{1}+alphabet")).toBe("\\phi\\coloneq0.9\\cdot\\beta_{1}+alphabet");
    expect(greekify("\\text{alpha}+\\pi")).toBe("\\text{alpha}+\\pi");
  });
});

describe("a structural calc", () => {
  it("works it out with units, in structural units", () => {
    const r = run([
      "w\\coloneq2\\,klf",
      "L\\coloneq20ft",
      "M\\coloneq\\frac{w\\cdot L^2}{8}=",
      "\\phi\\coloneq0.9",
      "d\\coloneq20\\,in",
      "A_{s}\\coloneq\\frac{M}{\\phi\\cdot60ksi\\cdot0.9d}=",
      "\\operatorname{if}\\left(M\\le150kip\\cdot ft,\\text{OK},\\text{NG}\\right)=",
      "f^{\\prime}_{c}\\coloneq4000psi",
      "\\sqrt{f^{\\prime}_{c}\\cdot psi}=",
      "\\frac{L}{d}=",
    ]);
    expect(shown(r[2])).toBe("100\\,\\mathrm{kip}\\cdot \\mathrm{ft}");
    expect(shown(r[5])).toMatch(/^1\.235\\,\\mathrm\{in\}\^\{2\}$/);
    expect(shown(r[6])).toBe("\\text{OK}");
    expect(shown(r[8])).toBe("63.246\\,\\mathrm{psi}"); // ACI's sqrt(f'c), in psi
    expect(shown(r[9])).toBe("12"); // ft/in: a plain number
  });

  it("shows a result in the unit asked for, and in SI", () => {
    const r = run(["P\\coloneq10kip", "P="], DEFAULT_SETTINGS, { 1: "kN" });
    expect(shown(r[1])).toBe("44.482\\,\\mathrm{kN}");
    const si = run(["F\\coloneq3kN", "a\\coloneq2m", "F\\cdot a="], { system: "SI", decimals: 2 });
    expect(shown(si[2])).toBe("6\\,\\mathrm{kN}\\cdot \\mathrm{m}");
  });

  it("functions, and errors as Mathcad shows them", () => {
    const r = run(["f\\left(x\\right)\\coloneq x^2+1", "f\\left(3\\right)=", "y=", "5ft+3kip=", "z\\coloneq"]);
    expect(shown(r[1])).toBe("10");
    expect(r[2]).toMatchObject({ kind: "error", message: "y isn't defined" });
    expect(r[3]).toMatchObject({ kind: "error", message: "The units don't match" });
    expect(r[4]).toMatchObject({ kind: "error", incomplete: true });
  });

  it("formats numbers as Mathcad does", () => {
    expect(formatNumber(12.5, 3)).toBe("12.5");
    expect(formatNumber(1 / 3, 3)).toBe("0.333");
    expect(formatNumber(123456789, 3)).toBe("1.235\\cdot 10^{8}");
    expect(formatNumber(0.00001234, 3)).toBe("1.234\\cdot 10^{-5}");
  });
});
