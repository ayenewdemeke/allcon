import { all, create, type Unit } from "mathjs";
import { parseStatement, ParseError, type Node } from "./parse";

// Worksheets evaluated as Mathcad does: regions in reading order (top to bottom, then left to
// right), each seeing what's defined above it. Values carry units (mathjs does the arithmetic),
// results show in the units the inputs used or, for compound ones, the structural units of the
// worksheet's system (kip·ft, ksi, klf / kN·m, MPa, kN/m), or in a unit given for that result.

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

type Fn = { params: string[]; body: Node; scope: Scope };
type Value = number | boolean | string | Unit;
type Scope = Map<string, Value | Fn>;

const isFn = (v: unknown): v is Fn => typeof v === "object" && v !== null && "body" in v && "params" in v;
const isUnit = (v: unknown): v is Unit => typeof v === "object" && v !== null && (v as { type?: string }).type === "Unit";

export class CalcError extends Error {}

const CONSTANTS: Record<string, () => Value> = {
  pi: () => Math.PI,
  e: () => Math.E,
  g: () => math.unit(9.80665, "m/s^2"),
};

/** A unit by the name written (kip, ft, kN, in), or null if it isn't one. */
function unitNamed(name: string): Unit | null {
  if (!UNIT_NAMES.has(name)) return null;
  try {
    return math.unit(1, UNIT_ALIASES[name] ?? name);
  } catch {
    return null;
  }
}

/** Dimensionless units become plain numbers (ft/ft = 1). */
function settle(v: Value): Value {
  if (isUnit(v) && v.dimensions.every((d) => d === 0) && !v.units.some((u) => u.unit.name === "percent")) return v.toNumber("");
  return v;
}

function friendly(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Units do not match|do not match/i.test(message)) return "The units don't match";
  if (/cannot convert|incompatible/i.test(message)) return "These units can't be combined that way";
  if (/Unexpected type of argument/i.test(message)) return "That doesn't work with these values (check the units)";
  return message;
}

const BUILTINS: Record<string, (...args: Value[]) => Value> = {
  sqrt: (x) => math.sqrt(x as never) as unknown as Value,
  abs: (x) => math.abs(x as never) as unknown as Value,
  sin: (x) => math.sin(x as never) as unknown as Value,
  cos: (x) => math.cos(x as never) as unknown as Value,
  tan: (x) => math.tan(x as never) as unknown as Value,
  cot: (x) => math.cot(x as never) as unknown as Value,
  sec: (x) => math.sec(x as never) as unknown as Value,
  csc: (x) => math.csc(x as never) as unknown as Value,
  asin: (x) => math.unit(math.asin(x as number) as number, "rad"),
  acos: (x) => math.unit(math.acos(x as number) as number, "rad"),
  atan: (x) => math.unit(math.atan(x as number) as number, "rad"),
  atan2: (y, x) => math.unit(math.atan2(y as number, x as number) as number, "rad"),
  sinh: (x) => math.sinh(x as number) as unknown as Value,
  cosh: (x) => math.cosh(x as number) as unknown as Value,
  tanh: (x) => math.tanh(x as number) as unknown as Value,
  ln: (x) => math.log(x as number) as unknown as Value,
  log: (x, b) => (b === undefined ? math.log10(x as number) : math.log(x as number, b as number)) as unknown as Value,
  exp: (x) => math.exp(x as number) as unknown as Value,
  max: (...xs) => math.max(...(xs as never[])) as unknown as Value,
  min: (...xs) => math.min(...(xs as never[])) as unknown as Value,
  floor: (x) => math.floor(x as number) as unknown as Value,
  ceil: (x) => math.ceil(x as number) as unknown as Value,
  round: (x, n) => math.round(x as number, (n as number) ?? 0) as unknown as Value,
  mod: (a, b) => math.mod(a as number, b as number) as unknown as Value,
};

