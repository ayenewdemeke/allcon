import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, putSymbolicAnswers, takeSymbolicRequests, type Result, type SheetItem } from "./evaluate";
import { importWorksheet } from "./import";
import { readingOrder } from "./types";

// Phase 5: symbolic evaluation (→), and opening Mathcad Prime and SMath Studio worksheets, with
// the engine features they need (element definitions, several names at once, and/or...).

const math = (latex: string): SheetItem => ({ id: latex, kind: "math", latex });
const run = (items: SheetItem[]) => {
  const results = evaluateSheet(items.map((it, i) => ({ ...it, id: String(i) })), DEFAULT_SETTINGS);
  return items.map((_, i) => results.get(String(i))!);
};
const shown = (r: Result) => (r.kind === "ok" ? r.result : r.kind === "error" ? `ERROR: ${r.message}` : r.kind);

describe("symbolic evaluation", () => {
  it("asks for what it doesn't know, then shows the answer", () => {
    takeSymbolicRequests();
    const items = [math("f\\left(x\\right)\\coloneq x^2-1"), math("\\operatorname{factor}\\left(f\\left(x\\right)\\right)\\to"), math("\\int L\\cdot x\\,dx\\to")];
    const first = run(items);
    expect(shown(first[1])).toBe("\\ldots");
    const requests = takeSymbolicRequests();
    expect(requests).toHaveLength(2);
    // The function is written out; names go as s0, s1... with how to show them.
    expect(requests[0].tree).toEqual(["kw", "factor", ["sub", ["pow", ["sym", "s0"], ["num", "2"]], ["num", "1"]]]);
    expect(requests[0].names).toEqual({ s0: "x" });
    expect(requests[1].tree).toEqual(["integral", ["sym", "s1"], null, null, ["mul", ["sym", "s0"], ["sym", "s1"]]]);
    expect(takeSymbolicRequests()).toHaveLength(0); // each asked once
    putSymbolicAnswers({ [requests[0].key]: { latex: "\\left(x-1\\right)\\left(x+1\\right)" }, [requests[1].key]: { error: "nope" } });
    const second = run(items);
    expect(shown(second[1])).toBe("\\left(x-1\\right)\\left(x+1\\right)");
    expect(shown(second[2])).toBe("ERROR: nope");
  });

  it("keeps units as symbols and says when an integral needs →", () => {
    takeSymbolicRequests();
    run([math("5\\mathrm{kN}\\cdot x\\to")]);
    const [r] = takeSymbolicRequests();
    expect(r.names).toEqual({ s0: "\\mathrm{kN}", s1: "x" });
    expect(shown(run([math("\\int x\\,dx=")])[0])).toMatch(/symbolically/);
  });
});

describe("what imported worksheets need", () => {
  it("reads upright letters as units: grams, not gravity", () => {
    const [, rho] = run([math("\\rho\\coloneq7.85\\frac{\\mathrm{g}}{\\mathrm{cm}^{3}}"), math("\\rho=")]);
    expect(shown(rho)).toBe("7.85\\,\\mathrm{g}/\\mathrm{cm}^{3}");
  });

  it("defines vectors element by element over a range", () => {
    const r = run([math("i\\coloneq0..3"), math("X\\left[i\\right]\\coloneq i^2"), math("X="), math("X\\left[5\\right]\\coloneq1"), math("X\\left[5\\right]=")]);
    expect(shown(r[2])).toBe("\\begin{bmatrix}0\\\\ 1\\\\ 4\\\\ 9\\end{bmatrix}");
    expect(shown(r[4])).toBe("1");
  });

  it("defines several names at once, row by row", () => {
    const r = run([math("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\coloneq\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}"), math("b="), math("c=")]);
    expect([shown(r[1]), shown(r[2])]).toEqual(["2", "3"]);
  });

  it("joins conditions with and / or, and adds angles to numbers as radians", () => {
    const r = run([math("\\operatorname{if}\\left(1<2\\land3<2,\\text{yes},\\text{no}\\right)="), math("\\operatorname{if}\\left(1<2\\lor3<2,\\text{yes},\\text{no}\\right)="), math("\\frac{\\pi}{4}+45\\mathrm{deg}=")]);
    expect(shown(r[0])).toBe("\\text{no}");
    expect(shown(r[1])).toBe("\\text{yes}");
    expect(shown(r[2])).toBe("1.571");
  });

  it("takes a vector's dot product, and a 1 × 1 product as a number", () => {
    const r = run([math("a\\coloneq\\begin{pmatrix}1\\\\2\\\\3\\end{pmatrix}"), math("a\\cdot a="), math("a^{T}\\cdot a=")]);
    expect([shown(r[1]), shown(r[2])]).toEqual(["14", "14"]);
  });

  it("solves again for each call of a solve function", () => {
    const items: SheetItem[] = [{ id: "s", kind: "solve", guesses: ["x\\coloneq1"], constraints: ["x^2=a"], solver: "r\\left(a\\right)\\coloneq\\operatorname{find}\\left(x\\right)" }, math("r\\left(9\\right)="), math("r\\left(16\\right)=")];
    const r = run(items);
    expect([shown(r[1]), shown(r[2])]).toEqual(["3", "4"]);
  });
});

