import { all, create, type Complex, type Matrix, type Unit } from "mathjs";
import { findShape, property, shapeProperty, shapesLoaded, SI_UNITS } from "./library/shapes";
import { parseConstraint, parseStatement, ParseError, type Node } from "./parse";

// Worksheets evaluated as Mathcad does: regions in reading order (top to bottom, then left to
// right), each seeing what's defined above it. Values carry units (mathjs does the arithmetic):
// numbers, matrices and vectors (columns), and range variables, which iterate (an expression in
// a range variable is worked out for each of its values). Results show in the units the inputs
// used or, for compound ones, the structural units of the worksheet's system (kip·ft, ksi, klf /
// kN·m, MPa, kN/m), or in a unit given for that result. Tables define vectors, plots draw them,
// and solve blocks find the values that satisfy constraints.

export const math = create(all, { number: "number" });

/** Units engineers write that mathjs doesn't have. */
for (const [name, def] of [
  ["ksi", "1 kip/inch^2"],
  ["psf", "1 lbf/ft^2"],
  ["ksf", "1 kip/ft^2"],
  ["pcf", "1 lbf/ft^3"],
  ["kcf", "1 kip/ft^3"],
  ["plf", "1 lbf/ft"],
  ["klf", "1 kip/ft"],
  ["kips", "1 kip"],
  ["tonf", "2000 lbf"],
  ["kgf", "9.80665 N"],
  ["tf", "9806.65 N"],
] as const) {
  try {
    math.createUnit(name, def);
  } catch {
    // already there
  }
}

/** Names that are units unless the worksheet defines them (as in Mathcad). */
const UNIT_NAMES = new Set(
  (
    "m mm cm km in inch ft yd mi " +
    "ha acre L mL gal " +
    "kg tonne lb lbm slug " +
    "N kN MN lbf kip kips tonf kgf tf " +
    "Pa kPa MPa GPa psi ksi psf ksf bar " +
    "plf klf pcf kcf " +
    "s min hr h day " +
    "deg rad " +
    "J kJ MJ W kW hp Hz mph " +
    "percent"
  ).split(" "),
);
const UNIT_ALIASES: Record<string, string> = { in: "inch", hr: "hour", h: "hour", lbm: "lb", min: "minute" };

export type UnitSystem = "USCS" | "SI";
export type Settings = { system: UnitSystem; decimals: number };
export const DEFAULT_SETTINGS: Settings = { system: "USCS", decimals: 3 };

/** A range variable's values (Mathcad's i := 0..10): expressions in it are worked out for each. */
export class RangeValue {
  constructor(readonly values: Value[]) {}
}

type Fn = { params: string[]; body: Node; scope: Scope };
export type Value = number | boolean | string | Unit | Matrix | Complex | RangeValue;
type Scope = Map<string, Value | Fn>;

const isFn = (v: unknown): v is Fn => typeof v === "object" && v !== null && "body" in v && "params" in v;
const isUnit = (v: unknown): v is Unit => typeof v === "object" && v !== null && (v as { type?: string }).type === "Unit";
const isMatrix = (v: unknown): v is Matrix => math.isMatrix(v);
/** A matrix of values (mathjs's types don't cover units and complex entries). */
const matrixOf = (rows: unknown): Value => math.matrix(rows as never) as unknown as Value;
const isComplex = (v: unknown): v is Complex => math.isComplex(v);
const isRange = (v: unknown): v is RangeValue => v instanceof RangeValue;

export class CalcError extends Error {}

/** Mathcad's ORIGIN: vectors and matrices count from 0. */
const ORIGIN = 0;
const MAX_RANGE = 100_000;

const CONSTANTS: Record<string, () => Value> = {
  pi: () => Math.PI,
  e: () => Math.E,
  g: () => math.unit(9.80665, "m/s^2"),
};

/** The unit names read in the region being worked out (to show them upright). */
let unitsRead: Set<string> | null = null;

/** A unit by the name written (kip, ft, kN, in), or null if it isn't one. */
function unitNamed(name: string): Unit | null {
  if (!UNIT_NAMES.has(name)) return null;
  try {
    const u = math.unit(1, UNIT_ALIASES[name] ?? name);
    unitsRead?.add(name);
    return u;
  } catch {
    return null;
  }
}

/** Dimensionless units become plain numbers (ft/ft = 1). */
function settle(v: Value): Value {
  if (isUnit(v) && v.dimensions.every((d) => d === 0) && !v.units.some((u) => u.unit.name === "percent")) return v.toNumber("");
  if (isRange(v)) return new RangeValue(v.values.map(settle));
  return v;
}

function friendly(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Units do not match|do not match/i.test(message)) return "The units don't match";
  if (/cannot convert|incompatible/i.test(message)) return "These units can't be combined that way";
  if (/Dimension mismatch|dimensions? mismatch/i.test(message)) return "The sizes of these matrices don't fit";
  if (/Unexpected type of argument/i.test(message)) return "That doesn't work with these values (check the units)";
  return message;
}

/** Works a function out over range variables, value by value (Mathcad's iteration). */
function broadcast(args: Value[], fn: (...xs: Value[]) => Value): Value {
  const ranges = args.filter(isRange);
  if (!ranges.length) return fn(...args);
  const n = ranges[0].values.length;
  if (ranges.some((r) => r.values.length !== n)) throw new CalcError("These range variables have different numbers of values");
  return new RangeValue(Array.from({ length: n }, (_, i) => fn(...args.map((a) => (isRange(a) ? a.values[i] : a)))));
}

/** A range as a column vector (for functions of a whole vector: max, sum, length...). */
const asVector = (v: Value): Value => (isRange(v) ? matrixOf(v.values.map((x) => [x])) as unknown as Value : v);
const truthy = (v: Value) => v === true || (typeof v === "number" && v !== 0);

/** A value's size in SI base units, as a plain number (for solving and calculus). */
function toBase(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isUnit(v)) return v.value ?? 1;
  throw new CalcError("A single value is needed here");
}
/** A plain number in SI base units, back as a value like `template` (same units). */
function fromBase(template: Value, n: number): Value {
  if (isUnit(template)) {
    const u = template.clone();
    u.value = n;
    return u;
  }
  return n;
}

const op2 = (fn: (a: never, b: never) => unknown) => (a: Value, b: Value) => fn(a as never, b as never) as Value;

