import { DOMParser, type Element } from "@xmldom/xmldom";
import { Unsupported, unitOnly, unitText, type Stmt, type X } from "./expr";
import type { RawRegion } from "./index";

// SMath Studio worksheets (.sm): XML whose math regions hold their math in postfix order
// (operands, then the operator or function that takes them), with "." for subscripts (σ.max).

const kids = (el: Element) => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
const local = (el: Element) => el.localName ?? el.nodeName;

/** SMath's names: σ.max is σ with the subscript max. */
const smathName = (s: string) => s.replace(/\./, "_");

const BINARY: Record<string, "+" | "-" | "*" | "/" | "^" | "<" | ">" | "<=" | ">=" | "!=" | "=" | "and" | "or"> = {
  "+": "+", "-": "-", "*": "*", "·": "*", "/": "/", "÷": "/", "^": "^", "<": "<", ">": ">", "≤": "<=", "≥": ">=", "≠": "!=", "≡": "=", "==": "=", "&": "and", "|": "or", "∧": "and", "∨": "or",
};

/** A postfix sequence of <e> elements as a tree (the define operator : stays an operator). */
type Node = X | { k: "define"; lhs: X; rhs: X };

function fromPostfix(es: Element[]): Node {
  const stack: Node[] = [];
  const pop = (): X => {
    const v = stack.pop();
    if (!v) throw new Unsupported("unfinished math");
    if (v.k === "define") throw new Unsupported("a definition inside an expression");
    return v;
  };
  for (const e of es) {
    const type = e.getAttribute("type");
    const text = (e.textContent ?? "").trim();
    const n = Number(e.getAttribute("args") ?? 0);
    if (type === "operand") {
      if (e.getAttribute("style") === "unit") stack.push({ k: "unit", v: text });
      else if (e.getAttribute("style") === "string") stack.push({ k: "str", v: text });
      else if (/^[0-9.]+$/.test(text)) stack.push({ k: "num", v: text });
      else if (text === "π") stack.push({ k: "name", v: "pi" });
      else if (text === "#") throw new Unsupported("unfinished math");
      else stack.push({ k: "name", v: smathName(text) });
    } else if (type === "bracket") {
      stack.push({ k: "paren", a: pop() });
    } else if (type === "operator") {
      if ((text === ":" || text === "≡") && n === 2) {
        const rhs = pop();
        const lhs = pop();
        if (text === ":" || lhs.k === "name" || lhs.k === "call") {
          stack.push({ k: "define", lhs, rhs });
          continue;
        }
        stack.push({ k: "op", op: "=", a: lhs, b: rhs });
      } else if (text === "-" && n === 1) stack.push({ k: "neg", a: pop() });
      else if (BINARY[text] && n === 2) {
        const b = pop();
        const a = pop();
        stack.push({ k: "op", op: BINARY[text], a, b });
      } else if (text === "!" && n === 1) stack.push({ k: "call", f: "factorial", args: [pop()] });
      else throw new Unsupported(`SMath's ${text} operator`);
    } else if (type === "function") {
      const args = Array.from({ length: n }, pop).reverse();
      stack.push(fn(text, args));
    } else throw new Unsupported("SMath math that couldn't be read");
  }
  if (stack.length !== 1) throw new Unsupported(stack.length ? "SMath math that couldn't be read" : "unfinished math");
  return stack[0];
}

/** SMath's functions as Calcs math. */
function fn(name: string, args: X[]): X {
  const nameOf = (x: X) => {
    if (x.k !== "name") throw new Unsupported(`SMath's ${name}`);
    return x.v;
  };
  switch (name) {
    case "sqrt":
      return { k: "sqrt", a: args[0] };
    case "nthroot":
      return { k: "sqrt", a: args[1], n: args[0] };
    case "abs":
      return { k: "abs", a: args[0] };
    case "if":
      if (args.length === 3) return { k: "if", cond: args[0], a: args[1], b: args[2] };
      break;
    case "el":
      return { k: "index", target: args[0], args: args.slice(1) };
    case "mat": {
      // The values row by row, then the rows and columns.
      const size = (x: X) => (x.k === "num" ? Number(x.v) : NaN);
      const rows = size(args[args.length - 2]);
      const cols = size(args[args.length - 1]);
      if (!rows || !cols) throw new Unsupported("SMath's matrix");
      return { k: "matrix", rows: Array.from({ length: rows }, (_, r) => args.slice(r * cols, r * cols + cols)) };
    }
    case "range":
      return args.length === 3 ? { k: "range", first: args[0], second: args[2], last: args[1] } : { k: "range", first: args[0], last: args[1] };
    case "sum":
      if (args.length === 4) return { k: "sum", v: nameOf(args[1]), from: args[2], to: args[3], body: args[0] };
      if (args.length === 1) throw new Unsupported("SMath's vector sum");
      break;
    case "product":
      if (args.length === 4) return { k: "prod", v: nameOf(args[1]), from: args[2], to: args[3], body: args[0] };
      break;
    case "int":
      if (args.length === 4) return { k: "int", v: nameOf(args[1]), from: args[2], to: args[3], body: args[0] };
      if (args.length === 2) return { k: "int", v: nameOf(args[1]), body: args[0] };
      break;
    case "diff":
      return { k: "diff", v: nameOf(args[1]), order: args[2]?.k === "num" ? Number(args[2].v) : 1, body: args[0] };
    case "transpose":
      return { k: "transpose", a: args[0] };
    case "line":
    case "for":
    case "while":
    case "sys":
      throw new Unsupported(name === "sys" ? "an SMath system of equations" : "an SMath program");
    case "at":
      return { k: "call", f: "subs", args };
    case "lim":
      return { k: "call", f: "limit", args };
    case "Solve":
    case "solve":
      return { k: "call", f: "solve", args };
  }
  if (/^(Maxima|MaximaTakeover|Clear|Assign)/.test(name)) throw new Unsupported(`SMath's ${name}`);
  return { k: "call", f: name.replace(/\./, "_"), args };
}