function evaluate(node: Node, scope: Scope): Value {
  switch (node.k) {
    case "num":
      return node.v;
    case "str":
      return node.v;
    case "unit": {
      const u = unitNamed(node.name) ?? math.unit(1, node.name);
      return u;
    }
    case "name": {
      const v = scope.get(node.name);
      if (v !== undefined) {
        if (isFn(v)) throw new CalcError(`${node.name} is a function: give it values, ${node.name}(…)`);
        return v;
      }
      if (CONSTANTS[node.name]) return CONSTANTS[node.name]();
      const u = unitNamed(node.name);
      if (u) return u;
      throw new CalcError(`${display(node.name)} isn't defined`);
    }
    case "neg":
      return math.unaryMinus(evaluate(node.a, scope) as never) as unknown as Value;
    case "abs":
      return math.abs(evaluate(node.a, scope) as never) as unknown as Value;
    case "root": {
      const a = evaluate(node.a, scope);
      if (!node.n) return math.sqrt(a as never) as unknown as Value;
      const n = evaluate(node.n, scope);
      if (typeof n !== "number") throw new CalcError("A root's index is a plain number");
      return math.pow(a as never, 1 / n) as unknown as Value;
    }
    case "op": {
      const a = evaluate(node.a, scope);
      const b = evaluate(node.b, scope);
      try {
        switch (node.op) {
          case "+":
            return math.add(a as never, b as never) as unknown as Value;
          case "-":
            return math.subtract(a as never, b as never) as unknown as Value;
          case "*":
            return math.multiply(a as never, b as never) as unknown as Value;
          case "/":
            return math.divide(a as never, b as never) as unknown as Value;
          case "^":
            if (isUnit(b)) throw new CalcError("Powers are plain numbers");
            return math.pow(a as never, b as never) as unknown as Value;
          case "<":
            return math.smaller(a as never, b as never) as unknown as Value;
          case ">":
            return math.larger(a as never, b as never) as unknown as Value;
          case "<=":
            return math.smallerEq(a as never, b as never) as unknown as Value;
          case ">=":
            return math.largerEq(a as never, b as never) as unknown as Value;
          case "!=":
            return math.unequal(a as never, b as never) as unknown as Value;
          case "==":
            return math.equal(a as never, b as never) as unknown as Value;
        }
      } catch (err) {
        if (err instanceof CalcError) throw err;
        throw new CalcError(friendly(err));
      }
      break;
    }
    case "call":
    case "apply": {
      const f = scope.get(node.name);
      if (isFn(f)) {
        if (node.args.length !== f.params.length) throw new CalcError(`${display(node.name)} takes ${f.params.length} value${f.params.length === 1 ? "" : "s"}`);
        const inner: Scope = new Map(f.scope);
        f.params.forEach((p, i) => inner.set(p, evaluate(node.args[i], scope)));
        return settle(evaluate(f.body, inner));
      }
      if (node.name === "if") {
        // Mathcad's if(condition, then, otherwise): only the branch taken is worked out.
        if (node.args.length !== 3) throw new CalcError("if takes a condition, a value if true, and one if false");
        const c = evaluate(node.args[0], scope);
        return evaluate(c === true || (typeof c === "number" && c !== 0) ? node.args[1] : node.args[2], scope);
      }
      const builtin = f === undefined ? BUILTINS[node.name] : undefined;
      if (builtin) {
        try {
          return settle(builtin(...node.args.map((a) => evaluate(a, scope))));
        } catch (err) {
          throw new CalcError(friendly(err));
        }
      }
      if (node.k === "call") throw new CalcError(`${display(node.name)} isn't a function`);
      // A value next to parentheses multiplies: w(L - a).
      const a = evaluate({ k: "name", name: node.name }, scope);
      if (node.args.length !== 1) throw new CalcError(`${display(node.name)} isn't a function`);
      return math.multiply(a as never, evaluate(node.args[0], scope) as never) as unknown as Value;
    }
  }
  throw new CalcError("Can't work that out");
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
  USCS: ["kip", "kip ft", "ksi", "kip/ft", "pcf", "ft", "inch^2", "ft^3", "ft/s", "ft/s^2", "lb"],
  SI: ["kN", "kN m", "MPa", "kN/m", "kN/m^3", "m", "m^2", "m^3", "m/s", "m/s^2", "kg"],
};
const preferred = new Map<UnitSystem, { dims: number[]; unit: string }[]>();
function preferredFor(system: UnitSystem) {
  if (!preferred.has(system)) preferred.set(system, PREFERRED[system].map((unit) => ({ unit, dims: math.unit(1, unit).dimensions })));
  return preferred.get(system)!;
}
const sameDims = (a: number[], b: number[]) => a.every((d, i) => Math.abs(d - b[i]) < 1e-9);

