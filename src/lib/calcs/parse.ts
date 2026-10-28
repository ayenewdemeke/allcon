// Math regions as MathLive writes them (LaTeX), read the way Mathcad reads math: letters typed
// together are one name (kip, M_u, phi_b), a number next to a name multiplies (5ft), := defines,
// a trailing = evaluates. The result is a small syntax tree the evaluator walks.

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "name"; name: string }
  | { k: "neg"; a: Node }
  | { k: "op"; op: "+" | "-" | "*" | "/" | "^" | "<" | ">" | "<=" | ">=" | "!=" | "==" | "and" | "or"; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] }
  /** A name next to parentheses: a function call if it's a function, else multiplication. */
  | { k: "apply"; name: string; args: Node[] }
  | { k: "abs"; a: Node }
  | { k: "root"; a: Node; n: Node | null }
  | { k: "unit"; name: string }
  /** A matrix or vector written out (vectors are columns, as in Mathcad). */
  | { k: "matrix"; rows: Node[][] }
  /** An element (or elements) of a vector or matrix: v[i], M[i,j]. */
  | { k: "index"; target: Node; args: Node[] }
  | { k: "transpose"; a: Node }
  /** A range: first..last, or first, second..last (the step is second − first). */
  | { k: "range"; first: Node; second: Node | null; last: Node }
  /** Σ or Π over a variable from..to (or over a range variable's values). */
  | { k: "bigop"; op: "sum" | "prod"; v: string; from: Node | null; to: Node | null; body: Node }
  /** Without limits (from and to null) it's indefinite: symbolic only. */
  | { k: "integral"; v: string; from: Node | null; to: Node | null; body: Node }
  | { k: "derivative"; v: string; order: number; body: Node }
  /** Piecewise (if / otherwise): the first row whose condition holds; null is "otherwise". */
  | { k: "cases"; rows: { value: Node; cond: Node | null }[] };

export type Statement =
  /** name := ..., f(x) := ..., v[i] := ... (an element, or one per value of a range), or
   * (a, b) := ... (several names from a vector's elements). */
  | { k: "define"; name: string; params: string[] | null; index?: Node[]; names?: string[]; body: Node; show: boolean }
  | { k: "evaluate"; expr: Node }
  | { k: "expression"; expr: Node }
  /** expression → : worked out symbolically (Mathcad's symbolic evaluation). */
  | { k: "symbolic"; expr: Node }
  | { k: "empty" };

export class ParseError extends Error {
  constructor(
    message: string,
    /** The math isn't finished yet (an empty placeholder): not worth showing as an error. */
    readonly incomplete = false,
  ) {
    super(message);
  }
}

const GREEK = new Set(
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega".split(" "),
);
const FUNCTIONS = new Set("sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh ln log exp max min lg".split(" "));
const SPACES = new Set([",", ";", ":", " ", "!", "quad", "qquad", "enspace", "thinspace", "medspace", "thickspace"]);
const OPERATORS: Record<string, "*" | "/" | "<=" | ">=" | "!="> = { cdot: "*", times: "*", ast: "*", div: "/", le: "<=", leq: "<=", leqslant: "<=", ge: ">=", geq: ">=", geqslant: ">=", ne: "!=", neq: "!=" };

/** "raw" is the text of \text{...} as written, spaces and all. */
type Token = { t: "num"; v: string } | { t: "letter"; v: string } | { t: "cmd"; v: string } | { t: "sym"; v: string } | { t: "raw"; v: string };

