// Math read from other programs' worksheets (Mathcad Prime, SMath Studio), as a small tree both
// importers build, and written out as the LaTeX a Calcs math region holds.

export type X =
  | { k: "num"; v: string }
  /** A name: its base, then _ and its subscript if it has one (f'_c, ε_c2). */
  | { k: "name"; v: string }
  | { k: "unit"; v: string }
  | { k: "str"; v: string }
  | { k: "op"; op: "+" | "-" | "*" | "/" | "^" | "=" | "<" | ">" | "<=" | ">=" | "!=" | "and" | "or"; a: X; b: X }
  | { k: "neg"; a: X }
  | { k: "call"; f: string; args: X[] }
  | { k: "if"; cond: X; a: X; b: X }
  | { k: "sqrt"; a: X; n?: X }
  | { k: "abs"; a: X }
  | { k: "index"; target: X; args: X[] }
  | { k: "matrix"; rows: X[][] }
  | { k: "range"; first: X; second?: X; last: X }
  | { k: "sum" | "prod"; v: string; from?: X; to?: X; body: X }
  | { k: "int"; v: string; from?: X; to?: X; body: X }
  | { k: "diff"; v: string; order: number; body: X }
  | { k: "cases"; rows: { value: X; cond: X | null }[] }
  | { k: "transpose"; a: X }
  | { k: "paren"; a: X };

export type Stmt =
  /** name := ..., f(x) := ..., v[i] := ... (index), or (a, b) := ... (names). */
  | { k: "define"; name: string; params?: string[]; index?: X[]; names?: string[][]; body: X; show?: boolean; unit?: string }
  | { k: "eval"; expr: X; unit?: string }
  | { k: "symbolic"; expr: X }
  | { k: "expr"; expr: X };

/** Something the importer can't bring across (a Mathcad program, an unfinished region...). */
export class Unsupported extends Error {
  /** The name a definition that couldn't come across would have defined. */
  defines?: string;
}

const GREEK: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "varepsilon", ϵ: "varepsilon", ζ: "zeta", η: "eta", θ: "theta", ϑ: "theta", ι: "iota", κ: "kappa", λ: "lambda", μ: "mu", ν: "nu", ξ: "xi",
  π: "pi", ρ: "rho", σ: "sigma", ς: "sigma", τ: "tau", υ: "upsilon", φ: "phi", ϕ: "phi", χ: "chi", ψ: "psi", ω: "omega", Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda", Ξ: "Xi", Π: "Pi", Σ: "Sigma",
  Υ: "Upsilon", Φ: "Phi", Ψ: "Psi", Ω: "Omega",
};
/** Functions Calcs writes as commands (\sin); the rest are \operatorname{...}. */
const COMMANDS = new Set("sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh ln log exp max min".split(" "));
const FUNCTION_NAMES: Record<string, string> = { asin: "arcsin", acos: "arccos", atan: "arctan", sqrt: "sqrt", Max: "max", Min: "min" };

