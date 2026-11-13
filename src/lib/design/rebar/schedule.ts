import type { Body, Line } from "@/lib/calcs/library/templates";
import type { ImageRegion } from "@/lib/calcs/types";
import { num } from "../calc-style";
import { textTable, wrap, type TableColumn } from "../svg-table";
import { sumLines as fitSum } from "@/lib/calcs/library/fit";
import { ftIn, roundDown, unitWeight } from "./bars";

// A bar schedule and its quantities, for any design: each group of identical bars with its mark,
// size, number, bending shape and length; the weight by size; and the concrete. Marks are the
// size then a sequence number (1101, 1102, 501): ALLCON's labels for the schedule, since CDOT's
// plans call bars out by size and use instead (Bridge Detail Manual 4.3), which each group carries.

/** A bending shape: its dimensions out to out (in), in the order its diagram labels them A, B, C… */
export type BarShape =
  | { kind: "straight"; dims: [number] } // A
  | { kind: "hooked"; dims: number[]; hooks: 1 | 2 } // [G, A] or [G, A, G]: 90° hooks
  | { kind: "bent"; dims: number[]; hooks: 0 | 1 | 2 } // segments following the concrete (a tapered soffit), hooks at the ends counted in dims
  | { kind: "closed"; dims: [number, number]; hook: number } // a closed stirrup W × H, with two 135° hooks of `hook` each
  | { kind: "dowel"; dims: [number, number] }; // a vertical leg A with a 90° hook G at the top

export type BarGroup = {
  mark: string;
  size: number;
  count: number;
  shape: BarShape;
  length: number; // in, each bar, rounded down to the inch (CDOT 4.2)
  use: string; // "Top bars", "Stirrups"…
  callout: string; // as CDOT calls it out: "#11 Cont (Tot 26)"
  where?: string;
  splice?: string; // how its run is spliced
  series?: { dim: number; min: number; max: number }; // a bar series (CDOT 4.3): dimension `dim` varies from min to max; `length` is the average
  paid?: string; // paid under another item (a bridge rail's bars in its 606 item): shown, not in the reinforcing steel's total
};

/** A part's concrete; `math`, when given, is how it's worked out in the quantity sheet (LaTeX of a volume), `ref` the note beside it. */
export type ConcreteItem = { label: string; cy: number; basis: string; math?: string; terms?: string[]; ref?: string };
export type ExtraSteel = { label: string; weight: number; basis: string; math?: string; terms?: string[]; ref?: string };
// `terms`, in place of `math`: the summands (a "-" leading a negative one), which the sheet spreads
// over as many lines as it takes to stay on the page.

export type Schedule = {
  groups: BarGroup[];
  bySize: { size: number; length: number; weight: number }[]; // ft and lb
  extra?: ExtraSteel[]; // reinforcing taken from a standard's table (lb), not bar by bar; `math` a weight
  elsewhere?: { label: string; weight: number }[]; // bars paid under another item, by that item (lb)
  total: number; // lb, the bars and any extra (not those paid elsewhere)
  concrete: ConcreteItem[];
  concreteTotal: number; // CY
};

/** The length of a shape, out-to-out dimensions summed, plus a closed stirrup's hooks; rounded down to the inch. */
export function shapeLength(s: BarShape) {
  const sum = s.dims.reduce((a, b) => a + b, 0);
  return roundDown(s.kind === "closed" ? 2 * sum + 2 * s.hook : sum);
}

/** Groups (without marks) given marks by size, in the order given, and identical bars merged. */
export function markGroups(groups: Omit<BarGroup, "mark">[]): BarGroup[] {
  const merged: Omit<BarGroup, "mark">[] = [];
  for (const g of groups) {
    if (!(g.count > 0)) continue;
    const same = merged.find((m) => m.size === g.size && m.use === g.use && m.length === g.length && m.paid === g.paid && JSON.stringify(m.shape) === JSON.stringify(g.shape) && JSON.stringify(m.series) === JSON.stringify(g.series));
    if (same) same.count += g.count;
    else merged.push({ ...g });
  }
  const seq: Record<number, number> = {};
  return merged.map((g) => {
    seq[g.size] = (seq[g.size] ?? 0) + 1;
    return { ...g, mark: `${g.size}${String(seq[g.size]).padStart(2, "0")}` };
  });
}