function tokenize(latex: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const s = latex.replace(/\{,\}/g, "").replace(/\\placeholder(\[[^\]]*\])?\{\}/g, "\\placeholder ");
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "." && s[i + 1] === ".") {
      // The range operator (Mathcad's ..), however many dots.
      let j = i;
      while (s[j] === ".") j++;
      out.push({ t: "sym", v: ".." });
      i = j;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      let dot = false;
      while (j < s.length && (/[0-9]/.test(s[j]) || (s[j] === "." && !dot && s[j + 1] !== "."))) {
        if (s[j] === ".") dot = true;
        j++;
      }
      out.push({ t: "num", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      out.push({ t: "letter", v: c });
      i++;
      continue;
    }
    if (c === "\\") {
      let j = i + 1;
      if (/[a-zA-Z]/.test(s[j] ?? "")) while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      else j++;
      const cmd = s.slice(i + 1, j);
      out.push({ t: "cmd", v: cmd });
      i = j;
      if (["text", "textrm", "mbox"].includes(cmd) && s[i] === "{") {
        let depth = 0;
        let k = i;
        for (; k < s.length; k++) {
          if (s[k] === "{") depth++;
          else if (s[k] === "}" && --depth === 0) break;
        }
        if (k < s.length) {
          // Escaped braces and spaces as themselves; other commands (\textbf...) left out.
          out.push({ t: "raw", v: s.slice(i + 1, k).replace(/\\([{} ])/g, "$1").replace(/\\[a-zA-Z]+\s*/g, "").replace(/\\/g, "") });
          i = k + 1;
        }
      }
      continue;
    }
    out.push({ t: "sym", v: c });
    i++;
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private tokens: Token[]) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }
  private next() {
    return this.tokens[this.i++];
  }
  private isSym(v: string, offset = 0) {
    const t = this.peek(offset);
    return t?.t === "sym" && t.v === v;
  }
  private isCmd(v: string | string[], offset = 0) {
    const t = this.peek(offset);
    return t?.t === "cmd" && (Array.isArray(v) ? v.includes(t.v) : t.v === v);
  }
  private expectSym(v: string) {
    if (!this.isSym(v)) throw new ParseError(`Expected "${v}"`);
    this.i++;
  }
  /** Skips spacing commands; returns whether any were there. */
  private spaces() {
    let any = false;
    while (this.peek()?.t === "cmd" && SPACES.has((this.peek() as Token).v)) {
      this.i++;
      any = true;
    }
    while (this.isSym("~")) {
      this.i++;
      any = true;
    }
    return any;
  }
  get done() {
    this.spaces();
    return this.i >= this.tokens.length;
  }

  /** A braced group's contents as an expression, or a single token (x^2, \frac12). */
  private group(): Node {
    this.spaces();
    if (this.isSym("{")) {
      this.i++;
      const e = this.expression();
      this.spaces();
      this.expectSym("}");
      return e;
    }
    const t = this.next();
    if (!t) throw new ParseError("Something's missing", true);
    if (t.t === "num") return { k: "num", v: Number(t.v[0]) }; // \frac12: one digit
    if (t.t === "letter") return { k: "name", name: t.v };
    if (t.t === "cmd" && t.v === "placeholder") throw new ParseError("Fill in the placeholder", true);
    this.i--;
    return this.primary();
  }

  /** Raw text inside braces (names in \mathrm{}, strings in \text{}). */
  private rawGroup(): string {
    this.spaces();
    if (this.peek()?.t === "raw") return this.next().v;
    if (!this.isSym("{")) {
      const t = this.next();
      return t ? t.v : "";
    }
    this.i++;
    let depth = 1;
    let text = "";
    while (this.i < this.tokens.length) {
      const t = this.next();
      if (t.t === "sym" && t.v === "{") depth++;
      if (t.t === "sym" && t.v === "}" && --depth === 0) break;
      text += t.t === "cmd" ? (t.v.length === 1 ? t.v : "") : t.v;
    }
    return text;
  }

  /** A subscript, as part of a name: M_u, M_{u,max}, f'_c. */
  private subscript(): string {
    this.i++; // _
    this.spaces();
    if (this.isSym("{")) return this.rawGroup().replace(/\s+/g, "");
    const t = this.next();
    if (!t) throw new ParseError("Something's missing after _", true);
    return t.t === "cmd" ? t.v : t.v;
  }

  /** A name: a run of letters (and digits after them), a Greek letter, \mathrm{...}, then an
   * optional subscript and primes. */
  private name(): string | null {
    const t = this.peek();
    let name = "";
    if (t?.t === "letter") {
      while (this.peek()?.t === "letter" || (name && this.peek()?.t === "num" && /^\d+$/.test(this.peek()!.v))) name += this.next().v;
    } else if (t?.t === "cmd" && (GREEK.has(t.v) || FUNCTIONS.has(t.v))) {
      this.i++;
      name = t.v.replace(/^var/, "") === "epsilon" ? "epsilon" : t.v;
    } else if (t?.t === "cmd" && ["mathrm", "operatorname", "mathit", "mathbf", "mathsf"].includes(t.v)) {
      this.i++;
      name = this.rawGroup().replace(/\s+/g, "");
    } else return null;
    name += this.primes();
    if (this.isSym("_")) name += `_${this.subscript()}`;
    name += this.primes();
    return name;
  }

  /** Primes after a name: f', f^\prime, f^{\prime\prime}. */
  private primes(): string {
    let out = "";
    for (;;) {
      if (this.isSym("'")) {
        this.i++;
        out += "'";
      } else if (this.isSym("^") && this.isCmd(["prime", "doubleprime"], 1)) {
        out += this.peek(1)!.v === "doubleprime" ? "''" : "'";
        this.i += 2;
      } else if (this.isSym("^") && this.isSym("{", 1) && this.isCmd(["prime", "doubleprime"], 2)) {
        this.i += 2;
        while (this.isCmd(["prime", "doubleprime"])) out += this.next().v === "doubleprime" ? "''" : "'";
        this.expectSym("}");
      } else return out;
    }
  }

  /** Arguments in parentheses: (a, b, c). The opening bracket has been read. */
  private args(close: string): Node[] {
    const args: Node[] = [];
    this.spaces();
    if (this.closes(close)) return args;
    for (;;) {
      args.push(this.expression());
      this.spaces();
      if (this.isSym(",")) {
        this.i++;
        continue;
      }
      if (!this.closes(close)) throw new ParseError(`Expected "${close}"`);
      return args;
    }
  }
  /** Reads a closing bracket (plain or \right). */
  private closes(close: string) {
    if (this.isCmd("right") && (this.peek(1)?.v === close || (close === ")" && this.peek(1)?.v === "rparen"))) {
      this.i += 2;
      return true;
    }
    if (this.isSym(close)) {
      this.i++;
      return true;
    }
    return false;
  }
  private opens(): string | null {
    if (this.isCmd("left") && (this.peek(1)?.v === "(" || this.peek(1)?.v === "[" || this.peek(1)?.v === "lparen" || this.peek(1)?.v === "lbrack")) {
      const v = this.peek(1)!.v;
      this.i += 2;
      return v === "(" || v === "lparen" ? ")" : "]";
    }
    if (this.isSym("(") || this.isSym("[")) return this.next().v === "(" ? ")" : "]";
    return null;
  }

  private primary(): Node {
    this.spaces();
    const t = this.peek();
    if (!t) throw new ParseError("Something's missing", true);
    if (t.t === "cmd" && t.v === "placeholder") throw new ParseError("Fill in the placeholder", true);
    if (t.t === "num") {
      this.i++;
      const v = Number(t.v);
      if (!Number.isFinite(v)) throw new ParseError(`"${t.v}" isn't a number`);
      return { k: "num", v };
    }
    const close = this.opens();
    if (close) {
      const args = this.args(close);
      if (args.length !== 1) throw new ParseError("Too many values in parentheses");
      return args[0];
    }
    if (t.t === "cmd") {
      if (t.v === "frac" || t.v === "dfrac" || t.v === "tfrac") {
        this.i++;
        const derivative = this.derivative();
        if (derivative) return derivative;
        const a = this.group();
        const b = this.group();
        return { k: "op", op: "/", a, b };
      }
      if (t.v === "begin") {
        this.i++;
        return this.environment(this.rawGroup());
      }
      if (t.v === "sum" || t.v === "prod") {
        this.i++;
        return this.bigop(t.v);
      }
      if (t.v === "int") {
        this.i++;
        return this.integral();
      }
      if (t.v === "ldots" || t.v === "dots") throw new ParseError("Use .. for a range (type ;)");
      if (t.v === "sqrt") {
        this.i++;
        let n: Node | null = null;
        if (this.isSym("[")) {
          this.i++;
          n = this.expression();
          this.expectSym("]");
        }
        return { k: "root", a: this.group(), n };
      }
      if (t.v === "text" || t.v === "textrm" || t.v === "mbox") {
        this.i++;
        return { k: "str", v: this.rawGroup() };
      }
      if (t.v === "left" && (this.peek(1)?.v === "|" || this.peek(1)?.v === "vert")) {
        this.i += 2;
        const a = this.expression();
        this.spaces();
        if (!(this.isCmd("right") && (this.peek(1)?.v === "|" || this.peek(1)?.v === "vert"))) throw new ParseError('Expected "|"');
        this.i += 2;
        return { k: "abs", a };
      }
      if (t.v === "infty") {
        this.i++;
        return { k: "num", v: Infinity };
      }
      if (t.v === "%") {
        this.i++;
        return { k: "unit", name: "percent" };
      }
      if (t.v === "degree") {
        this.i++;
        return { k: "unit", name: "deg" };
      }
      if (t.v === "mathrm") {
        // Upright letters are a unit: \mathrm{g} is grams, whatever else g is.
        this.i++;
        return { k: "unit", name: this.rawGroup().replace(/\s+/g, "") };
      }
      if (t.v === "operatorname" || t.v === "mathrm" || GREEK.has(t.v) || FUNCTIONS.has(t.v) || ["mathit", "mathbf", "mathsf"].includes(t.v)) return this.named();
      throw new ParseError(`\\${t.v} isn't supported yet`);
    }
    if (t.t === "sym" && t.v === "|") {
      this.i++;
      const a = this.expression();
      this.spaces();
      this.expectSym("|");
      return { k: "abs", a };
    }
    if (t.t === "letter") return this.named();
    if (t.t === "sym" && t.v === '"') throw new ParseError("Strings go in \\text{}");
    throw new ParseError(`Unexpected "${t.v}"`);
  }

  /** A name, and its arguments if it's followed by parentheses. Functions written as commands
   * (\sin x) take what follows without parentheses, as in maths. */
  private named(): Node {
    const wasCommand = this.peek()?.t === "cmd" && FUNCTIONS.has(this.peek()!.v);
    const name = this.name()!;
    this.spaces();
    const close = this.opens();
    if (close === "]") return { k: "index", target: { k: "name", name }, args: this.args(close) };
    if (close) return { k: wasCommand ? "call" : "apply", name: normalize(name), args: this.args(close) };
    if (wasCommand) return { k: "call", name: normalize(name), args: [this.power()] };
    return { k: "name", name };
  }

  /** x^y binds tightest; degree signs and primes too. */
  private power(): Node {
    let base = this.primary();
    for (;;) {
      if (this.isSym("^")) {
        this.i++;
        this.spaces();
        if (this.isSym("{") && this.isCmd("circ", 1) && this.isSym("}", 2)) {
          this.i += 3;
          base = { k: "op", op: "*", a: base, b: { k: "unit", name: "deg" } };
          continue;
        }
        if (this.isCmd("circ")) {
          this.i++;
          base = { k: "op", op: "*", a: base, b: { k: "unit", name: "deg" } };
          continue;
        }
        // M^T is the transpose.
        if ((this.isSym("{") && this.peek(1)?.t === "letter" && this.peek(1)!.v === "T" && this.isSym("}", 2)) || (this.peek()?.t === "letter" && this.peek()!.v === "T")) {
          this.i += this.isSym("{") ? 3 : 1;
          base = { k: "transpose", a: base };
          continue;
        }
        base = { k: "op", op: "^", a: base, b: this.group() };
        continue;
      }
      if (this.isCmd("%")) {
        this.i++;
        base = { k: "op", op: "*", a: base, b: { k: "unit", name: "percent" } };
        continue;
      }
      return base;
    }
  }

  /** Whether what's next starts a value (for multiplication by juxtaposition: 5ft, 2\pi r). */
  private startsValue() {
    const t = this.peek();
    if (!t) return false;
    if (t.t === "num" || t.t === "letter") return true;
    if (t.t === "sym") return t.v === "(" || t.v === "[" || t.v === "|";
    return ["frac", "dfrac", "tfrac", "sqrt", "left", "operatorname", "mathrm", "infty", "text", "placeholder"].includes(t.v) || GREEK.has(t.v) || FUNCTIONS.has(t.v);
  }

  private unary(): Node {
    this.spaces();
    if (this.isSym("-")) {
      this.i++;
      return { k: "neg", a: this.unary() };
    }
    if (this.isSym("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private term(): Node {
    let a = this.unary();
    for (;;) {
      this.spaces();
      if (this.isSym("*") || this.isCmd(["cdot", "times", "ast"])) {
        this.i++;
        a = { k: "op", op: "*", a, b: this.unary() };
      } else if (this.isSym("/") || this.isCmd("div")) {
        this.i++;
        a = { k: "op", op: "/", a, b: this.unary() };
      } else if (this.startsValue()) {
        a = { k: "op", op: "*", a, b: this.power() };
      } else return a;
    }
  }

  private sum(): Node {
    let a = this.term();
    for (;;) {
      this.spaces();
      if (this.isSym("+") || this.isSym("-")) {
        const op = this.next().v as "+" | "-";
        a = { k: "op", op, a, b: this.term() };
      } else return a;
    }
  }

  /** Comparisons joined by and (\land, \wedge) and or (\lor, \vee). */
  expression(): Node {
    let a = this.comparison();
    for (;;) {
      this.spaces();
      const t = this.peek();
      const op = t?.t === "cmd" && ["land", "wedge"].includes(t.v) ? "and" : t?.t === "cmd" && ["lor", "vee"].includes(t.v) ? "or" : null;
      if (!op) return a;
      this.i++;
      a = { k: "op", op, a, b: this.comparison() };
    }
  }

  private comparison(): Node {
    let a = this.sum();
    for (;;) {
      this.spaces();
      const t = this.peek();
      let op: "<" | ">" | "<=" | ">=" | "!=" | "==" | null = null;
      if (t?.t === "sym" && (t.v === "<" || t.v === ">")) op = t.v;
      // An equation (solve(e = 0, x), subs(e, x = 2), if(a = b, ...)); at the top level it's caught.
      else if (t?.t === "sym" && t.v === "=") op = "==";
      else if (t?.t === "cmd" && ["le", "leq", "leqslant", "ge", "geq", "geqslant", "ne", "neq", "lt", "gt"].includes(t.v)) op = t.v === "lt" ? "<" : t.v === "gt" ? ">" : (OPERATORS[t.v] as "<=" | ">=" | "!=");
      if (!op) return a;
      this.i++;
      a = { k: "op", op, a, b: this.sum() };
    }
  }

  /** A range (first..last, or first, second..last) or an expression. */
  rangeOrExpression(): Node {
    const first = this.expression();
    this.spaces();
    if (this.isSym("..")) {
      this.i++;
      return { k: "range", first, second: null, last: this.expression() };
    }
    if (this.isSym(",")) {
      const at = this.i;
      this.i++;
      const second = this.expression();
      this.spaces();
      if (this.isSym("..")) {
        this.i++;
        return { k: "range", first, second, last: this.expression() };
      }
      this.i = at;
    }
    return first;
  }

  /** \begin{...}: matrices (pmatrix, bmatrix...) and cases (if / otherwise). */
  private environment(env: string): Node {
    const rows: Node[][] = [[]];
    const cases = env === "cases" || env === "dcases";
    for (;;) {
      this.spaces();
      if (this.isCmd("end")) {
        this.i++;
        this.rawGroup();
        break;
      }
      if (this.i >= this.tokens.length) throw new ParseError(`\\begin{${env}} isn't closed`);
      if (this.isSym("&")) {
        this.i++;
        continue;
      }
      if (this.isCmd("\\") || this.isCmd("cr")) {
        this.i++;
        rows.push([]);
        continue;
      }
      if (cases && rows.at(-1)!.length === 1) {
        // A condition: "otherwise" (or nothing) is the default row; "if" in front is left out.
        const t = this.peek();
        if (t?.t === "cmd" && (t.v === "text" || t.v === "mathrm" || t.v === "operatorname")) {
          const save = this.i;
          this.i++;
          const word = this.rawGroup().trim().toLowerCase();
          if (word === "otherwise" || word === "else" || word === "") {
            rows.at(-1)!.push({ k: "str", v: "otherwise" });
            continue;
          }
          if (word !== "if") this.i = save;
        }
      }
      rows.at(-1)!.push(this.expression());
    }
    const filled = rows.filter((r) => r.length);
    if (cases) {
      return {
        k: "cases",
        rows: filled.map((r) => ({ value: r[0], cond: !r[1] || (r[1].k === "str" && r[1].v === "otherwise") ? null : r[1] })),
      };
    }
    if (!["pmatrix", "bmatrix", "matrix", "Bmatrix", "vmatrix", "smallmatrix"].includes(env)) throw new ParseError(`\\begin{${env}} isn't supported`);
    const width = Math.max(...filled.map((r) => r.length));
    if (filled.some((r) => r.length !== width)) throw new ParseError("Every row of a matrix needs the same number of values");
    const m: Node = { k: "matrix", rows: filled };
    return env === "vmatrix" ? { k: "abs", a: m } : m;
  }

  /** Σ_{i=a}^{b} body, Π likewise; Σ_{i} body sums over a range variable's values. */
  private bigop(op: "sum" | "prod"): Node {
    let v = "";
    let from: Node | null = null;
    let to: Node | null = null;
    this.spaces();
    if (this.isSym("_")) {
      this.i++;
      this.spaces();
      const braced = this.isSym("{");
      if (braced) this.i++;
      v = this.name() ?? "";
      this.spaces();
      if (this.isSym("=")) {
        this.i++;
        from = this.expression();
      }
      this.spaces();
      if (braced) this.expectSym("}");
    }
    this.spaces();
    if (this.isSym("^")) {
      this.i++;
      to = this.group();
    }
    if (!v) throw new ParseError(`Give the ${op === "sum" ? "sum" : "product"} its variable: i = 0 below it`, true);
    if ((from === null) !== (to === null)) throw new ParseError("Give both limits, or neither for a range variable", true);
    return { k: "bigop", op, v, from, to, body: this.term() };
  }

  /** ∫_a^b body dx: the variable is the d-name at the end. */
  private integral(): Node {
    this.spaces();
    let from: Node | null = null;
    let to: Node | null = null;
    if (this.isSym("_")) {
      this.i++;
      from = this.group();
      this.spaces();
      if (!this.isSym("^")) throw new ParseError("Give the integral its upper limit", true);
      this.i++;
      to = this.group();
    }
    const body = this.term();
    const { body: integrand, v } = splitDifferential(body);
    if (!v) throw new ParseError("End the integral with d and its variable (dx)", true);
    return { k: "integral", v, from, to, body: integrand };
  }

  /** \frac{d}{dx} body, \frac{d^2}{dx^2} body: a derivative (else null, an ordinary fraction). */
  private derivative(): Node | null {
    const save = this.i;
    const top = this.rawGroup().replace(/\s+/g, "");
    const m = top.match(/^(?:d|differentialD|mathrm\{?d\}?)(?:\^\{?(\d)\}?)?$/);
    if (!m) {
      this.i = save;
      return null;
    }
    const bottom = this.rawGroup().replace(/\s+/g, "");
    const b = bottom.match(/^(?:d|differentialD)([a-zA-Z][a-zA-Z0-9_']*)(?:\^\{?(\d)\}?)?$/);
    if (!b) {
      this.i = save;
      return null;
    }
    return { k: "derivative", v: b[1], order: Number(m[1] ?? 1), body: this.power() };
  }

  /** The left side of a definition: a name, or a function's name and parameters. */
  target(): { name: string; params: string[] | null; index?: Node[]; names?: string[] } {
    this.spaces();
    if (this.isCmd("begin")) {
      // Several names at once: \begin{pmatrix}a\\b\end{pmatrix} := v.
      this.i++;
      const m = this.environment(this.rawGroup());
      const names = m.k === "matrix" ? m.rows.flat() : [];
      if (!names.length || !names.every((n) => n.k === "name")) throw new ParseError("Define several names at once with a vector of names: (a, b) := v");
      return { name: names.map((n) => (n as { name: string }).name).join(","), params: null, names: names.map((n) => (n as { name: string }).name) };
    }
    const name = this.name();
    if (!name) throw new ParseError("Define a name: x := ...");
    this.spaces();
    const close = this.opens();
    if (!close) return { name, params: null };
    if (close === "]") return { name, params: null, index: this.args(close) };
    const params: string[] = [];
    this.spaces();
    if (!this.closes(close)) {
      for (;;) {
        this.spaces();
        const p = this.name();
        if (!p) throw new ParseError("A function's parameters are names: f(x, y) := ...");
        params.push(p);
        this.spaces();
        if (this.isSym(",")) {
          this.i++;
          continue;
        }
        if (!this.closes(close)) throw new ParseError(`Expected "${close}"`);
        break;
      }
    }
    return { name, params };
  }
}

/** Functions written different ways (\arcsin, asin) by one name. */
function normalize(name: string) {
  return ({ arcsin: "asin", arccos: "acos", arctan: "atan", lg: "log" } as Record<string, string>)[name] ?? name;
}

const DEFINE = /\\coloneq(q)?|:=|\\colonequals|\\mathrel\{:\}=|:\\!=/;

/** A math region's statement: a definition (x := ..., f(x) := ...), an evaluation (... =), or
 * an expression shown as it is. */
export function parseStatement(latex: string): Statement {
  const text = latex.trim();
  if (!text) return { k: "empty" };
  const define = text.match(DEFINE);
  if (define && define.index !== undefined) {
    const lhs = new Parser(tokenize(text.slice(0, define.index)));
    const target = lhs.target();
    if (!lhs.done) throw new ParseError("Only a name (or a function) can be defined: x := ...");
    let rhs = text.slice(define.index + define[0].length).trim();
    const show = /=\s*$/.test(rhs) && !/(\\[lg]eq?|\\ne|[<>!])\s*=\s*$/.test(rhs);
    if (show) rhs = rhs.replace(/=\s*$/, "");
    if (!rhs.trim()) throw new ParseError("Define it as something: x := ...", true);
    const p = new Parser(tokenize(rhs));
    const body = p.rangeOrExpression();
    if (!p.done) throw new ParseError("There's more here than one expression");
    return { k: "define", name: target.name, params: target.params, index: target.index, names: target.names, body, show };
  }
  // A trailing arrow: worked out symbolically.
  const arrow = text.match(/\\(?:to|rightarrow|longrightarrow)\s*$/);
  if (arrow) {
    const body = text.slice(0, arrow.index).trim();
    if (!body) throw new ParseError("Put an expression before the arrow", true);
    const p = new Parser(tokenize(body));
    const expr = p.expression();
    if (!p.done) throw new ParseError("There's more here than one expression");
    return { k: "symbolic", expr };
  }
  const evaluate = /=\s*$/.test(text);
  const body = evaluate ? text.replace(/=\s*$/, "") : text;
  if (!body.trim()) return { k: "empty" };
  const p = new Parser(tokenize(body));
  const expr = p.rangeOrExpression();
  if (!p.done || (expr.k === "op" && expr.op === "==")) {
    if (/(^|[^:\\])=/.test(body)) throw new ParseError("Use := to define, and = at the end to evaluate");
    throw new ParseError("There's more here than one expression");
  }
  return evaluate ? { k: "evaluate", expr } : { k: "expression", expr };
}

const GREEK_NAMES = "alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega";

/** Greek letters spelled out (phi, beta_1) written as symbols (\\phi, \\beta_1), as they read
 * the same; text in \\text{} is left alone. */
export function greekify(latex: string): string {
  return latex
    .split(/(\\text\{[^}]*\})/)
    .map((part, i) => (i % 2 ? part : part.replace(new RegExp(`(?<![\\\\a-zA-Z])(${GREEK_NAMES})(?![a-zA-Z])`, "g"), (_, name: string) => `\\${name === "epsilon" ? "varepsilon" : name} `).replace(/ ([_^{}\\]|$)/g, "$1")))
    .join("");
}

/** An integrand and its variable: the trailing d-name (dx) of a product. */
function splitDifferential(body: Node): { body: Node; v: string | null } {
  if (body.k === "name" && /^d[a-zA-Z]/.test(body.name)) return { body: { k: "num", v: 1 }, v: body.name.slice(1) };
  if (body.k === "op" && body.op === "*") {
    const right = splitDifferential(body.b);
    if (right.v) return { body: right.body.k === "num" && right.body.v === 1 ? body.a : { ...body, b: right.body }, v: right.v };
  }
  return { body, v: null };
}

/** An expression, or a relation between two (for solve blocks' constraints and plot axes):
 * lhs = rhs, lhs ≤ rhs... */
export function parseConstraint(latex: string): { lhs: Node; rhs: Node | null; rel: string } {
  const text = latex.trim();
  if (!text) throw new ParseError("Something's missing", true);
  // An equation: the top-level "=" (not inside braces).
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "=" && depth === 0 && text[i - 1] !== "\\" && !/[<>!:]$/.test(text.slice(0, i))) {
      return { lhs: expressionOf(text.slice(0, i)), rhs: expressionOf(text.slice(i + 1)), rel: "=" };
    }
  }
  const p = new Parser(tokenize(text));
  const e = p.expression();
  if (!p.done) throw new ParseError("There's more here than one expression");
  if (e.k === "op" && ["<", ">", "<=", ">="].includes(e.op)) return { lhs: e.a, rhs: e.b, rel: e.op };
  return { lhs: e, rhs: null, rel: "" };
}

function expressionOf(latex: string): Node {
  const p = new Parser(tokenize(latex));
  const e = p.rangeOrExpression();
  if (!p.done) throw new ParseError("There's more here than one expression");
  return e;
}