describe("importing", () => {
  const MATH = 'xmlns:ml="http://schemas.mathsoft.com/math50"';
  const id = (n: string, sub?: string) =>
    sub ? `<ml:id labels="VARIABLE"><Span xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:pw="clr-namespace:Ptc.Wpf;assembly=Ptc.Core">${n}<pw:Subscript>${sub}</pw:Subscript></Span></ml:id>` : `<ml:id labels="VARIABLE">${n}</ml:id>`;
  const region = (top: number, body: string) => `<region region-id="${top}" top="${top}" left="19.2">${body}</region>`;
  const mcdx = (regions: string[], text?: string) => {
    const files: Record<string, Uint8Array> = {
      "mathcad/worksheet.xml": strToU8(`<worksheet xmlns="http://schemas.mathsoft.com/worksheet50" ${MATH}><regions>${regions.join("")}</regions></worksheet>`),
    };
    if (text) {
      files["mathcad/_rels/worksheet.xml.rels"] = strToU8('<Relationships><Relationship Id="R1" Target="/mathcad/xaml/FlowDocument0.XamlPackage" /></Relationships>');
      files["mathcad/xaml/FlowDocument0.XamlPackage"] = zipSync({ "Xaml/Document.xaml": strToU8(`<Section xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><Paragraph><Run>${text}</Run></Paragraph></Section>`) });
    }
    return zipSync(files);
  };

  it("brings a Mathcad Prime worksheet across: definitions with units, functions, piecewise, results in a unit", () => {
    const bytes = mcdx(
      [
        region(10, '<text item-idref="R1" />'),
        region(40, `<math><ml:define>${id("f", "ck")}<ml:apply><ml:scale /><ml:real>35</ml:real><ml:id labels="UNIT">MPa</ml:id></ml:apply></ml:define></math>`),
        region(70, `<math><ml:define>${id("f", "cd")}<ml:eval><ml:apply><ml:div />${id("f", "ck")}<ml:real>1.5</ml:real></ml:apply><ml:unitOverride><ml:id labels="UNIT">MPa</ml:id></ml:unitOverride></ml:eval></ml:define></math>`),
        region(100, `<math><ml:define><ml:function>${id("g")}<ml:boundVars>${id("e")}</ml:boundVars></ml:function><ml:if><ml:test><ml:apply><ml:greaterThan />${id("e")}<ml:real>0</ml:real></ml:apply></ml:test><ml:then><ml:program><ml:real>0</ml:real></ml:program></ml:then><ml:else><ml:program>${id("e")}</ml:program></ml:else></ml:if></ml:define></math>`),
        region(130, `<math><ml:eval><ml:apply>${id("g")}<ml:real>-2</ml:real></ml:apply></ml:eval></math>`),
        region(160, `<math><ml:define>${id("s")}<ml:program><ml:localDefine>${id("j")}<ml:real>0</ml:real></ml:localDefine></ml:program></ml:define></math>`),
      ],
      "Concrete strength",
    );
    const { data, report } = importWorksheet("concrete.mcdx", bytes);
    expect(data.settings.system).toBe("SI");
    const regions = readingOrder(data.regions);
    expect(regions.map((r) => (r.kind === "math" ? r.latex : r.kind === "text" ? r.text : r.kind))).toEqual([
      "Concrete strength",
      "f_{ck}\\coloneq 35\\mathrm{MPa}",
      "f_{cd}\\coloneq \\frac{f_{ck}}{1.5}=",
      "g\\left(e\\right)\\coloneq \\begin{cases}0 & e>0\\\\ e & \\text{otherwise}\\end{cases}",
      "g\\left(-2\\right)=",
      "Not brought in from Mathcad Prime: a Mathcad program (defining s).",
    ]);
    expect(report.skipped).toEqual([{ why: "a Mathcad program", count: 1 }]);
    const results = evaluateSheet(regions.flatMap((r): SheetItem[] => (r.kind === "text" ? [] : [r as SheetItem])), data.settings);
    expect(results.get(regions[2].id)).toMatchObject({ result: "23.333\\,\\mathrm{MPa}" });
    expect(results.get(regions[4].id)).toMatchObject({ result: "-2" });
  });

  it("brings an SMath Studio worksheet across (postfix math, σ.max subscripts, display units)", () => {
    const e = (type: string, v: string, extra = "") => `<e type="${type}"${extra}>${v}</e>`;
    const sm = `<?xml version="1.0" encoding="utf-8"?><regions xmlns="http://smath.info/schemas/worksheet/1.0">
      <region id="0" left="18" top="27"><text lang="eng"><p bold="true">Beam</p></text></region>
      <region id="1" left="234" top="72"><math><input>${e("operand", "l")}${e("operand", "2")}${e("operand", "m", ' style="unit"')}${e("operator", "*", ' args="2"')}${e("operator", ":", ' args="2"')}</input></math></region>
      <region id="2" left="234" top="99"><math><input>${e("operand", "q.0")}${e("operand", "5")}${e("operand", "kN", ' style="unit"')}${e("operand", "m", ' style="unit"')}${e("operator", "/", ' args="2"')}${e("operator", "*", ' args="2"')}${e("operator", ":", ' args="2"')}</input></math></region>
      <region id="3" left="234" top="126"><math><input>${e("operand", "M.max")}${e("operand", "q.0")}${e("operand", "l")}${e("operand", "2")}${e("operator", "^", ' args="2"')}${e("operator", "*", ' args="2"')}${e("operand", "8")}${e("operator", "/", ' args="2"')}${e("operator", ":", ' args="2"')}</input></math></region>
      <region id="4" left="234" top="153"><math><input>${e("operand", "M.max")}</input><contract>${e("operand", "kN", ' style="unit"')}${e("operand", "m", ' style="unit"')}${e("operator", "*", ' args="2"')}</contract><result action="numeric">${e("operand", "2.5")}</result></math></region>
    </regions>`;
    const { data } = importWorksheet("beam.sm", strToU8(sm));
    const regions = readingOrder(data.regions);
    expect(regions.map((r) => (r.kind === "math" ? `${r.latex}${r.displayUnit ? ` [${r.displayUnit}]` : ""}` : r.kind === "text" ? `${r.text} (${r.style})` : r.kind))).toEqual([
      "Beam (subheading)",
      "l\\coloneq 2\\mathrm{m}",
      "q_{0}\\coloneq 5\\frac{\\mathrm{kN}}{\\mathrm{m}}",
      "M_{max}\\coloneq \\frac{q_{0}\\cdot l^{2}}{8}",
      "M_{max}= [kN*m]",
    ]);
    const results = evaluateSheet(regions.flatMap((r): SheetItem[] => (r.kind === "text" ? [] : [r as SheetItem])), data.settings);
    expect(results.get(regions[4].id)).toMatchObject({ result: "2.5\\,\\mathrm{kN}\\cdot \\mathrm{m}" });
  });

  it("says plainly when a file isn't one it can open", () => {
    expect(() => importWorksheet("old.xmcd", strToU8("<worksheet/>"))).toThrow(/Mathcad 15/);
    expect(() => importWorksheet("x.mcdx", strToU8("not a zip"))).toThrow(/isn't a Mathcad Prime file/);
  });
});
