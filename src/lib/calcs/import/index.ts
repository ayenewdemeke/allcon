import { newId } from "../document";
import { isKnownFunction } from "../evaluate";
import { contentSize, emptyCalc, GRID, type CalcData, type Region, type TextRegion } from "../types";
import { latex, statementLatex, type Stmt, type X } from "./expr";
import { readMcdx } from "./mcdx";
import { readSmath } from "./smath";

// Opening Mathcad Prime (.mcdx) and SMath Studio (.sm) worksheets as Calcs worksheets: their math,
// text, solve blocks and plots where they were on the page. What can't come across (Mathcad
// programs with loops, pictures...) is listed, and noted where it was.

/** A region as read from the other program, in its own coordinates. */
export type RawRegion =
  /** ref: Mathcad's id for the region's cached result (for checking an import's numbers). */
  | { kind: "math"; x: number; y: number; stmt: Stmt; ref?: string }
  | { kind: "text"; x: number; y: number; text: string; style: TextRegion["style"] }
  | { kind: "solve"; x: number; y: number; guesses: Stmt[]; constraints: Stmt[]; solver: Stmt[] }
  | { kind: "plot"; x: number; y: number; traces: { x: X; y: X }[]; xUnit?: string; yUnit?: string }
  | { kind: "skipped"; x: number; y: number; why: string; defines?: string };

export type ImportReport = { format: "Mathcad Prime" | "SMath Studio"; regions: number; skipped: { why: string; count: number }[]; missingFunctions: string[] };

/** Functions called that neither Calcs nor the worksheet defines. */
function missingFunctions(raw: RawRegion[]): string[] {
  const called = new Set<string>();
  const defined = new Set<string>();
  const visit = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (o.k === "call" && typeof o.f === "string") called.add(o.f);
    if (o.k === "define" && typeof o.name === "string" && (o.params || o.body)) defined.add(o.name);
    if (o.kind === "skipped" && typeof o.defines === "string") defined.add(o.defines);
    Object.values(o).forEach((v) => (Array.isArray(v) ? v.forEach(visit) : visit(v)));
  };
  raw.forEach(visit);
  return [...called].filter((f) => !defined.has(f) && !isKnownFunction(f) && !["sqrt", "asin", "acos", "atan", "Max", "Min", "factorial"].includes(f)).sort();
}

const SI_UNITS = /^(mm|cm|m|km|N|kN|MN|Pa|kPa|MPa|GPa|kg|t|kNm|tonne)$/;
const US_UNITS = /^(in|ft|yd|kip|kips|lbf|lb|psi|ksi|psf|ksf|pcf|plf|klf)$/;

function unitsIn(x: unknown, found: string[]) {
  if (!x || typeof x !== "object") return;
  const o = x as Record<string, unknown>;
  if (o.k === "unit" && typeof o.v === "string") found.push(o.v);
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) v.forEach((i) => unitsIn(i, found));
    else if (v && typeof v === "object") unitsIn(v, found);
  }
}

export function importWorksheet(fileName: string, bytes: Uint8Array): { data: CalcData; report: ImportReport } {
  const lower = fileName.toLowerCase();
  const format = lower.endsWith(".sm") ? "SMath Studio" : lower.endsWith(".mcdx") ? "Mathcad Prime" : bytes[0] === 0x50 && bytes[1] === 0x4b ? "Mathcad Prime" : "SMath Studio";
  if (lower.endsWith(".xmcd")) throw new Error("Mathcad 15 files (.xmcd) can't be opened directly: open it in Mathcad Prime and save it as .mcdx first.");
  const raw = format === "Mathcad Prime" ? readMcdx(bytes) : readSmath(new TextDecoder().decode(bytes));
  if (!raw.length) throw new Error("There's nothing in this worksheet to bring in.");

  // US customary or SI, by the units it uses.
  const units: string[] = [];
  raw.forEach((r) => unitsIn(r, units));
  const si = units.filter((u) => SI_UNITS.test(u)).length;
  const us = units.filter((u) => US_UNITS.test(u)).length;
  const data = emptyCalc(us > si ? "USCS" : "SI");
  data.header = { ...data.header, title: fileName.replace(/\.(mcdx|sm)$/i, "") };

  // Placed as they were, a little further apart (Calcs' math is set larger), within the page.
  const page = contentSize(data.paper);
  const x0 = Math.min(...raw.map((r) => r.x));
  const y0 = Math.min(...raw.map((r) => r.y));
  const right = Math.max(...raw.map((r) => r.x - x0));
  const sx = Math.min(1.15, (page.width - 160) / Math.max(1, right));
  const sy = 1.3;
  const place = (r: RawRegion) => ({ x: Math.max(0, Math.round(((r.x - x0) * sx) / GRID) * GRID), y: Math.max(0, Math.round(((r.y - y0) * sy) / GRID) * GRID) });

  const skipped = new Map<string, number>();
  const regions: Region[] = [];
  const text = (r: RawRegion, s: string, style: TextRegion["style"] = "normal"): Region => {
    const at = place(r);
    return { id: newId(), kind: "text", ...at, text: s, style, width: Math.min(600, page.width - at.x) };
  };
  for (const r of raw) {
    const at = place(r);
    if (r.kind === "math") {
      const m = statementLatex(r.stmt);
      regions.push({ id: newId(), kind: "math", ...at, latex: m.latex, ...(m.displayUnit ? { displayUnit: m.displayUnit } : {}) });
    } else if (r.kind === "text") regions.push(text(r, r.text, r.style));
    else if (r.kind === "solve") {
      const line = (s: Stmt) => (s.k === "expr" ? latex(s.expr) : statementLatex(s).latex);
      regions.push({ id: newId(), kind: "solve", ...at, guesses: r.guesses.map(line), constraints: r.constraints.map(line), solver: r.solver[0] ? line(r.solver[0]) : "" });
    } else if (r.kind === "plot") {
      regions.push({ id: newId(), kind: "plot", ...at, width: 360, height: 240, traces: r.traces.map((t) => ({ x: latex(t.x), y: latex(t.y) })), ...(r.xUnit ? { xUnit: r.xUnit } : {}), ...(r.yUnit ? { yUnit: r.yUnit } : {}) });
    } else {
      skipped.set(r.why, (skipped.get(r.why) ?? 0) + 1);
      regions.push(text(r, `Not brought in from ${format}: ${r.why}${r.defines ? ` (defining ${r.defines.replace(/_/, " ")})` : ""}.`, "note"));
    }
  }
  data.regions = regions;
  return { data, report: { format, regions: regions.length, skipped: [...skipped].map(([why, count]) => ({ why, count })), missingFunctions: missingFunctions(raw) } };
}