/** A math region's statement: its input, the unit the result shows in, and how it's evaluated. */
function statement(math: Element): Stmt {
  const input = kids(math).find((c) => local(c) === "input");
  if (!input) throw new Unsupported("an empty region");
  const tree = fromPostfix(kids(input).filter((c) => local(c) === "e"));
  const contract = kids(math).find((c) => local(c) === "contract");
  let unit: string | undefined;
  if (contract) {
    try {
      const u = fromPostfix(kids(contract).filter((c) => local(c) === "e"));
      if (u.k !== "define" && unitOnly(u)) unit = unitText(u);
    } catch {
      unit = undefined;
    }
  }
  const action = kids(math).find((c) => local(c) === "result")?.getAttribute("action");
  if (tree.k === "define") {
    const show = action === "numeric";
    if (tree.lhs.k === "name") return { k: "define", name: tree.lhs.v, body: tree.rhs, show, unit };
    if (tree.lhs.k === "call" && tree.lhs.args.every((a) => a.k === "name")) return { k: "define", name: tree.lhs.f, params: tree.lhs.args.map((a) => (a as { v: string }).v), body: tree.rhs, show, unit };
    if (tree.lhs.k === "index" && tree.lhs.target.k === "name") return { k: "define", name: tree.lhs.target.v, index: tree.lhs.args, body: tree.rhs, show, unit };
    throw new Unsupported("a definition Calcs can't read");
  }
  if (action === "symbolic") return { k: "symbolic", expr: tree };
  if (action === "numeric") return { k: "eval", expr: tree, unit };
  return { k: "expr", expr: tree };
}

export function readSmath(text: string): RawRegion[] {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ""), "text/xml");
  const root = doc.documentElement;
  if (!root || local(root) !== "regions") throw new Error("This doesn't look like an SMath Studio worksheet (.sm).");
  const out: RawRegion[] = [];
  for (const region of kids(root)) {
    if (local(region) !== "region") continue;
    const x = Number(region.getAttribute("left") ?? 0);
    const y = Number(region.getAttribute("top") ?? 0);
    const content = kids(region)[0];
    if (!content) continue;
    const kind = local(content);
    if (kind === "math") {
      try {
        out.push({ kind: "math", x, y, stmt: statement(content) });
      } catch (err) {
        out.push({ kind: "skipped", x, y, why: err instanceof Unsupported ? err.message : "math that couldn't be read" });
      }
    } else if (kind === "text") {
      const ps = kids(content).filter((c) => local(c) === "p" || local(c) === "content");
      const lines = (ps.length ? ps : [content]).map((p) => (p.textContent ?? "").trim());
      const bold = ps.length > 0 && ps.every((p) => p.getAttribute("bold") === "true");
      const t = lines.join("\n").trim();
      if (t) out.push({ kind: "text", x, y, text: t, style: bold ? "subheading" : "normal" });
    } else if (kind === "writer") {
      // Rich text (HTML in CDATA): its words, with pictures of math left out.
      const html = content.textContent ?? "";
      const t = html
        .replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, " $1 ")
        .replace(/<(br|\/div|\/p)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (t) out.push({ kind: "text", x, y, text: t, style: "normal" });
    } else out.push({ kind: "skipped", x, y, why: kind === "picture" || kind === "image" ? "a picture" : kind === "plot" ? "an SMath plot" : `SMath's ${kind} region` });
  }
  return out;
}