/** A name as LaTeX Calcs reads back as the same name: σ_max → \sigma_{max}. */
export function nameLatex(name: string): string {
  const [base, ...rest] = name.split("_");
  const sub = rest.join(",");
  const primes = base.match(/'+$/)?.[0] ?? "";
  const stem = base.slice(0, base.length - primes.length);
  let head: string;
  if (GREEK[stem]) head = `\\${GREEK[stem]}`;
  else if (stem === "pi" && !sub) head = "\\pi";
  else if (/^[A-Za-z][A-Za-z0-9]*$/.test(stem)) head = stem;
  else head = `\\mathit{${stem}}`; // other letters (ø), as written
  return `${head}${primes}${sub ? `_{${sub}}` : ""}`;
}

/** A unit as Calcs writes it (μm → um, ° → deg). */
export const unitName = (u: string) => u.replace(/^μ/, "u").replace(/^µ/, "u").replace(/^°$/, "deg").replace(/^Ω$/, "ohm");

const PREC: Record<string, number> = { or: 1, and: 2, "=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3, "!=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "^": 7 };
const REL: Record<string, string> = { "=": "=", "<": "<", ">": ">", "<=": "\\le ", ">=": "\\ge ", "!=": "\\ne ", and: "\\land ", or: "\\lor " };

// Sums and integrals take what follows them, so they're bracketed inside other math (∫∫ too).
const precOf = (x: X): number =>
  x.k === "op" ? PREC[x.op] : x.k === "neg" ? 6 : x.k === "num" && x.v.startsWith("-") ? 6 : x.k === "int" || x.k === "sum" || x.k === "prod" || x.k === "diff" ? 4.5 : 9;
const wrap = (x: X, min: number) => (precOf(x) < min ? `\\left(${latex(x)}\\right)` : latex(x));
const isNumber = (x: X) => x.k === "num" && !x.v.startsWith("-");

/** An expression as LaTeX. */
export function latex(x: X): string {
  switch (x.k) {
    case "num":
      return x.v;
    case "name":
      return nameLatex(x.v);
    case "unit":
      return `\\mathrm{${unitName(x.v)}}`;
    case "str":
      return `\\text{${x.v.replace(/[{}\\]/g, "")}}`;
    case "op": {
      if (x.op === "/") return `\\frac{${latex(x.a)}}{${latex(x.b)}}`;
      if (x.op === "^") return `${x.a.k === "name" || x.a.k === "unit" || isNumber(x.a) || x.a.k === "paren" ? latex(x.a) : `\\left(${latex(x.a)}\\right)`}^{${latex(x.b)}}`;
      if (x.op === "*") {
        // A number and its unit side by side (5kN), else a dot.
        if (x.a.k === "num" && isNumber(x.a) && (x.b.k === "unit" || (x.b.k === "op" && ["*", "/", "^"].includes(x.b.op) && unitOnly(x.b)))) return `${x.a.v}${latex(x.b)}`;
        return `${wrap(x.a, 5)}\\cdot ${wrap(x.b, 5)}`;
      }
      const p = PREC[x.op];
      if (x.op === "+" || x.op === "-") return `${wrap(x.a, 4)}${x.op}${wrap(x.b, x.op === "-" ? 5 : 4)}`;
      return `${wrap(x.a, p + 1)}${REL[x.op]}${wrap(x.b, p + 1)}`;
    }
    case "neg":
      return `-${wrap(x.a, 6)}`;
    case "call": {
      const f = FUNCTION_NAMES[x.f] ?? x.f;
      if (f === "sqrt" && x.args.length === 1) return `\\sqrt{${latex(x.args[0])}}`;
      const args = `\\left(${x.args.map(latex).join(",")}\\right)`;
      if (COMMANDS.has(f)) return `\\${f}${args}`;
      // Calcs' own functions by name; anything else is the worksheet's function (σ(ε), f_c(x)).
      return BUILTINS.has(f) ? `\\operatorname{${f}}${args}` : `${nameLatex(f)}${args}`;
    }
    case "if":
      return `\\operatorname{if}\\left(${latex(x.cond)},${latex(x.a)},${latex(x.b)}\\right)`;
    case "sqrt":
      return x.n ? `\\sqrt[${latex(x.n)}]{${latex(x.a)}}` : `\\sqrt{${latex(x.a)}}`;
    case "abs":
      return `\\left|${latex(x.a)}\\right|`;
    case "index":
      return `${x.target.k === "name" ? latex(x.target) : `\\left(${latex(x.target)}\\right)`}\\left[${x.args.map(latex).join(",")}\\right]`;
    case "matrix":
      return `\\begin{pmatrix}${x.rows.map((r) => r.map(latex).join("&")).join("\\\\")}\\end{pmatrix}`;
    case "range":
      return `${latex(x.first)}${x.second ? `,${latex(x.second)}` : ""}..${latex(x.last)}`;
    case "sum":
    case "prod": {
      const sym = x.k === "sum" ? "\\sum" : "\\prod";
      const limits = x.from && x.to ? `_{${nameLatex(x.v)}=${latex(x.from)}}^{${latex(x.to)}}` : `_{${nameLatex(x.v)}}`;
      return `${sym}${limits}${wrap(x.body, 5)}`;
    }
    case "int":
      return `\\int${x.from && x.to ? `_{${latex(x.from)}}^{${latex(x.to)}}` : " "}${wrap(x.body, 5)}\\,d${nameLatex(x.v)}`;
    case "diff":
      return x.order === 1 ? `\\frac{d}{d${nameLatex(x.v)}}${wrap(x.body, 5)}` : `\\frac{d^{${x.order}}}{d${nameLatex(x.v)}^{${x.order}}}${wrap(x.body, 5)}`;
    case "cases":
      return `\\begin{cases}${x.rows.map((r) => `${latex(r.value)} & ${r.cond ? latex(r.cond) : "\\text{otherwise}"}`).join("\\\\ ")}\\end{cases}`;
    case "transpose":
      return `${x.a.k === "name" ? latex(x.a) : `\\left(${latex(x.a)}\\right)`}^{T}`;
    case "paren":
      return `\\left(${latex(x.a)}\\right)`;
  }
}

/** Calcs' own functions (written as \operatorname, not as a user function). */
const BUILTINS = new Set(
  "if root minimize maximize polyroots find rows cols length last identity augment stack sum mean median stdev sort transpose round ceil floor mod section lsolve col row simplify expand factor solve series subs partfrac collect limit float factorial eigenvals eigenvecs diag det norm rank reverse tr submatrix interp linterp lookup vlookup hlookup match csort rsort".split(" "),
);

/** Whether an expression is only units (kN·m, N/mm²). */
export function unitOnly(x: X): boolean {
  if (x.k === "unit") return true;
  if (x.k === "num") return true;
  if (x.k === "op" && (x.op === "*" || x.op === "/")) return unitOnly(x.a) && unitOnly(x.b);
  if (x.k === "op" && x.op === "^") return unitOnly(x.a) && x.b.k === "num";
  if (x.k === "paren") return unitOnly(x.a);
  return false;
}

/** Units as the text a result is shown in (kN*m, N/mm^2). */
export function unitText(x: X): string {
  switch (x.k) {
    case "unit":
      return unitName(x.v);
    case "num":
      return x.v;
    case "paren":
      return `(${unitText(x.a)})`;
    case "op":
      if (x.op === "^") return `${unitText(x.a)}^${unitText(x.b)}`;
      if (x.op === "*") return `${unitText(x.a)}*${unitText(x.b)}`;
      if (x.op === "/") return `${unitText(x.a)}/${x.b.k === "op" && x.b.op === "*" ? `(${unitText(x.b)})` : unitText(x.b)}`;
      throw new Unsupported("Not a unit");
    default:
      throw new Unsupported("Not a unit");
  }
}

/** A statement as a math region's LaTeX, and the unit its result shows in. */
export function statementLatex(s: Stmt): { latex: string; displayUnit?: string } {
  const unit = "unit" in s && s.unit ? s.unit : undefined;
  switch (s.k) {
    case "define": {
      const lhs = s.names
        ? `\\begin{pmatrix}${s.names.map((row) => row.map(nameLatex).join("&")).join("\\\\")}\\end{pmatrix}`
        : s.index
          ? `${nameLatex(s.name)}\\left[${s.index.map(latex).join(",")}\\right]`
          : s.params
            ? `${nameLatex(s.name)}\\left(${s.params.map(nameLatex).join(",")}\\right)`
            : nameLatex(s.name);
      return { latex: `${lhs}\\coloneq ${latex(s.body)}${s.show ? "=" : ""}`, displayUnit: unit };
    }
    case "eval":
      return { latex: `${latex(s.expr)}=`, displayUnit: unit };
    case "symbolic":
      return { latex: `${latex(s.expr)}\\to` };
    case "expr":
      return { latex: latex(s.expr) };
  }
}
