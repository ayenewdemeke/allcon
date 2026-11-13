import type { Line } from "./templates";

// Keeping a generated worksheet's math on the page and clear of the notes beside it. Widths are in
// "characters" as estimated from the LaTeX (a fraction as its wider part, a root or sub- or
// superscript as it shows), calibrated against 324 lines of a rendered package (letter, 672 px of
// content): at most about 11 px a character, a computed result ("= 11.75 ft") about 11 more, and
// 425 px before a note beside the math starts.

/** About how many characters wide a line of math shows. */
export function texWidth(latex: string) {
  let s = latex.replace(/\\(left|right)(?=[(|.)[\]]|\\[{}])/g, "");
  for (let k = 0; k < 12; k++) {
    const t = s
      .replace(/\\(mathrm|text|operatorname)\{([^{}]*)\}/g, "$2")
      .replace(/\\sqrt\{([^{}]*)\}/g, "√$1")
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => (a.length >= b.length ? a : b))
      .replace(/\^\{([^{}]*)\}/g, (_, a: string) => (a.length > 2 ? a.slice(0, Math.ceil(a.length / 2)) : "²"))
      .replace(/_\{([^{}]*)\}/g, (_, a: string) => a.slice(0, Math.ceil(a.length * 0.6)));
    if (t === s) break;
    s = t;
  }
  return s.replace(/\\coloneq/g, "≔").replace(/\\[a-zA-Z]+/g, "·").replace(/[{}\\]/g, "").length;
}

/** A symbol with its subscript, a single letter written as p_u. */
const nameOf = (base: string, sub: string) => (sub.length === 1 ? `${base}_${sub}` : `${base}_{${sub}}`);

/** The width a line of math takes, its result included when it shows one. */
export const mathChars = (latex: string) => texWidth(latex) + (latex.trimEnd().endsWith("=") ? 11 : 0);

/** At most this wide: beside a note (which starts 425 px in), or across the page (660 px). */
export const FIT = { beside: 38, across: 60 };
export const fitsBeside = (latex: string) => mathChars(latex) <= FIT.beside;
export const fitsAcross = (latex: string) => mathChars(latex) <= FIT.across;

/**
 * The greatest (or least) of several cases, as lines that stay on the page: name := max(a, b, …) =
 * when it fits, else each case on its own line, name_1 := a =, name_2 := b = …, with the case's note,
 * then name := max(name_1, name_2, …) = with the note.
 */
export function maxLines(base: string, sub: string, cases: string[], o: { fn?: "max" | "min"; ref?: string; unit?: string; names?: (string | undefined)[] } = {}): Line[] {
  const fn = o.fn ?? "max";
  const unit = o.unit ? { unit: o.unit } : {};
  const ref = o.ref ? { ref: o.ref } : {};
  if (cases.length === 1) return [{ math: `${nameOf(base, sub)}\\coloneq ${cases[0]}=`, ...ref, ...unit }];
  const one = `${nameOf(base, sub)}\\coloneq\\${fn}\\left(${cases.join(",")}\\right)=`;
  if (fitsAcross(one)) return [{ math: one, ...ref, ...unit }];
  // Named cases one a line; unnamed ones (many alike, a layer each) in groups that fit across the page.
  const groups: string[][] = [];
  for (const c of cases) {
    const last = groups[groups.length - 1];
    if (last && !o.names && fitsAcross(`${base}_{${sub}1}\\coloneq\\${fn}\\left(${[...last, c].join(",")}\\right)=`)) last.push(c);
    else groups.push([c]);
  }
  const names = groups.map((_, k) => `${base}_{${sub}${k + 1}}`);
  const part = (g: string[]) => (g.length === 1 ? g[0] : `\\${fn}\\left(${g.join(",")}\\right)`);
  return [...groups.map((g, k): Line => ({ math: `${names[k]}\\coloneq ${part(g)}=`, ...(o.names?.[k] ? { ref: o.names[k] } : {}), ...unit })), { math: `${nameOf(base, sub)}\\coloneq\\${fn}\\left(${names.join(",")}\\right)=`, ...ref, ...unit }];
}

/**
 * A sum as lines that stay on the page: base_sub := wrap(t1 + t2 + …) = when it fits across the
 * page, else in parts base_{sub}a, base_{sub}b … (each across the page, without a note) and then
 * base_sub := the parts' sum, with the note. A term leading with "-" is subtracted.
 */
export function sumLines(base: string, sub: string, terms: string[], o: { wrap?: (inner: string, many: boolean) => string; ref?: string; unit?: string; partSub?: string } = {}): Line[] {
  const wrap = o.wrap ?? ((x: string) => x);
  const join = (ts: string[]) => ts.map((t, k) => (k === 0 || t.startsWith("-") ? t : `+${t}`)).join("");
  const line = (name: string, ts: string[]) => `${name}\\coloneq ${wrap(join(ts), ts.length > 1)}=`;
  const unit = o.unit ? { unit: o.unit } : {};
  const whole = line(nameOf(base, sub), terms);
  if (fitsAcross(whole) || terms.length === 1) return [{ math: whole, ...(o.ref ? { ref: o.ref } : {}), ...unit }];
  const part = o.partSub ?? sub;
  const chunks: string[][] = [];
  for (const t of terms) {
    const last = chunks[chunks.length - 1];
    if (last && fitsAcross(line(`${base}_{${part}a}`, [...last, t]))) last.push(t);
    else chunks.push([t]);
  }
  const names = chunks.map((_, k) => `${base}_{${part}${String.fromCharCode(97 + k)}}`);
  return [...chunks.map((c, k): Line => ({ math: line(names[k], c), wide: true, ...unit })), { math: `${nameOf(base, sub)}\\coloneq ${names.join("+")}=`, ...(o.ref ? { ref: o.ref } : {}), ...unit }];
}