export function schedule(groups: BarGroup[], concrete: ConcreteItem[], extra: Schedule["extra"] = []): Schedule {
  const own = groups.filter((g) => !g.paid);
  const sizes = [...new Set(own.map((g) => g.size))].sort((a, b) => b - a);
  const bySize = sizes.map((size) => {
    const length = own.filter((g) => g.size === size).reduce((s, g) => s + (g.count * g.length) / 12, 0);
    return { size, length, weight: length * unitWeight(size) };
  });
  const total = bySize.reduce((s, b) => s + b.weight, 0) + extra.reduce((s, e) => s + e.weight, 0);
  const paid = [...new Set(groups.filter((g) => g.paid).map((g) => g.paid!))];
  const elsewhere = paid.map((label) => ({ label, weight: groups.filter((g) => g.paid === label).reduce((s, g) => s + ((g.count * g.length) / 12) * unitWeight(g.size), 0) }));
  return { groups, bySize, ...(extra.length ? { extra } : {}), ...(elsewhere.length ? { elsewhere } : {}), total, concrete, concreteTotal: concrete.reduce((s, c) => s + c.cy, 0) };
}

const SHAPE_NAME: Record<BarShape["kind"], string> = { straight: "Straight", hooked: "Hooked", bent: "Bent", closed: "Closed stirrup", dowel: "Dowel" };

/** The shape's dimensions as the schedule shows them: A = 39'-8", G = 1'-9"; a series' varying one as its range. */
export function shapeDims(s: BarShape, series?: BarGroup["series"]) {
  const letters = s.kind === "hooked" ? (s.hooks === 2 ? ["G", "A", "G"] : ["G", "A"]) : s.kind === "closed" ? ["W", "H"] : s.kind === "dowel" ? ["A", "G"] : s.dims.map((_, k) => String.fromCharCode(65 + k));
  return s.dims.map((d, k) => (series && series.dim === k ? `${letters[k]} varies ${ftIn(series.min)} to ${ftIn(series.max)}` : `${letters[k]} ${ftIn(d)}`)).join(", ");
}

export const shapeName = (s: BarShape) => SHAPE_NAME[s.kind];

// CDOT calls bars out by size and use, not by mark (Bridge Detail Manual 4.3): the schedule shows no
// marks (they only tie the drawings' lines to their groups here).
const SCHEDULE_COLS: TableColumn[] = [
  { title: "Size", x: 4 },
  { title: ["No. of", "bars"], x: 72, anchor: "end" },
  { title: ["Length", "each"], x: 130, anchor: "end" },
  { title: ["Weight", "lb"], x: 186, anchor: "end" },
  { title: "Shape", x: 198 },
  { title: "Dimensions", x: 276 },
  { title: "Use and callout", x: 440 },
];

/** A callout without its closing bracket when that only repeats the use: "#4 @ 0'-6" (top slab, top mat)" beside "Top slab, top mat". */
export function trimCallout(callout: string, use: string) {
  if (!callout.endsWith(")")) return callout;
  let depth = 0;
  for (let k = callout.length - 1; k >= 0; k--) {
    if (callout[k] === ")") depth++;
    else if (callout[k] === "(" && --depth === 0) return use.toLowerCase().includes(callout.slice(k + 1, -1).toLowerCase()) ? callout.slice(0, k).trimEnd() : callout;
  }
  return callout;
}

/** A mark's weight: number × length × unit weight (lb). */
export const groupWeight = (g: BarGroup) => ((g.count * g.length) / 12) * unitWeight(g.size);

/**
 * The bar schedule as one table, the way a plan sheet's bar list reads: each mark's size, number,
 * length and weight, its bending shape and dimensions, and where it goes with its callout (and
 * splices); the total weight last. At most 30 rows a picture, so each fits on a page.
 */
export function scheduleTable(sch: Schedule): Line[] {
  const lb = (v: number) => Math.round(v).toLocaleString("en-US");
  const rows = sch.groups.map((g) => [
    `#${g.size}`,
    String(g.count),
    `${g.series ? "avg. " : ""}${ftIn(g.length)}`,
    lb(groupWeight(g)),
    `${shapeName(g.shape)}${g.series ? " series" : ""}`,
    wrap(shapeDims(g.shape, g.series), 24),
    wrap(`${g.use}${g.where ? ` (${g.where})` : ""}: ${trimCallout(g.callout, g.use)}${g.splice ? `; ${g.splice}` : ""}${g.paid ? `; paid under ${g.paid}, not in the total` : ""}`, 44),
  ]);
  const own = sch.bySize.reduce((s, b) => s + b.weight, 0);
  rows.push(["Total", String(sch.groups.filter((g) => !g.paid).reduce((s, g) => s + g.count, 0)), "", lb(own), "", "", "The bars above (any paid elsewhere left out)"]);
  const out: Line[] = [];
  for (let k = 0; k < rows.length; k += 30) out.push({ region: textTable(SCHEDULE_COLS, rows.slice(k, k + 30), 720) });
  return out;
}