function arith(op: string, a: Value, b: Value): Value {
  return broadcast([a, b], (x, y) => {
    try {
      switch (op) {
        case "+":
          return op2(math.add)(x, y);
        case "-":
          return op2(math.subtract)(x, y);
        case "*":
          return op2(math.multiply)(x, y);
        case "/":
          if (isMatrix(y)) return op2(math.multiply)(x, math.inv(y as never) as unknown as Value);
          return op2(math.divide)(x, y);
        case "^":
          if (isUnit(y)) throw new CalcError("Powers are plain numbers");
          if (isMatrix(x) && y === -1) return math.inv(x as never) as unknown as Value;
          return op2(math.pow)(x, y);
        case "<":
          return op2(math.smaller)(x, y);
        case ">":
          return op2(math.larger)(x, y);
        case "<=":
          return op2(math.smallerEq)(x, y);
        case ">=":
          return op2(math.largerEq)(x, y);
        case "!=":
          return op2(math.unequal)(x, y);
        case "==":
          return op2(math.equal)(x, y);
      }
    } catch (err) {
      if (err instanceof CalcError) throw err;
      throw new CalcError(friendly(err));
    }
    throw new CalcError(`Unknown operator ${op}`);
  });
}

/** |x|: the size of a number, a vector's length, a square matrix's determinant. */
function magnitude(v: Value): Value {
  if (isMatrix(v)) {
    const [r, c] = v.size();
    if (r === c && r > 1) return math.det(v as never) as unknown as Value;
    const items = v.toArray().flat() as Value[];
    return math.sqrt(items.reduce<Value>((sum, x) => op2(math.add)(sum, op2(math.multiply)(x, x)), 0) as never) as unknown as Value;
  }
  return math.abs(v as never) as unknown as Value;
}

const MATRIX_FUNCTIONS: Record<string, (...args: Value[]) => Value> = {
  rows: (m) => (isMatrix(m) ? m.size()[0] : 1),
  cols: (m) => (isMatrix(m) ? (m.size()[1] ?? 1) : 1),
  length: (m) => (isMatrix(m) ? m.size().reduce((a, b) => a * b, 1) : 1),
  last: (m) => (isMatrix(m) ? m.size().reduce((a, b) => a * b, 1) - 1 + ORIGIN : ORIGIN),
  transpose: (m) => math.transpose(m as never) as unknown as Value,
  identity: (n) => math.identity(n as number) as unknown as Value,
  augment: (...ms) => math.concat(...(ms as never[]), 1) as unknown as Value,
  stack: (...ms) => math.concat(...(ms as never[]), 0) as unknown as Value,
  sum: (m) => (isMatrix(m) ? (math.sum(m as never) as unknown as Value) : m),
  mean: (m) => math.mean(m as never) as unknown as Value,
  median: (m) => math.median(m as never) as unknown as Value,
  stdev: (m) => math.std(m as never) as unknown as Value,
  max: (...xs) => math.max(...(xs as never[])) as unknown as Value,
  min: (...xs) => math.min(...(xs as never[])) as unknown as Value,
  sort: (m) => matrixOf((isMatrix(m) ? (m.toArray().flat() as Value[]) : [m]).sort((a, b) => toBase(a) - toBase(b)).map((x) => [x])),
  polyroots: (m) => polyroots(m),
};

const BUILTINS: Record<string, (...args: Value[]) => Value> = {
  sqrt: (x) => math.sqrt(x as never) as unknown as Value,
  abs: (x) => magnitude(x),
  sin: (x) => math.sin(x as never) as unknown as Value,
  cos: (x) => math.cos(x as never) as unknown as Value,
  tan: (x) => math.tan(x as never) as unknown as Value,
  cot: (x) => math.cot(x as never) as unknown as Value,
  sec: (x) => math.sec(x as never) as unknown as Value,
  csc: (x) => math.csc(x as never) as unknown as Value,
  asin: (x) => math.unit(math.asin(x as number) as number, "rad"),
  acos: (x) => math.unit(math.acos(x as number) as number, "rad"),
  atan: (x) => math.unit(math.atan(x as number) as number, "rad"),
  atan2: (y, x) => math.unit(math.atan2(toBase(y), toBase(x)), "rad"),
  sinh: (x) => math.sinh(x as number) as unknown as Value,
  cosh: (x) => math.cosh(x as number) as unknown as Value,
  tanh: (x) => math.tanh(x as number) as unknown as Value,
  ln: (x) => math.log(x as number) as unknown as Value,
  log: (x, b) => (b === undefined ? math.log10(x as number) : math.log(x as number, b as number)) as unknown as Value,
  exp: (x) => math.exp(x as number) as unknown as Value,
  floor: (x) => math.floor(x as number) as unknown as Value,
  ceil: (x) => math.ceil(x as number) as unknown as Value,
  round: (x, n) => math.round(x as number, (n as number) ?? 0) as unknown as Value,
  mod: (a, b) => math.mod(a as number, b as number) as unknown as Value,
};

/** Polynomial roots from coefficients, constant first (as Mathcad's polyroots), by
 * Durand–Kerner iteration. */
function polyroots(v: Value): Value {
  if (!isMatrix(v)) throw new CalcError("polyroots takes a vector of coefficients, constant first");
  const c = (v.toArray().flat() as Value[]).map(toBase);
  while (c.length && Math.abs(c[c.length - 1]) < 1e-300) c.pop();
  const n = c.length - 1;
  if (n < 1) throw new CalcError("The polynomial needs a degree of 1 or more");
  const a = c.map((x) => math.complex(x / c[n], 0));
  let z = Array.from({ length: n }, (_, k) => math.complex({ r: 1, phi: (2 * Math.PI * k) / n + 0.4 }));
  const p = (x: Complex) => a.reduceRight((acc: Complex, k) => math.add(math.multiply(acc, x), k) as Complex, math.complex(0, 0));
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    z = z.map((zi, i) => {
      let den = math.complex(1, 0);
      z.forEach((zj, j) => i !== j && (den = math.multiply(den, math.subtract(zi, zj)) as Complex));
      const next = math.subtract(zi, math.divide(p(zi), den)) as Complex;
      moved = Math.max(moved, math.abs(math.subtract(next, zi)) as unknown as number);
      return next;
    });
    if (moved < 1e-14) break;
  }
  return matrixOf(z.map((x) => [Math.abs(x.im) < 1e-10 * Math.max(1, Math.abs(x.re)) ? x.re : x])) as unknown as Value;
}

