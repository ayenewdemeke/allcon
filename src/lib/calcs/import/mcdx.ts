import { DOMParser, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { Unsupported, unitOnly, unitText, type Stmt, type X } from "./expr";
import type { RawRegion } from "./index";

// Mathcad Prime worksheets (.mcdx): a zip whose mathcad/worksheet.xml holds the regions, their
// math in Mathcad's XML (ml:define, ml:apply...), and text regions as XAML packages (zips again).

const kids = (el: Element) => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
const local = (el: Element) => el.localName ?? el.nodeName.replace(/^.*:/, "");
const child = (el: Element, name: string) => kids(el).find((c) => local(c) === name);

/** A name: its text, with a subscript from <pw:Subscript>: n_t, ϕ_t. */
function idName(el: Element): string {
  const span = kids(el).find((c) => local(c) === "Span");
  if (!span) return (el.textContent ?? "").trim();
  let base = "";
  let sub = "";
  for (const n of Array.from(span.childNodes)) {
    if (n.nodeType === 3) base += n.nodeValue ?? "";
    else if (n.nodeType === 1 && local(n as Element) === "Subscript") sub += (n as Element).textContent ?? "";
  }
  return sub ? `${base.trim()}_${sub.trim()}` : base.trim();
}

const CONSTANTS: Record<string, string> = { π: "pi", "∞": "infty", e: "e", g: "g" };
const RELATIONS: Record<string, "=" | "<" | ">" | "<=" | ">=" | "!="> = { equal: "=", lessThan: "<", greaterThan: ">", lessOrEqual: "<=", greaterOrEqual: ">=", notEqual: "!=" };

/** A lambda's variable and body (Σ, ∫, d/dx). */
function lambda(el: Element | undefined) {
  if (!el) throw new Unsupported("unfinished math");
  const vars = child(el, "boundVars");
  const body = kids(el).find((c) => local(c) !== "boundVars");
  if (!vars || !body) throw new Unsupported("unfinished math");
  return { v: idName(kids(vars)[0]), body: expr(body) };
}

/** Mathcad's math as an expression. */
export function expr(el: Element): X {
  const name = local(el);
  switch (name) {
    case "real":
      return { k: "num", v: (el.textContent ?? "0").trim() };
    case "str":
      return { k: "str", v: el.textContent ?? "" };
    case "id": {
      const label = el.getAttribute("labels") ?? "";
      const text = idName(el);
      if (label === "UNIT") return { k: "unit", v: text };
      if (label === "CONSTANT") return { k: "name", v: CONSTANTS[text] ?? text };
      return { k: "name", v: text === "π" ? "pi" : text };
    }
    case "parens":
      return { k: "paren", a: expr(kids(el)[0]) };
    case "matrix": {
      // Column by column.
      const rows = Number(el.getAttribute("rows"));
      const cols = Number(el.getAttribute("cols"));
      const cells = kids(el).map(expr);
      return { k: "matrix", rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cells[c * rows + r])) };
    }
    case "range": {
      const parts = kids(el);
      if (parts.length === 2 && local(parts[0]) === "sequence") {
        const [first, second] = kids(parts[0]).map(expr);
        return { k: "range", first, second, last: expr(parts[1]) };
      }
      return { k: "range", first: expr(parts[0]), last: expr(parts[parts.length - 1]) };
    }
    case "apply":
      return apply(el);
    case "if":
    case "program":
      return program(el);
    case "placeholder":
      throw new Unsupported("unfinished math");
    case "eval":
      return expr(kids(el)[0]);
    default:
      throw new Unsupported(name === "localDefine" || name === "for" || name === "while" || name === "return" ? "a Mathcad program" : `Mathcad's ${name}`);
  }
}