/**
 * The quantities as CDOT tabulates them (its bridge quantity workbooks): a summary of approximate
 * quantities by pay item (item number, description, pay unit) for the element; then each item's
 * tabulation as live math: the concrete by part, and the reinforcing steel bar by bar (bar
 * description, bar number, number of bars, unit weight, length, weight); then the record set's
 * total with room for the independent check set's and their difference (within 1%, CDOT Bridge
 * Detail Manual 4.12).
 */
type SummaryLine = { code: string; description: string; unit: string; quantity: number; role: string };

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The summary of approximate quantities as a table, its columns as CDOT's: item number, description, quantity, unit. */
export function summaryTable(location: string, rows: SummaryLine[]): Body<ImageRegion> {
  const W = 560;
  const rowH = 20;
  const top = 44;
  const H = top + rows.length * rowH + 8;
  const qty = (l: SummaryLine) => (l.unit === "LB" ? Math.round(l.quantity).toLocaleString("en-US") : l.quantity.toFixed(1));
  const x = { code: 4, desc: 92, qty: 470, unit: 482 };
  const t = (tx: number, y: number, s: string, extra = "") => `<text x="${tx}" y="${y}" font-size="11"${extra}>${xmlEsc(s)}</text>`;
  const parts = [
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif" fill="#171717">`,
    t(x.code, 14, location, ' font-weight="bold"'),
    t(x.code, 34, "Item No.", ' font-weight="bold"'),
    t(x.desc, 34, "Description", ' font-weight="bold"'),
    t(x.qty, 34, "Quantity", ' font-weight="bold" text-anchor="end"'),
    t(x.unit, 34, "Unit", ' font-weight="bold"'),
    `<line x1="0" y1="${top - 4}" x2="${W}" y2="${top - 4}" stroke="#171717" stroke-width="1"/>`,
    ...rows.flatMap((l, k) => {
      const y = top + k * rowH + 14;
      return [t(x.code, y, l.code), t(x.desc, y, l.description), t(x.qty, y, qty(l), ' text-anchor="end"'), t(x.unit, y, l.unit), `<line x1="0" y1="${y + 6}" x2="${W}" y2="${y + 6}" stroke="#c8d0dc" stroke-width="0.5"/>`];
    }),
    "</svg>",
  ];
  return { kind: "image", width: W, height: H, svg: parts.join("") };
}

export { texWidth } from "@/lib/calcs/library/fit";

/** A pay unit's dimension for the worked-out math (LS and EACH are counts, not worked out). */
const UNIT_OF: Record<string, string> = { CY: "yd^3", SY: "yd^2", SF: "ft^2", LF: "ft", LB: "lb" };