function evaluate(node: Node, scope: Scope): Value {
  switch (node.k) {
    case "num":
      return node.v;
    case "str":
      return node.v;
    case "unit":
      return unitNamed(node.name) ?? math.unit(1, node.name);
    case "name": {
      const v = scope.get(node.name);
      if (v !== undefined) {
        if (isFn(v)) throw new CalcError(`${display(node.name)} is a function: give it values, ${node.name}(…)`);
        return v;
      }
      if (CONSTANTS[node.name]) return CONSTANTS[node.name]();
      const u = unitNamed(node.name);
      if (u) return u;
      throw new CalcError(`${display(node.name)} isn't defined`);
    }
    case "neg":
      return broadcast([evaluate(node.a, scope)], (x) => math.unaryMinus(x as never) as unknown as Value);
    case "abs":
      return broadcast([evaluate(node.a, scope)], magnitude);
    case "root": {
      const a = evaluate(node.a, scope);
      if (!node.n) return broadcast([a], (x) => math.sqrt(x as never) as unknown as Value);
      const n = evaluate(node.n, scope);
      if (typeof n !== "number") throw new CalcError("A root's index is a plain number");
      return broadcast([a], (x) => math.pow(x as never, 1 / n) as unknown as Value);
    }
    case "op":
      return arith(node.op, evaluate(node.a, scope), evaluate(node.b, scope));
    case "matrix": {
      const rows = node.rows.map((r) =>
        r.map((cell) => {
          const v = settle(evaluate(cell, scope));
          if (isRange(v) || isMatrix(v)) throw new CalcError("A matrix's entries are single values");
          return v;
        }),
      );
      return matrixOf(rows as never) as unknown as Value;
    }
    case "transpose": {
      const a = evaluate(node.a, scope);
      if (!isMatrix(a)) throw new CalcError("Only a vector or matrix has a transpose");
      return math.transpose(a as never) as unknown as Value;
    }
    case "index": {
      const target = evaluate(node.target, scope);
      if (!isMatrix(target)) throw new CalcError(`${node.target.k === "name" ? display(node.target.name) : "This"} isn't a vector or matrix`);
      return broadcast(node.args.map((a) => evaluate(a, scope)), (...ix) => {
        const [rows, cols] = [target.size()[0], target.size()[1] ?? 1];
        const at = ix.map((i) => {
          if (typeof i !== "number" || !Number.isInteger(i)) throw new CalcError("Indices are whole numbers");
          return i - ORIGIN;
        });
        let pos: number[];
        if (at.length === 1) pos = cols === 1 ? [at[0], 0] : rows === 1 ? [0, at[0]] : (() => {
          throw new CalcError("A matrix takes two indices: M[i, j]");
        })();
        else if (at.length === 2) pos = at;
        else throw new CalcError("One index for a vector, two for a matrix");
        if (pos[0] < 0 || pos[0] >= rows || pos[1] < 0 || pos[1] >= cols) throw new CalcError(`Index out of range (it counts from ${ORIGIN})`);
        return target.get(pos) as Value;
      });
    }
    case "range": {
      const first = evaluate(node.first, scope);
      const last = evaluate(node.last, scope);
      const second = node.second ? evaluate(node.second, scope) : null;
      const [a, b] = [toBase(first), toBase(last)];
      if (isUnit(first) && !second) throw new CalcError("A range with units needs a step: first, second .. last");
      const step = second !== null ? toBase(second) - a : b >= a ? 1 : -1;
      if (step === 0 || Math.sign(step) !== Math.sign(b - a || step)) throw new CalcError("The range's step doesn't reach its end");
      const count = Math.floor((b - a) / step + 1e-9) + 1;
      if (count > MAX_RANGE) throw new CalcError(`A range can have up to ${MAX_RANGE.toLocaleString()} values`);
      return new RangeValue(Array.from({ length: count }, (_, k) => fromBase(first, a + k * step)));
    }
    case "bigop": {
      const values: Value[] = [];
      if (node.from && node.to) {
        const [from, to] = [evaluate(node.from, scope), evaluate(node.to, scope)];
        if (typeof from !== "number" || typeof to !== "number" || !Number.isInteger(from) || !Number.isInteger(to)) throw new CalcError("A sum's limits are whole numbers");
        if (to - from > MAX_RANGE) throw new CalcError("Too many terms");
        for (let k = from; k <= to; k++) values.push(k);
      } else {
        const r = scope.get(node.v);
        if (!isRange(r)) throw new CalcError(`${display(node.v)} isn't a range variable: give the sum its limits`);
        values.push(...r.values);
      }
      const inner: Scope = new Map(scope);
      let acc: Value = node.op === "sum" ? 0 : 1;
      values.forEach((x, k) => {
        inner.set(node.v, x);
        const term = evaluate(node.body, inner);
        acc = k === 0 ? term : arith(node.op === "sum" ? "+" : "*", acc, term);
      });
      return settle(acc);
    }
    case "integral":
      return integrate(node, scope);
    case "derivative":
      return differentiate(node, scope);
    case "cases": {
      for (const row of node.rows) {
        if (!row.cond || truthy(evaluate(row.cond, scope))) return evaluate(row.value, scope);
      }
      throw new CalcError("None of the conditions holds: add an otherwise row");
    }
    case "call":
    case "apply":
      return call(node, scope);
  }
  throw new CalcError("Can't work that out");
}