/** A value as the LaTeX shown after "=". */
export function formatValue(v: Value, settings: Settings, displayUnit?: string): string {
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return `\\text{${v.replace(/[{}\\]/g, "")}}`;
  if (typeof v === "number") {
    if (displayUnit?.trim()) throw new CalcError("A plain number has no units to show");
    return formatNumber(v, settings.decimals);
  }
  if (!isUnit(v)) throw new CalcError("Can't show this value");
  let shown: Unit = v;
  if (displayUnit?.trim()) {
    try {
      shown = v.to(displayUnit.trim().replace(/\bin\b/g, "inch").replace(/·/g, " "));
    } catch {
      throw new CalcError(`This can't be shown in ${displayUnit.trim()}`);
    }
  } else {
    // The same unit more than once (psi·psi) is one unit, to a power.
    const powers = new Map<string, number>();
    for (const p of v.units) powers.set(prefixOf(p) + p.unit.name, (powers.get(prefixOf(p) + p.unit.name) ?? 0) + p.power);
    const parts = [...powers].filter(([, n]) => Math.abs(n) > 1e-12);
    if (parts.length === 1 && v.units.length > 1) shown = v.to(`${parts[0][0]}^${parts[0][1]}`);
    else if (parts.length > 1) {
      // A mix of units: the structural unit for the quantity, if there's one.
      const match = preferredFor(settings.system).find((p) => sameDims(p.dims, v.dimensions));
      if (match) shown = v.to(match.unit);
    }
  }
  const value = shown.toNumber(shown.formatUnits());
  return `${formatNumber(value, settings.decimals)}\\,${unitLatex(shown)}`;
}

// --- worksheets ------------------------------------------------------------------------------

export type MathInput = { id: string; latex: string; displayUnit?: string };

export type Result =
  | { kind: "ok"; result?: string; defines?: string }
  | { kind: "error"; message: string; incomplete?: boolean };

/** Works out a worksheet's math regions, in the order given (reading order), each seeing
 * what's defined above it. */
export function evaluateSheet(regions: MathInput[], settings: Settings): Map<string, Result> {
  math.Unit.setUnitSystem(settings.system === "SI" ? "si" : "us");
  const scope: Scope = new Map();
  const results = new Map<string, Result>();
  for (const r of regions) {
    try {
      const s = parseStatement(r.latex);
      if (s.k === "empty" || s.k === "expression") {
        results.set(r.id, { kind: "ok" });
      } else if (s.k === "define") {
        if (s.params) {
          scope.set(s.name, { params: s.params, body: s.body, scope: new Map(scope) });
          results.set(r.id, { kind: "ok", defines: s.name });
        } else {
          const v = settle(evaluate(s.body, scope));
          scope.set(s.name, v);
          results.set(r.id, { kind: "ok", defines: s.name, result: s.show ? formatValue(v, settings, r.displayUnit) : undefined });
        }
      } else {
        results.set(r.id, { kind: "ok", result: formatValue(settle(evaluate(s.expr, scope)), settings, r.displayUnit) });
      }
    } catch (err) {
      if (err instanceof ParseError) results.set(r.id, { kind: "error", message: err.message, incomplete: err.incomplete });
      else if (err instanceof CalcError) results.set(r.id, { kind: "error", message: err.message });
      else results.set(r.id, { kind: "error", message: friendly(err) });
    }
  }
  return results;
}