export function quantityLines(title: string, sch: Schedule, intro?: string, pay?: { location: string; lines: SummaryLine[]; bases?: Record<string, string>; maths?: Record<string, { math?: string; terms?: string[]; ref?: string }> }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note", extra?: { keepWithNext?: boolean; newPage?: boolean }) => lines.push({ text: t, ...(style ? { style } : {}), ...(extra ?? {}) });
  // Lines of math go beside their notes, or across the page when too wide (the layout's rule, fit.ts);
  // long sums are spread over parts that each fit.
  const mathLine = (math: string, ref: string, unit: string) => lines.push({ math, ...(ref ? { ref } : {}), unit });
  const sumLines = (base: string, sub: string, terms: string[], wrapT: (inner: string, many: boolean) => string, ref: string, unit: string, partSub?: string) => lines.push(...fitSum(base, sub, terms, { wrap: wrapT, ref, unit, partSub }));
  /** The record set's total, in parts when it's too long for one line. */
  const total = (base: string, sub: string, names: string[], unit: string) => sumLines(base, sub, names, (x) => x, "Total record set", unit, "t");
  const concreteItem = pay?.lines.find((l) => l.role === "concrete");
  const rebarItem = pay?.lines.find((l) => l.role === "rebar");
  text(`${title.toUpperCase()}: QUANTITIES`, "heading");
  text(intro ?? "Purpose:- The reinforcing steel and concrete of the detailed bars and outline below, for the estimate.");
  text("Method:- Each bar's length is the sum of its out-to-out dimensions with its standard hooks (AASHTO 5.10.2.1), rounded down to the inch; bars longer than stock are lapped with Class B splices (AASHTO 5.10.8.4.3a), and the splice lengths are counted. Weights are the bars' nominal unit weights (ASTM A615). Concrete is to the tenth of a cubic yard and reinforcing steel to the nearest 10 lb, as CDOT's summaries carry them.");
  if (pay?.lines.length) {
    text("Summary of approximate quantities", "subheading", { keepWithNext: true });
    lines.push({ region: summaryTable(pay.location, pay.lines) });
  }
  const others = (pay?.lines ?? []).filter((l) => l.role !== "concrete" && l.role !== "rebar");
  const otherLines = () => {
    if (!others.length) return;
    text("Other items", "subheading", { keepWithNext: true });
    others.forEach((l, k) => {
      const m = pay?.maths?.[l.code];
      const unit = UNIT_OF[l.unit];
      if (m && (m.math || m.terms?.length) && unit) {
        // The pay item above, its working with a short note beside it.
        text(`${l.code} ${l.description} (${l.unit})`, "note", { keepWithNext: true });
        const ref = m.ref ?? "";
        if (m.terms?.length) sumLines("Q", String(k + 1), m.terms, (x) => x, ref, unit);
        else mathLine(`Q_{${k + 1}}\\coloneq ${m.math}=`, ref, unit);
      } else text(`${l.code} ${l.description} (${l.unit}):- ${l.unit === "LB" ? Math.round(l.quantity) : l.quantity}. ${pay?.bases?.[l.code] ?? ""}${pay?.bases?.[l.code] ? "." : ""}`);
    });
  };
  if (sch.concrete.length) {
    text(concreteItem ? `${concreteItem.code} ${concreteItem.description} (${concreteItem.unit})` : "Concrete", "subheading", { keepWithNext: true });
    sch.concrete.forEach((c, k) => {
      // Worked out: the part's dimensions or its standard's quantity per foot.
      if (c.terms?.length) return sumLines("V", `c${k + 1}`, c.terms, (x) => x, c.ref ?? c.label, "yd^3");
      if (c.math) return mathLine(`V_{c${k + 1}}\\coloneq ${c.math}=`, c.ref ?? c.label, "yd^3");
      text(`${c.label}:- ${c.basis}.`, undefined, { keepWithNext: true });
      lines.push({ math: `V_{c${k + 1}}\\coloneq ${num(c.cy * 27)}\\mathrm{ft}^{3}=`, ref: c.label, unit: "yd^3" });
    });
    total("V", "conc", sch.concrete.map((_, k) => `V_{c${k + 1}}`), "yd^3");
  }
  if (!sch.groups.length && !sch.extra?.length) {
    otherLines();
    return lines;
  }
  text(rebarItem ? `${rebarItem.code} ${rebarItem.description} (${rebarItem.unit})` : "Reinforcing steel", "subheading", { keepWithNext: true });
  if (sch.groups.length) {
    text("Bar schedule:", "note", { keepWithNext: true });
    lines.push(...scheduleTable(sch));
    text("Weight by bar size:- the number of bars × each one's length, in the order of the schedule, summed for the size and multiplied by its unit weight.", "note", { keepWithNext: true });
  }
  for (const e of sch.elsewhere ?? []) text(`The ${sch.groups.filter((g) => g.paid === e.label).map((g) => g.use.toLowerCase()).filter((u, k, a) => a.indexOf(u) === k).join(", ")} (${Math.round(e.weight)} lb) are paid under ${e.label}, not here.`, "note");
  for (const b of sch.bySize) {
    const own = sch.groups.filter((g) => g.size === b.size && !g.paid);
    const rate = `\\mathrm{in}\\cdot ${num(unitWeight(b.size))}\\frac{\\mathrm{lb}}{\\mathrm{ft}}`;
    sumLines("W", `s${b.size}`, own.map((g) => `${g.count}\\cdot ${num(g.length)}`), (inner, many) => `${many ? `\\left(${inner}\\right)` : inner}${rate}`, `#${b.size} bars: number × length each`, "lb");
  }
  (sch.extra ?? []).forEach((e, k) => {
    if (e.terms?.length) return sumLines("W", `x${k + 1}`, e.terms, (x) => x, e.ref ?? e.label, "lb");
    if (e.math) return mathLine(`W_{x${k + 1}}\\coloneq ${e.math}=`, e.ref ?? e.label, "lb");
    text(`${e.label}:- ${e.basis}.`, undefined, { keepWithNext: true });
    lines.push({ math: `W_{x${k + 1}}\\coloneq ${num(e.weight)}\\mathrm{lb}`, ref: e.label });
  });
  const terms = [...sch.bySize.map((b) => `W_{s${b.size}}`), ...(sch.extra ?? []).map((_, k) => `W_{x${k + 1}}`)];
  total("W", "rebar", terms, "lb");
  text("Check:- Total check set (an independent take-off): ________. Difference from the record set: ________ % (within 1%, CDOT Bridge Detail Manual 4.12).", "note");
  otherLines();
  return lines;
}