function call(node: Extract<Node, { k: "call" | "apply" }>, scope: Scope): Value {
  const f = scope.get(node.name);
  if (isFn(f)) {
    if (node.args.length !== f.params.length) throw new CalcError(`${display(node.name)} takes ${f.params.length} value${f.params.length === 1 ? "" : "s"}`);
    return broadcast(node.args.map((a) => evaluate(a, scope)), (...xs) => {
      const inner: Scope = new Map(f.scope);
      inner.set(node.name, f); // a function can call itself
      f.params.forEach((p, i) => inner.set(p, xs[i]));
      return settle(evaluate(f.body, inner));
    });
  }
  if (f === undefined) {
    // Functions that take their arguments unevaluated.
    if (node.name === "section") {
      // section("W14X22", "Zx"): a property of a steel shape, from the AISC tables.
      const [shape, prop] = node.args.map((a) => evaluate(a, scope));
      if (node.args.length !== 2 || typeof shape !== "string" || typeof prop !== "string") throw new CalcError('section takes a shape and a property: section("W14X22", "Zx")');
      return sectionProperty(shape, prop);
    }
    if (node.name === "if") {
      // Mathcad's if(condition, then, otherwise): only the branch taken is worked out.
      if (node.args.length !== 3) throw new CalcError("if takes a condition, a value if true, and one if false");
      const c = evaluate(node.args[0], scope);
      if (isRange(c)) return new RangeValue(c.values.map((x, i) => (truthy(x) ? pick(evaluate(node.args[1], scope), i) : pick(evaluate(node.args[2], scope), i))));
      return evaluate(truthy(c) ? node.args[1] : node.args[2], scope);
    }
    if (node.name === "root") return root(node.args, scope);
    if (node.name === "minimize" || node.name === "maximize") return optimize(node.name, node.args, scope);
    if (node.name === "find") throw new CalcError("find works in a solve block");
    const matrixFn = MATRIX_FUNCTIONS[node.name];
    if (matrixFn) {
      try {
        return settle(matrixFn(...node.args.map((a) => asVector(evaluate(a, scope)))));
      } catch (err) {
        throw err instanceof CalcError ? err : new CalcError(friendly(err));
      }
    }
    const builtin = BUILTINS[node.name];
    if (builtin) {
      try {
        return broadcast(node.args.map((a) => evaluate(a, scope)), (...xs) => settle(builtin(...xs)));
      } catch (err) {
        throw err instanceof CalcError ? err : new CalcError(friendly(err));
      }
    }
  }
  if (node.k === "call") throw new CalcError(`${display(node.name)} isn't a function`);
  // A value next to parentheses multiplies: w(L - a).
  const a = evaluate({ k: "name", name: node.name }, scope);
  if (node.args.length !== 1) throw new CalcError(`${display(node.name)} isn't a function`);
  return arith("*", a, evaluate(node.args[0], scope));
}
const pick = (v: Value, i: number) => (isRange(v) ? v.values[i] : v);

// --- calculus ---------------------------------------------------------------------------------

/** A function of one variable, for numerical work: base-unit numbers in and out. */
function numeric(body: Node, v: string, scope: Scope, template: Value) {
  const inner: Scope = new Map(scope);
  let sample: Value = 0;
  const f = (x: number) => {
    inner.set(v, fromBase(template, x));
    const y = settle(evaluate(body, inner));
    if (isRange(y) || isMatrix(y)) throw new CalcError("The expression must give a single value");
    sample = y;
    return toBase(y);
  };
  return { f, sample: () => sample };
}