function apply(el: Element): X {
  const [head, ...rest] = kids(el);
  const args = rest.flatMap((a) => (local(a) === "sequence" ? kids(a) : [a]));
  const op = local(head);
  const arg = (i: number) => expr(args[i]);
  if (op === "id") {
    const label = head.getAttribute("labels") ?? "";
    const f = idName(head);
    if (f === "if" && (label === "KEYWORD" || label === "FUNCTION") && args.length === 3) return { k: "if", cond: arg(0), a: arg(1), b: arg(2) };
    return { k: "call", f, args: args.map(expr) };
  }
  const bin = (o: "+" | "-" | "*" | "/" | "^" | "and" | "or"): X => args.slice(1).reduce<X>((a, b) => ({ k: "op", op: o, a, b: expr(b) }), arg(0));
  switch (op) {
    case "plus":
      return bin("+");
    case "minus":
      return args.length === 1 ? { k: "neg", a: arg(0) } : bin("-");
    case "neg":
      return { k: "neg", a: arg(0) };
    case "mult":
      return bin("*");
    case "div":
      return bin("/");
    case "pow":
      return bin("^");
    case "and":
      return bin("and");
    case "or":
      return bin("or");
    case "scale": {
      // A value in a unit: 3 mm (a placeholder for the unit is no unit).
      if (local(args[1]) === "placeholder") return arg(0);
      return { k: "op", op: "*", a: arg(0), b: arg(1) };
    }
    case "absval":
    case "determinant":
      return { k: "abs", a: arg(0) };
    case "nthRoot":
      return local(args[0]) === "placeholder" ? { k: "sqrt", a: arg(1) } : { k: "sqrt", a: arg(1), n: arg(0) };
    case "sqrt":
      return { k: "sqrt", a: arg(0) };
    case "indexer":
      return { k: "index", target: arg(0), args: args.slice(1).map(expr) };
    case "transpose":
      return { k: "transpose", a: arg(0) };
    case "matcol":
      return { k: "call", f: "col", args: [arg(0), arg(1)] };
    case "matrow":
      return { k: "call", f: "row", args: [arg(0), arg(1)] };
    case "vectorize":
      return arg(0); // Calcs works element by element where it applies
    case "percent":
      return { k: "op", op: "/", a: arg(0), b: { k: "num", v: "100" } };
    case "summation":
    case "product": {
      const { v, body } = lambda(args.find((a) => local(a) === "lambda"));
      const lower = args.find((a) => local(a) === "lowerBound");
      const upper = args.find((a) => local(a) === "upperBound");
      return { k: op === "summation" ? "sum" : "prod", v, body, from: lower ? expr(kids(lower)[0]) : undefined, to: upper ? expr(kids(upper)[0]) : undefined };
    }
    case "integral": {
      const { v, body } = lambda(args.find((a) => local(a) === "lambda"));
      const lower = args.find((a) => local(a) === "lowerBound");
      const upper = args.find((a) => local(a) === "upperBound");
      return { k: "int", v, body, from: lower ? expr(kids(lower)[0]) : undefined, to: upper ? expr(kids(upper)[0]) : undefined };
    }
    case "derivative": {
      const { v, body } = lambda(args.find((a) => local(a) === "lambda"));
      return { k: "diff", v, order: 1, body };
    }
    default:
      if (RELATIONS[op]) return { k: "op", op: RELATIONS[op], a: arg(0), b: arg(1) };
      throw new Unsupported(`Mathcad's ${op}`);
  }
}

/** A program that's only an if / else if / else with one value each: piecewise. */
function program(el: Element): X {
  if (local(el) === "program") {
    const lines = kids(el);
    if (lines.length !== 1) throw new Unsupported("a Mathcad program");
    return expr(lines[0]);
  }
  const rows: { value: X; cond: X | null }[] = [];
  const branch = (b: Element, cond: X | null) => {
    const body = kids(b);
    if (body.length !== 1) throw new Unsupported("a Mathcad program");
    rows.push({ value: expr(body[0]), cond });
  };
  for (const part of kids(el)) {
    const kind = local(part);
    if (kind === "test") continue;
    if (kind === "then") branch(part, expr(kids(child(el, "test")!)[0]));
    else if (kind === "elseif") {
      const test = child(part, "test");
      const then = child(part, "then");
      if (!test || !then) throw new Unsupported("a Mathcad program");
      branch(then, expr(kids(test)[0]));
    } else if (kind === "else") branch(part, null);
    else throw new Unsupported("a Mathcad program");
  }
  if (rows.length && rows[rows.length - 1].cond) rows.push({ value: { k: "str", v: "undefined" }, cond: null });
  return { k: "cases", rows };
}

