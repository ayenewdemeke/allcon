import type { Line } from "@/lib/calcs/library/templates";
import { cell } from "./calc-style";
import { textTable, wrap } from "./svg-table";

// The summary of the checks at the end of every calc package: a table of each check with its demand,
// capacity, ratio, result and reference, in groups (a girder, a span, a pier), each group's verdict
// above it, and what the columns mean. The same checks the design tool lists.

export type SummaryCheck = { name: string; demand: number; capacity: number; unit: string; ok: boolean; ref: string; advisory?: boolean };
export type SummaryGroup = { title?: string; checks: SummaryCheck[] };

const COLS = [
  { title: "Check", x: 4 },
  { title: "Demand", x: 368, anchor: "end" as const },
  { title: "Capacity", x: 436, anchor: "end" as const },
  { title: "Unit", x: 442 },
  { title: "Ratio", x: 516, anchor: "end" as const },
  { title: "Result", x: 526 },
  { title: "Reference", x: 578 },
];

const result = (c: SummaryCheck) => (c.advisory ? (c.ok ? "Info" : "Info, over") : c.ok ? "OK" : "NG");
const color = (c: SummaryCheck) => (c.advisory ? "#b45309" : c.ok ? "#15803d" : "#b91c1c");
const num = (v: number) => (Number.isFinite(v) ? (Math.abs(v) >= 1e5 ? v.toExponential(2) : cell(v)) : "—");

/** "All 12 checks pass", or how many fail, and how many are for information. */
export function verdictOf(checks: SummaryCheck[]) {
  const required = checks.filter((c) => !c.advisory);
  const failing = required.filter((c) => !c.ok).length;
  const info = checks.length - required.length;
  return `${failing ? `${failing} of ${required.length} checks fail` : `all ${required.length} checks pass`}${info ? `; ${info} for information` : ""}`;
}

export function checksSummary(groups: SummaryGroup[]): Line[] {
  const all = groups.flatMap((g) => g.checks);
  if (!all.length) return [];
  const lines: Line[] = [
    { text: "Summary of the checks", style: "subheading", newPage: true, keepWithNext: true },
    { text: `Result:- ${verdictOf(all)}.` },
    {
      text: "Columns:- Check is what is checked. Demand is the factored effect, or the value held to a limit. Capacity is the factored resistance, or the limit, in the unit given. Ratio is the demand over the capacity, 1.00 or less passing. Result is OK, NG (not good: the check fails), or Info for a check shown for information only, not a requirement here (Info, over when it is over its limit). Reference is the article, equation or table of the specification.",
      style: "note",
      keepWithNext: true,
    },
  ];
  for (const g of groups) {
    if (!g.checks.length) continue;
    if (g.title) lines.push({ text: `${g.title}:- ${verdictOf(g.checks)}.`, style: "note", keepWithNext: true });
    // A picture of at most 30 rows, so each fits on a page.
    for (let k = 0; k < g.checks.length; k += 30) {
      const part = g.checks.slice(k, k + 30);
      const rows = part.map((c) => [wrap(c.name, 54), num(c.demand), num(c.capacity), wrap(c.unit, 12), c.capacity > 0 ? (c.demand / c.capacity).toFixed(2) : "—", result(c), wrap(c.ref, 26)]);
      lines.push({ region: textTable(COLS, rows, 720, undefined, part.map(color)) });
    }
  }
  return lines;
}