/** ∫ from a to b, by adaptive Simpson's rule (in base units; the result gets its units back). */
function integrate(node: Extract<Node, { k: "integral" }>, scope: Scope): Value {
  const from = evaluate(node.from, scope);
  const to = evaluate(node.to, scope);
  // The variable has the limits' units (a limit of 0 can be written without them).
  const template = isUnit(from) ? from : isUnit(to) ? to : from;
  const { f, sample } = numeric(node.body, node.v, scope, template);
  const [a, b] = [toBase(from), toBase(to)];
  const simpson = (l: number, r: number, fl: number, fm: number, fr: number) => ((r - l) / 6) * (fl + 4 * fm + fr);
  let evaluations = 0;
  const adapt = (l: number, r: number, fl: number, fm: number, fr: number, whole: number, eps: number, depth: number): number => {
    const m = (l + r) / 2;
    const [lm, rm] = [(l + m) / 2, (m + r) / 2];
    const [flm, frm] = [f(lm), f(rm)];
    evaluations += 2;
    if (evaluations > 200_000) throw new CalcError("The integral doesn't settle (check for a singularity)");
    const left = simpson(l, m, fl, flm, fm);
    const right = simpson(m, r, fm, frm, fr);
    if (depth > 50 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
    return adapt(l, m, fl, flm, fm, left, eps / 2, depth + 1) + adapt(m, r, fm, frm, fr, right, eps / 2, depth + 1);
  };
  const [fa, fm, fb] = [f(a), f((a + b) / 2), f(b)];
  const whole = simpson(a, b, fa, fm, fb);
  const result = a === b ? 0 : adapt(a, b, fa, fm, fb, whole, 1e-10 * Math.max(1, Math.abs(whole)), 0);
  if (!Number.isFinite(result)) throw new CalcError("The integral doesn't converge");
  const units = arith("*", sample(), isUnit(template) ? template : 1);
  return settle(fromBase(units, result));
}

/** d/dx at the variable's current value (as Mathcad works derivatives out), by central differences. */
function differentiate(node: Extract<Node, { k: "derivative" }>, scope: Scope): Value {
  const at = scope.get(node.v);
  if (at === undefined || isFn(at)) throw new CalcError(`Define ${display(node.v)} first: the derivative is worked out at its value`);
  if (isRange(at)) return new RangeValue(at.values.map((x) => differentiate(node, new Map(scope).set(node.v, x))));
  const { f, sample } = numeric(node.body, node.v, scope, at);
  const x = toBase(at as Value);
  const h = Math.max(Math.abs(x), 1e-3) * (node.order === 1 ? 1e-5 : 1e-3);
  let d: number;
  if (node.order === 1) d = (f(x + h) - f(x - h)) / (2 * h);
  else if (node.order === 2) d = (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
  else throw new CalcError("Derivatives up to the second order");
  f(x);
  let units: Value = sample();
  for (let k = 0; k < node.order; k++) units = arith("/", units, isUnit(at) ? at : 1);
  return settle(fromBase(units, d));
}

// --- solving -----------------------------------------------------------------------------------

/** root(f(x), x): where f(x) = 0, starting from x's value (secant); root(f(x), x, a, b): in
 * [a, b] (bisection, then secant). */
function root(args: Node[], scope: Scope): Value {
  if (args.length !== 2 && args.length !== 4) throw new CalcError("root(f(x), x) or root(f(x), x, a, b)");
  const v = args[1].k === "name" ? args[1].name : null;
  if (!v) throw new CalcError("root's second value is the variable: root(f(x), x)");
  let template: Value;
  let lo: number;
  let hi: number;
  if (args.length === 4) {
    const a = evaluate(args[2], scope);
    template = a;
    [lo, hi] = [toBase(a), toBase(evaluate(args[3], scope))];
  } else {
    const guess = scope.get(v);
    if (guess === undefined || isFn(guess) || isRange(guess)) throw new CalcError(`Give ${display(v)} a guess value first (${v} := ...)`);
    template = guess;
    lo = toBase(guess);
    hi = lo === 0 ? 1e-3 : lo * 1.001;
  }
  const { f } = numeric(args[0], v, scope, template);
  if (args.length === 4) {
    let [fl, fh] = [f(lo), f(hi)];
    if (fl * fh > 0) throw new CalcError("The function has the same sign at both ends of the interval");
    for (let it = 0; it < 200 && Math.abs(hi - lo) > 1e-14 * Math.max(1, Math.abs(lo)); it++) {
      const m = (lo + hi) / 2;
      const fm = f(m);
      if (fl * fm <= 0) [hi, fh] = [m, fm];
      else [lo, fl] = [m, fm];
    }
    return settle(fromBase(template, Math.abs(fl) < Math.abs(fh) ? lo : hi));
  }
  let [x0, x1] = [lo, hi];
  let [f0, f1] = [f(x0), f(x1)];
  for (let it = 0; it < 200; it++) {
    if (f1 === f0) break;
    const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
    [x0, f0] = [x1, f1];
    x1 = x2;
    f1 = f(x1);
    if (!Number.isFinite(x1)) break;
    if (Math.abs(f1) < 1e-12 * Math.max(1, Math.abs(f0)) || Math.abs(x1 - x0) < 1e-14 * Math.max(1, Math.abs(x1))) return settle(fromBase(template, x1));
  }
  throw new CalcError("No root found from this guess: try another, or give an interval");
}

/** minimize(f, x, y...) / maximize: from the variables' values, by Nelder–Mead. */
function optimize(kind: "minimize" | "maximize", args: Node[], scope: Scope): Value {
  const fname = args[0]?.k === "name" ? args[0].name : null;
  const fn = fname ? scope.get(fname) : undefined;
  if (!isFn(fn)) throw new CalcError(`${kind}'s first value is a function: ${kind}(f, x)`);
  const vars = args.slice(1).map((a) => (a.k === "name" ? a.name : ""));
  if (!vars.length || vars.some((x) => !x)) throw new CalcError(`List the variables: ${kind}(f, x, y)`);
  const templates = vars.map((x) => {
    const g = scope.get(x);
    if (g === undefined || isFn(g) || isRange(g)) throw new CalcError(`Give ${display(x)} a guess value first`);
    return g;
  });
  const sign = kind === "minimize" ? 1 : -1;
  const objective = (u: number[]) => {
    const inner: Scope = new Map(fn.scope);
    fn.params.forEach((p, i) => inner.set(p, fromBase(templates[i] ?? 0, u[i] ?? 0)));
    return sign * toBase(settle(evaluate(fn.body, inner)));
  };
  const best = nelderMead(objective, templates.map(toBase));
  const values = best.map((n, i) => settle(fromBase(templates[i], n)));
  return values.length === 1 ? values[0] : (matrixOf(values.map((x) => [x]) as never) as unknown as Value);
}

function nelderMead(f: (u: number[]) => number, start: number[]): number[] {
  const n = start.length;
  let simplex = [start, ...start.map((_, i) => start.map((x, j) => (i === j ? x + (x === 0 ? 1 : Math.abs(x) * 0.2) : x)))];
  let values = simplex.map(f);
  for (let it = 0; it < 5000; it++) {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    const size = Math.max(...simplex.slice(1).map((p) => Math.max(...p.map((x, j) => Math.abs(x - simplex[0][j]) / Math.max(Math.abs(simplex[0][j]), 1e-12)))));
    if (Math.abs(values[n] - values[0]) <= 1e-14 * (Math.abs(values[0]) + 1e-30) && size < 1e-9) break;
    const centroid = start.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const along = (t: number) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const reflected = along(-1);
    const fr = f(reflected);
    if (fr < values[0]) {
      const expanded = along(-2);
      const fe = f(expanded);
      [simplex[n], values[n]] = fe < fr ? [expanded, fe] : [reflected, fr];
    } else if (fr < values[n - 1]) {
      [simplex[n], values[n]] = [reflected, fr];
    } else {
      const contracted = along(0.5);
      const fc = f(contracted);
      if (fc < values[n]) [simplex[n], values[n]] = [contracted, fc];
      else {
        simplex = simplex.map((p, i) => (i === 0 ? p : p.map((x, j) => simplex[0][j] + 0.5 * (x - simplex[0][j]))));
        values = simplex.map(f);
      }
    }
  }
  return simplex[values.indexOf(Math.min(...values))];
}

/** Solves equations (and inequalities) for the variables, from their guesses: Levenberg–
 * Marquardt on residuals scaled to the size of each side. */
function solveSystem(residuals: (u: number[]) => number[], start: number[]): { u: number[]; error: number } {
  let u = start.slice();
  let r = residuals(u);
  let lambda = 1e-3;
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  for (let it = 0; it < 300 && norm(r) > 1e-12; it++) {
    const J = u.map((_, j) => {
      const h = 1e-7 * Math.max(Math.abs(u[j]), 1e-6);
      const up = u.slice();
      up[j] += h;
      const rh = residuals(up);
      return rh.map((x, i) => (x - r[i]) / h);
    }); // columns
    const n = u.length;
    const JTJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a].reduce((s, x, i) => s + x * J[b][i], 0)));
    const JTr = Array.from({ length: n }, (_, a) => J[a].reduce((s, x, i) => s + x * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 20 && !improved; tries++) {
      const A = JTJ.map((row, a) => row.map((x, b) => (a === b ? x * (1 + lambda) + 1e-30 : x)));
      const step = gauss(A, JTr.map((x) => -x));
      if (!step) {
        lambda *= 10;
        continue;
      }
      const next = u.map((x, j) => x + step[j]);
      const rn = residuals(next);
      if (rn.every(Number.isFinite) && norm(rn) < norm(r)) {
        [u, r] = [next, rn];
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
      } else lambda *= 10;
    }
    if (!improved) break;
  }
  return { u, error: norm(r) };
}

function gauss(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) x[r] = (M[r][n] - M[r].slice(r + 1, n).reduce((s, v, j) => s + v * x[r + 1 + j], 0)) / M[r][r];
  return x;
}

// --- results ---------------------------------------------------------------------------------