/** The unit a result is shown in (from <ml:unitOverride>). */
function override(el: Element | undefined): string | undefined {
  const u = el && kids(el)[0];
  if (!u || local(u) === "placeholder") return undefined;
  try {
    const x = expr(u);
    return unitOnly(x) ? unitText(x) : undefined;
  } catch {
    return undefined;
  }
}

/** A math region's statement. */
export function statement(math: Element): Stmt {
  const top = kids(math).find((c) => !["resultFormat", "formattingOverride", "result"].includes(local(c)));
  if (!top) throw new Unsupported("an empty region");
  const kind = local(top);
  if (kind === "define") {
    const [lhs, rhs] = kids(top);
    try {
      return definition(lhs, rhs);
    } catch (err) {
      if (err instanceof Unsupported) err.defines = local(lhs) === "id" ? idName(lhs) : local(lhs) === "function" ? idName(child(lhs, "id")!) : undefined;
      throw err;
    }
  }
  if (kind === "eval") return { k: "eval", expr: expr(kids(top)[0]), unit: override(child(top, "unitOverride")) };
  if (kind === "symEval" || kind === "symResult") return { k: "symbolic", expr: expr(kids(top)[0]) };
  return { k: "expr", expr: expr(top) };
}

/** A definition: of a name, a function, several names at once, or a vector's elements. */
function definition(lhs: Element, rhs: Element): Stmt {
  const shown = local(rhs) === "eval";
  const body = () => (shown ? expr(kids(rhs)[0]) : expr(rhs));
  const unit = shown ? override(child(rhs, "unitOverride")) : undefined;
  switch (local(lhs)) {
    case "id":
      return { k: "define", name: idName(lhs), body: body(), show: shown, unit };
    case "function":
      return { k: "define", name: idName(child(lhs, "id")!), params: kids(child(lhs, "boundVars")!).map(idName), body: body(), show: shown, unit };
    case "matrix":
      if (kids(lhs).every((c) => local(c) === "id")) {
        // A grid of names, given column by column (as all of Mathcad's matrices).
        const rows = Number(lhs.getAttribute("rows")) || kids(lhs).length;
        const cols = Number(lhs.getAttribute("cols")) || 1;
        const cells = kids(lhs).map(idName);
        const names = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cells[c * rows + r]));
        return { k: "define", name: cells.join(","), names, body: body(), show: shown };
      }
      break;
    case "apply":
      if (local(kids(lhs)[0]) === "indexer") {
        const [, target, ...index] = kids(lhs);
        return { k: "define", name: idName(target), index: index.map(expr), body: body(), show: shown };
      }
  }
  throw new Unsupported("a definition Calcs can't read");
}

// --- the file ----------------------------------------------------------------------------------

/** A text region's paragraphs, from its XAML package (a zip in the zip). */
function textOf(pkg: Uint8Array): { lines: string[]; bold: boolean; size: number } {
  const files = unzipSync(pkg);
  const xamlName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".xaml"));
  if (!xamlName) return { lines: [], bold: false, size: 12 };
  const doc = new DOMParser().parseFromString(strFromU8(files[xamlName]).replace(/^﻿/, ""), "text/xml");
  const root = doc.documentElement!;
  const size = Number(root.getAttribute("FontSize") ?? 12);
  const lines: string[] = [];
  let boldRuns = 0;
  let runs = 0;
  const walk = (el: Element) => {
    for (const c of kids(el)) {
      const n = local(c);
      if (n === "Paragraph") {
        let line = "";
        const inline = (e: Element) => {
          for (const k of Array.from(e.childNodes)) {
            if (k.nodeType === 3) line += k.nodeValue ?? "";
            else if (k.nodeType === 1) {
              const ke = k as Element;
              if (local(ke) === "LineBreak") line += "\n";
              else {
                if (local(ke) === "Run") {
                  runs++;
                  if ((ke.getAttribute("FontWeight") ?? (local(e) === "Bold" ? "Bold" : "")) === "Bold" || local(e) === "Bold") boldRuns++;
                }
                inline(ke);
              }
            }
          }
        };
        inline(c);
        lines.push(line);
      } else walk(c);
    }
  };
  walk(root);
  return { lines, bold: runs > 0 && boldRuns === runs, size };
}