/** A name as LaTeX: Greek letters, subscripts (M_u → M_{u}), primes. */
export function display(name: string): string {
  const [base, ...sub] = name.split("_");
  const greek = (s: string) => (/^(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/.test(s) ? `\\${s}` : s);
  const b = greek(base.replace(/'+$/, "")) + "'".repeat(base.length - base.replace(/'+$/, "").length);
  return sub.length ? `${b}_{${sub.join(",")}}` : b;
}

/** A number as Mathcad shows it: `decimals` places, trailing zeros dropped, powers of ten for
 * very large or small values. */
export function formatNumber(x: number, decimals: number): string {
  if (!Number.isFinite(x)) return x > 0 ? "\\infty" : x < 0 ? "-\\infty" : "\\mathrm{NaN}";
  if (x === 0) return "0";
  const ax = Math.abs(x);
  if (ax >= 1e7 || ax < 10 ** -decimals / 2) {
    const exp = Math.floor(Math.log10(ax));
    const mant = x / 10 ** exp;
    return `${trim(mant.toFixed(decimals))}\\cdot 10^{${exp}}`;
  }
  return trim(x.toFixed(decimals));
}
const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s).replace(/^-0$/, "0");

const UNIT_LABELS: Record<string, string> = { inch: "in", deg: "°", percent: "\\%", kips: "kip", hour: "hr", minute: "min" };

/** A unit part's prefix name (mathjs types it as a string; it's an object). */
const prefixOf = (p: { prefix: unknown }) => (typeof p.prefix === "string" ? p.prefix : ((p.prefix as { name?: string } | null)?.name ?? ""));

/** A unit's LaTeX from its parts: kip·ft, kip/ft, lbf/ft², kg/(m·s²). */
function unitLatex(u: Unit): string {
  const label = (p: { prefix: unknown; unit: { name: string } }) => `\\mathrm{${prefixOf(p)}${UNIT_LABELS[p.unit.name] ?? p.unit.name}}`;
  const power = (n: number) => (n === 1 ? "" : `^{${Number.isInteger(n) ? n : trim(n.toFixed(3))}}`);
  const num = u.units.filter((p) => p.power > 0).map((p) => label(p) + power(p.power));
  const den = u.units.filter((p) => p.power < 0).map((p) => label(p) + power(-p.power));
  const top = num.length ? num.join("\\cdot ") : "1";
  if (!den.length) return top;
  return den.length === 1 ? `${top}/${den[0]}` : `\\frac{${top}}{${den.join("\\cdot ")}}`;
}

/** Structural units results are shown in when the inputs leave a mix (klf × ft² → kip·ft). */
const PREFERRED: Record<UnitSystem, string[]> = {
  USCS: ["kip", "kip ft", "ksi", "kip/ft", "pcf", "ft", "inch^2", "inch^3", "inch^4", "ft/s", "ft/s^2", "lb"],
  SI: ["kN", "kN m", "MPa", "kN/m", "kN/m^3", "m", "m^2", "m^3", "mm^4", "m/s", "m/s^2", "kg"],
};
const preferred = new Map<UnitSystem, { dims: number[]; unit: string }[]>();
function preferredFor(system: UnitSystem) {
  if (!preferred.has(system)) preferred.set(system, PREFERRED[system].map((unit) => ({ unit, dims: math.unit(1, unit).dimensions })));
  return preferred.get(system)!;
}
const sameDims = (a: number[], b: number[]) => a.every((d, i) => Math.abs(d - b[i]) < 1e-9);

/** A value as the LaTeX shown after "=". */
export function formatValue(v: Value, settings: Settings, displayUnit?: string): string {
  if (isRange(v)) {
    // A range's values, as Mathcad's result table (the first ones, if there are many).
    const shown = v.values.slice(0, 16).map((x) => formatValue(x, settings, displayUnit));
    if (v.values.length > 16) shown.push("\\vdots");
    return `\\boxed{\\begin{matrix}${shown.join("\\\\ ")}\\end{matrix}}`;
  }
  if (isMatrix(v)) return formatMatrix(v, settings, displayUnit);
  if (isComplex(v)) {
    const re = formatNumber(v.re, settings.decimals);
    const im = formatNumber(Math.abs(v.im), settings.decimals);
    return `${re}${v.im < 0 ? "-" : "+"}${im}i`;
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return `\\text{${v.replace(/[{}\\]/g, "")}}`;
  if (typeof v === "number") {
    if (displayUnit?.trim()) throw new CalcError("A plain number has no units to show");
    return formatNumber(v, settings.decimals);
  }
  if (!isUnit(v)) throw new CalcError("Can't show this value");
  const shown = showIn(v, settings, displayUnit);
  const value = shown.toNumber(shown.formatUnits());
  return `${formatNumber(value, settings.decimals)}\\,${unitLatex(shown)}`;
}

/** The unit a value is shown in: the one asked for, its own, or the structural one for a mix. */
function showIn(v: Unit, settings: Settings, displayUnit?: string): Unit {
  if (displayUnit?.trim()) {
    try {
      return v.to(displayUnit.trim().replace(/\bin\b/g, "inch").replace(/·/g, " "));
    } catch {
      throw new CalcError(`This can't be shown in ${displayUnit.trim()}`);
    }
  }
  // The same unit more than once (psi·psi) is one unit, to a power.
  const powers = new Map<string, number>();
  for (const p of v.units) powers.set(prefixOf(p) + p.unit.name, (powers.get(prefixOf(p) + p.unit.name) ?? 0) + p.power);
  const parts = [...powers].filter(([, n]) => Math.abs(n) > 1e-12);
  if (parts.length === 1 && v.units.length > 1) return v.to(`${parts[0][0]}^${parts[0][1]}`);
  if (parts.length > 1) {
    // A mix of units: the structural unit for the quantity, if there's one.
    const match = preferredFor(settings.system).find((p) => sameDims(p.dims, v.dimensions));
    if (match) return v.to(match.unit);
  }
  return v;
}

/** A matrix as Mathcad shows one: in brackets, with a shared unit after it when all its
 * entries have the same kind of unit. */
function formatMatrix(m: Matrix, settings: Settings, displayUnit?: string): string {
  const rows = m.size().length === 1 ? (m.toArray() as Value[]).map((x) => [x]) : (m.toArray() as Value[][]);
  const flat = rows.flat();
  let unit: Unit | null = null;
  if (flat.length && flat.every(isUnit) && flat.every((u) => sameDims((u as Unit).dimensions, (flat[0] as Unit).dimensions))) unit = showIn(flat[0] as Unit, settings, displayUnit);
  const cell = (x: Value) => (unit && isUnit(x) ? formatNumber(x.toNumber(unit.formatUnits()), settings.decimals) : formatValue(x, settings));
  const body = rows.map((r) => r.map(cell).join(" & ")).join("\\\\ ");
  return `\\begin{bmatrix}${body}\\end{bmatrix}${unit ? `\\,${unitLatex(unit)}` : ""}`;
}

/** Unit names shown upright (as Mathcad shows units), not as italic variables. */
export function uprightUnits(latex: string, units: string[]): string {
  let out = latex;
  for (const u of units) out = out.replace(new RegExp(`(?<![\\\\a-zA-Z{])${u}(?![a-zA-Z])`, "g"), `\\mathrm{${u}}`);
  return out;
}

// --- worksheets ------------------------------------------------------------------------------

export type SheetItem =
  | { id: string; kind: "math"; latex: string; displayUnit?: string }
  | { id: string; kind: "table"; columns: { name: string; unit: string }[]; rows: string[][] }
  | { id: string; kind: "plot"; traces: { x: string; y: string }[]; xUnit?: string; yUnit?: string }
  | { id: string; kind: "solve"; guesses: string[]; constraints: string[]; solver: string; displayUnit?: string }
  | { id: string; kind: "section"; shape: string; suffix?: string };

export type Trace = { xs: number[]; ys: number[]; error?: string };

export type Result =
  | { kind: "ok"; result?: string; defines?: string; units?: string[] }
  | { kind: "error"; message: string; incomplete?: boolean }
  | { kind: "plot"; traces: Trace[]; xUnit: string; yUnit: string }
  | { kind: "solve"; guesses: Result[]; constraints: Result[]; solver: Result }
  | { kind: "section"; label: string; metric: string; type: string; rows: { name: string; value: string; what: string }[] };

function failure(err: unknown): Result {
  if (err instanceof ParseError) return { kind: "error", message: err.message, incomplete: err.incomplete };
  if (err instanceof CalcError) return { kind: "error", message: err.message };
  return { kind: "error", message: friendly(err) };
}

/** A math region: definitions, evaluations, expressions. */
function mathRegion(latex: string, scope: Scope, settings: Settings, displayUnit?: string): Result {
  unitsRead = new Set();
  try {
    const s = parseStatement(latex);
    if (s.k === "empty" || s.k === "expression") return { kind: "ok", units: [...unitsRead] };
    if (s.k === "define") {
      if (s.params) {
        scope.set(s.name, { params: s.params, body: s.body, scope: new Map(scope) });
        return { kind: "ok", defines: s.name, units: [...unitsRead] };
      }
      const v = settle(evaluate(s.body, scope));
      scope.set(s.name, v);
      return { kind: "ok", defines: s.name, result: s.show ? formatValue(v, settings, displayUnit) : undefined, units: [...unitsRead] };
    }
    return { kind: "ok", result: formatValue(settle(evaluate(s.expr, scope)), settings, displayUnit), units: [...unitsRead] };
  } catch (err) {
    return failure(err);
  } finally {
    unitsRead = null;
  }
}

/** A table: each column a vector named by its header, in its unit. */
function tableRegion(item: Extract<SheetItem, { kind: "table" }>, scope: Scope): Result {
  try {
    const names: string[] = [];
    item.columns.forEach((col, c) => {
      const name = col.name.trim();
      if (!name) return;
      const unit = col.unit.trim() ? (unitNamed(col.unit.trim()) ?? (() => {
        try {
          return math.unit(1, col.unit.trim().replace(/\bin\b/g, "inch"));
        } catch {
          throw new CalcError(`"${col.unit}" isn't a unit`);
        }
      })()) : null;
      const values: Value[] = item.rows
        .map((row) => (row[c] ?? "").trim())
        .filter(Boolean)
        .map((text) => {
          const n = Number(text);
          if (!Number.isFinite(n)) throw new CalcError(`"${text}" in ${name} isn't a number`);
          return unit ? (math.multiply(n, unit) as unknown as Value) : n;
        });
      if (values.length) scope.set(name, matrixOf(values.map((x) => [x]) as never) as unknown as Value);
      names.push(name);
    });
    return { kind: "ok", defines: names.join(", ") };
  } catch (err) {
    return failure(err);
  }
}

/** A plot: each trace's x and y values, as numbers in the axes' units. QuickPlot: an x that
 * isn't defined runs from -10 to 10. */
function plotRegion(item: Extract<SheetItem, { kind: "plot" }>, scope: Scope): Result {
  let xUnit = item.xUnit?.trim() ?? "";
  let yUnit = item.yUnit?.trim() ?? "";
  const numbers = (v: Value, unit: string, axis: "x" | "y"): number[] => {
    const items = isRange(v) ? v.values : isMatrix(v) ? (v.toArray().flat() as Value[]) : [v];
    return items.map((x) => {
      if (typeof x === "number") return x;
      if (!isUnit(x)) throw new CalcError("Plots take numbers");
      if (!unit) {
        unit = showIn(x, DEFAULT_SETTINGS).formatUnits();
        if (axis === "x") xUnit = unit;
        else yUnit = unit;
      }
      return x.toNumber(unit.replace(/\bin\b/g, "inch"));
    });
  };
  const traces = item.traces.map((t): Trace => {
    try {
      if (!t.x.trim() || !t.y.trim()) return { xs: [], ys: [], error: "Fill in both axes" };
      const xNode = parseConstraint(t.x).lhs;
      const inner: Scope = new Map(scope);
      if (xNode.k === "name" && !scope.has(xNode.name) && !CONSTANTS[xNode.name] && !UNIT_NAMES.has(xNode.name)) {
        inner.set(xNode.name, new RangeValue(Array.from({ length: 201 }, (_, k) => -10 + k * 0.1)));
      }
      const xv = settle(evaluate(xNode, inner));
      const yv = settle(evaluate(parseConstraint(t.y).lhs, inner));
      const xs = numbers(xv, xUnit, "x");
      let ys = numbers(yv, yUnit, "y");
      if (ys.length === 1 && xs.length > 1) ys = xs.map(() => ys[0]);
      if (xs.length !== ys.length) return { xs: [], ys: [], error: "x and y have different numbers of values" };
      return { xs, ys };
    } catch (err) {
      const f = failure(err);
      return { xs: [], ys: [], error: f.kind === "error" ? f.message : "Can't plot this" };
    }
  });
  return { kind: "plot", traces, xUnit, yUnit };
}

/** A solve block: guesses, constraints, and the solver line (find), as Mathcad's. Only what
 * the solver line defines leaves the block. */
function solveRegion(item: Extract<SheetItem, { kind: "solve" }>, scope: Scope, settings: Settings): Result {
  const local: Scope = new Map(scope);
  const guesses = item.guesses.map((g) => (g.trim() ? mathRegion(g, local, settings) : ({ kind: "ok" } as Result)));
  const constraints: { lhs: Node; rhs: Node; rel: string }[] = [];
  const constraintResults = item.constraints.map((c): Result => {
    if (!c.trim()) return { kind: "ok" };
    try {
      const parsed = parseConstraint(c);
      if (!parsed.rhs) throw new CalcError("A constraint is an equation (=) or inequality (≤, ≥)");
      constraints.push({ lhs: parsed.lhs, rhs: parsed.rhs, rel: parsed.rel });
      return { kind: "ok" };
    } catch (err) {
      return failure(err);
    }
  });
  let solver: Result;
  try {
    const m = item.solver.match(/^(.*?)(\\coloneq|:=)(.*)$/);
    const lhs = m ? m[1].trim() : "";
    const rhs = (m ? m[3] : item.solver).trim();
    const show = /=\s*$/.test(rhs);
    const call = parseConstraint(rhs.replace(/=\s*$/, "")).lhs;
    if (call.k !== "apply" && call.k !== "call") throw new CalcError("The solver line is find(x, y, ...)");
    if (call.name !== "find") throw new CalcError("The solver line is find(x, y, ...)");
    const vars = call.args.map((a) => (a.k === "name" ? a.name : ""));
    if (!vars.length || vars.some((v) => !v)) throw new CalcError("List the unknowns: find(x, y)");
    if (!constraints.length) throw new CalcError("Add the constraints to solve");
    const templates = vars.map((v) => {
      const g = local.get(v);
      if (g === undefined || isFn(g) || isRange(g) || isMatrix(g)) throw new CalcError(`Give ${display(v)} a guess value`);
      return g;
    });
    const at = (u: number[]) => {
      const inner: Scope = new Map(local);
      vars.forEach((v, i) => inner.set(v, fromBase(templates[i], u[i])));
      return inner;
    };
    const start = templates.map(toBase);
    // Each equation's residual is scaled by the size of its sides at the guess.
    const scales = constraints.map((c) => {
      const inner = at(start);
      return Math.max(Math.abs(toBase(settle(evaluate(c.lhs, inner)))), Math.abs(toBase(settle(evaluate(c.rhs, inner)))), 1e-12);
    });
    const residuals = (u: number[]) => {
      const inner = at(u);
      return constraints.map((c, i) => {
        const d = (toBase(settle(evaluate(c.lhs, inner))) - toBase(settle(evaluate(c.rhs, inner)))) / scales[i];
        if (c.rel === "=") return d;
        if (c.rel === "<=" || c.rel === "<") return Math.max(0, d);
        return Math.min(0, d);
      });
    };
    const { u, error } = solveSystem(residuals, start);
    if (!(error < 1e-6)) throw new CalcError("No solution found: the constraints can't all be met from these guesses");
    const values = u.map((n, i) => settle(fromBase(templates[i], n)));
    const value = values.length === 1 ? values[0] : (matrixOf(values.map((x) => [x]) as never) as unknown as Value);
    // The solver line defines a name, or one name per unknown (a vector of names on the left).
    const names = lhs.startsWith("\\begin") ? [...lhs.matchAll(/(?:^|&|\\\\|\})\s*([a-zA-Z][a-zA-Z0-9_{}']*)/g)].map((x) => x[1].replace(/[{}]/g, "")).filter((n) => n !== "pmatrix" && n !== "bmatrix") : lhs ? [parseNameLatex(lhs)] : [];
    if (names.length > 1) names.forEach((n, i) => scope.set(n, values[i] ?? values[0]));
    else if (names.length === 1) scope.set(names[0], value);
    solver = { kind: "ok", result: show || !names.length ? formatValue(value, settings, item.displayUnit) : undefined, defines: names.join(", ") };
  } catch (err) {
    solver = failure(err);
  }
  return { kind: "solve", guesses, constraints: constraintResults, solver };
}

/** A defined name from its LaTeX (A_{s} → A_s). */
function parseNameLatex(latex: string): string {
  const s = parseStatement(`${latex}\\coloneq 0`);
  if (s.k !== "define") throw new CalcError("Define a name with the solver: x := find(x)");
  return s.name;
}

/** Works out a worksheet's regions, in the order given (reading order), each seeing what's
 * defined above it. */
const shapeUnit = (unit: string) => unit.replace(/\bin\b/g, "inch");

function sectionProperty(label: string, prop: string): Value {
  if (!shapesLoaded()) throw new CalcError("The section tables are still loading");
  const shape = findShape(label);
  if (!shape) throw new CalcError(`There's no ${label} in the AISC tables`);
  const p = shapeProperty(shape, prop);
  if (!p) throw new CalcError(`${shape.label} has no ${prop}`);
  return p.unit ? (math.unit(p.value, shapeUnit(p.unit)) as unknown as Value) : p.value;
}

/** A section region: the shape's properties, defined and listed. */
function sectionRegion(item: Extract<SheetItem, { kind: "section" }>, scope: Scope, settings: Settings): Result {
  if (!item.shape.trim()) return { kind: "error", message: "Choose a shape", incomplete: true };
  if (!shapesLoaded()) return { kind: "error", message: "Loading the section tables…", incomplete: true };
  const shape = findShape(item.shape);
  if (!shape) return { kind: "error", message: `There's no ${item.shape} in the AISC tables` };
  const suffix = item.suffix?.trim().replace(/[^A-Za-z0-9]/g, "");
  const rows: { name: string; value: string; what: string }[] = [];
  for (const [prop, n] of Object.entries(shape.values)) {
    const p = property(shape.type, prop);
    if (!p) continue;
    const name = !suffix ? p.name : p.name.includes("_") ? `${p.name},${suffix}` : `${p.name}_${suffix}`;
    const value: Value = p.unit ? (math.unit(n, shapeUnit(p.unit)) as unknown as Value) : n;
    scope.set(name, value);
    const shown = p.unit ? shapeUnit(settings.system === "SI" ? SI_UNITS[p.unit] : p.unit) : undefined;
    rows.push({ name: display(name), value: formatValue(value, settings, shown), what: p.what });
  }
  return { kind: "section", label: shape.label, metric: shape.metric, type: shape.type, rows };
}

export function evaluateSheet(items: SheetItem[], settings: Settings): Map<string, Result> {
  math.Unit.setUnitSystem(settings.system === "SI" ? "si" : "us");
  const scope: Scope = new Map();
  const results = new Map<string, Result>();
  for (const item of items) {
    if (item.kind === "math") results.set(item.id, mathRegion(item.latex, scope, settings, item.displayUnit));
    else if (item.kind === "table") results.set(item.id, tableRegion(item, scope));
    else if (item.kind === "plot") results.set(item.id, plotRegion(item, scope));
    else if (item.kind === "section") results.set(item.id, sectionRegion(item, scope, settings));
    else results.set(item.id, solveRegion(item, scope, settings));
  }
  return results;
}