export function readMcdx(bytes: Uint8Array): RawRegion[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This isn't a Mathcad Prime file (.mcdx). Mathcad 15 files (.xmcd) can be saved as .mcdx from Mathcad Prime.");
  }
  const worksheet = files["mathcad/worksheet.xml"];
  if (!worksheet) throw new Error("This doesn't look like a Mathcad Prime worksheet: there's no mathcad/worksheet.xml in it.");
  const doc = new DOMParser().parseFromString(strFromU8(worksheet).replace(/^﻿/, ""), "text/xml");
  // Text regions' packages, by their relationship ids.
  const rels = new Map<string, string>();
  const relsFile = files["mathcad/_rels/worksheet.xml.rels"];
  if (relsFile) {
    const r = new DOMParser().parseFromString(strFromU8(relsFile).replace(/^﻿/, ""), "text/xml");
    for (const rel of Array.from(r.getElementsByTagName("Relationship"))) rels.set(rel.getAttribute("Id") ?? "", (rel.getAttribute("Target") ?? "").replace(/^\//, ""));
  }
  const out: RawRegion[] = [];
  const regionsEl = kids(doc.documentElement!).find((c) => local(c) === "regions");
  if (!regionsEl) return out;
  const readRegion = (region: Element, dx = 0, dy = 0) => {
    const x = Number(region.getAttribute("left") ?? 0) + dx;
    const y = Number(region.getAttribute("top") ?? 0) + dy;
    const content = kids(region)[0];
    if (!content) return;
    const kind = local(content);
    const attempt = (what: string, work: () => void) => {
      try {
        work();
      } catch (err) {
        out.push({ kind: "skipped", x, y, why: err instanceof Unsupported ? err.message : `${what} that couldn't be read`, defines: err instanceof Unsupported ? err.defines : undefined });
      }
    };
    if (kind === "math") attempt("math", () => out.push({ kind: "math", x, y, stmt: statement(content), ref: content.getAttribute("resultRef") ?? undefined }));
    else if (kind === "text") {
      const target = rels.get(content.getAttribute("item-idref") ?? "");
      const pkg = target ? files[target] : undefined;
      if (!pkg) return;
      const t = textOf(pkg);
      const text = t.lines.join("\n").trim();
      if (text) out.push({ kind: "text", x, y, text, style: t.size >= 16 ? "heading" : t.bold ? "subheading" : "normal" });
    } else if (kind === "spec-table") {
      // A table of definitions: each becomes a math region, one under the other.
      kids(content)
        .filter((m) => local(m) === "math")
        .forEach((m, i) => attempt("math", () => out.push({ kind: "math", x, y: y + i * 24, stmt: statement(m) })));
    } else if (kind === "solveblock") {
      attempt("a solve block", () => {
        const inner = kids(child(content, "regions") ?? content).filter((r) => local(r) === "region");
        const part = (cat: string) => inner.filter((r) => r.getAttribute("solve-block-category") === cat).flatMap((r) => kids(r).filter((m) => local(m) === "math").map(statement));
        out.push({ kind: "solve", x, y, guesses: part("guess-value"), constraints: part("constraint"), solver: part("solver") });
      });
    } else if (kind === "plot") {
      attempt("a plot", () => {
        const axis = (name: string) => {
          const a = content.getElementsByTagName(name)[0] as Element | undefined;
          const eqs = a ? Array.from(a.getElementsByTagName("plotEquation")) : [];
          return eqs.map((eq) => {
            const [m, unit] = kids(eq).filter((c) => local(c) === "math");
            const u = unit ? kids(unit)[0] : undefined;
            return { x: expr(kids(m)[0]), unit: u && local(u) !== "placeholder" ? unitText(expr(u)) : undefined };
          });
        };
        const xs = axis("xAxis");
        const ys = axis("yAxis");
        out.push({ kind: "plot", x, y, traces: ys.map((yv, i) => ({ x: (xs[i] ?? xs[0]).x, y: yv.x })), xUnit: xs[0]?.unit, yUnit: ys[0]?.unit });
      });
    } else if (kind === "pageBreak") return;
    else out.push({ kind: "skipped", x, y, why: kind === "picture" || kind === "image" ? "a picture" : kind === "chartComponent" ? "a chart" : `Mathcad's ${kind}` });
  };
  for (const region of kids(regionsEl)) if (local(region) === "region") readRegion(region);
  return out;
}
