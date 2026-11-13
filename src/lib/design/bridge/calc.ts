import type { Line } from "@/lib/calcs/library/templates";
import { checksSummary, verdictOf, type SummaryGroup } from "../checks-summary";
import type { Figure } from "../figures";
import type { PayLine } from "../rebar/pay-lines";
import { textTable, wrap } from "../svg-table";
import { bearingText, stationText } from "./alignment";
import type { BridgeInputs, BridgeRun } from "./bridge";

// The Bridge's calc package, as a DOT bridge's design calculations are bound: a front page with the
// bridge in 3D, the bridge's description and layout, the summary of the design checks (superstructure,
// then substructure), Part 1 the superstructure (the deck, overhang and rail; the girders), the load
// path to the supports, Part 2 the substructure support by support in load-path order (bearings, the
// abutment or the pier's cap and column, the foundation, the approach slab and wingwall), and Part 3 the
// quantities: the summary of quantities under CDOT's pay items, a column per part of the bridge, then
// each part's tabulation. Each component's own calc is included as its design tool writes it.

/** A component's calc: what it is in the bridge, its design's name, its lines and its checks. */
export type CalcPart = { label: string; name: string; lines: Line[]; checks: SummaryGroup[] };
export type SupportCalc = { name: string; type: string; parts: CalcPart[] };
/** A column of the summary of quantities: a part of the bridge and its pay lines. */
export type PayColumn = { label: string; lines: PayLine[] };

export type BridgeCalcInput = {
  title: string;
  b: BridgeInputs;
  run: BridgeRun;
  figures?: { render?: Figure; plan?: Figure; profile?: Figure };
  superstructure: CalcPart[];
  supports: SupportCalc[];
  pay: PayColumn[];
  tabulations: { label: string; lines: Line[] }[];
  missing: string[]; // components with no linked design
};

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const TYPE: Record<string, string> = {
  "integral-abutment": "Integral abutment",
  "semi-integral-abutment": "Semi-integral abutment",
  "seat-abutment": "Seat abutment",
  "continuous-pier": "Pier, girders continuous",
  "simple-pier": "Pier, girders simple",
};

/** Two-column facts as a table picture. */
const facts = (rows: [string, string][], title?: string): Line => ({ region: textTable([{ title: "Item", x: 4 }, { title: "Value", x: 330 }], rows, 720, title) });

/** A summary of the checks under a heading of its own (the component's groups titled with the component). */
function summaryOf(title: string, parts: CalcPart[]): Line[] {
  const groups = parts.flatMap((p) => p.checks.map((g) => ({ title: g.title ? `${p.label}, ${g.title}` : p.label, checks: g.checks })));
  const lines = checksSummary(groups);
  if (lines.length) lines[0] = { text: title, style: "subheading", newPage: true, keepWithNext: true };
  return lines;
}

/** The SOQ: an item per row, a column per part of the bridge, and the total (CDOT's summary of quantities). */
export function soqRows(pay: PayColumn[]) {
  const items = new Map<string, { code: string; description: string; unit: string; values: number[] }>();
  pay.forEach((col, k) => {
    for (const l of col.lines) {
      const it = items.get(l.code) ?? { code: l.code, description: l.description, unit: l.unit, values: pay.map(() => 0) };
      it.values[k] += l.quantity;
      items.set(l.code, it);
    }
  });
  return [...items.values()].sort((a, b) => a.code.localeCompare(b.code)).map((it) => ({ ...it, total: it.values.reduce((s, v) => s + v, 0) }));
}

const qty = (unit: string, v: number) => (v === 0 ? "" : unit === "CY" ? f1(v) : String(Math.round(v)));

export function bridgeCalcLines(p: BridgeCalcInput): Line[] {
  const { b, run } = p;
  const lay = run.layout;
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note", extra?: { newPage?: boolean; keepWithNext?: boolean }) => lines.push({ text: t, ...(style ? { style } : {}), ...(extra ?? {}) });
  const allParts = [...p.superstructure, ...p.supports.flatMap((s) => s.parts)];
  const allChecks = allParts.flatMap((x) => x.checks.flatMap((g) => g.checks));

  // --- front page -----------------------------------------------------------------------------------------------------
  text(p.title.toUpperCase(), "heading");
  text("Bridge design calculations: superstructure, substructure and quantities", "subheading");
  if (p.figures?.render) lines.push({ region: p.figures.render });
  text(
    `Description:- ${lay.spans.length} span${lay.spans.length > 1 ? "s" : ""} of ${b.nGirders} ${lay.shapeName} girders, ${f2(lay.length)} ft along the alignment from ${b.supports[0].name} (Sta. ${stationText(b.supports[0].station)}) to ${b.supports[b.supports.length - 1].name} (Sta. ${stationText(b.supports[b.supports.length - 1].station)}), a ${f2(lay.width)} ft deck ${b.deckT} in thick.`,
  );
  text(`Result:- ${allChecks.length ? verdictOf(allChecks) : "no checks"} across ${allParts.length} component design${allParts.length === 1 ? "" : "s"}.`);
  text("References:- AASHTO LRFD Bridge Design Specifications, 10th Edition; CDOT Bridge Design Manual; CDOT Bridge Detail Manual and standard worksheets (B-sheets); each component's own references in its part.");
  text(
    "Contents:- the bridge's description and layout; the summary of the design checks; Part 1, Superstructure (the deck, overhang and bridge rail; the girders; the load path to the supports); Part 2, Substructure, support by support (bearings; abutment, or pier cap and column; foundation; approach slab and wingwall); Part 3, Quantities (the summary of quantities under CDOT's pay items, then each part's tabulation).",
  );
  if (p.missing.length) text(`Not included:- ${p.missing.join("; ")}: no design is linked to the Bridge for ${p.missing.length === 1 ? "it" : "them"} yet.`, "note");

  // --- description and layout ----------------------------------------------------------------------------------------
  text("Bridge description", "subheading", { newPage: true, keepWithNext: true });
  const al = b.alignment;
  lines.push(
    facts(
      [
        ["Alignment", `Sta. ${stationText(al.refStation)} at N ${f2(al.northing)}, E ${f2(al.easting)}, back tangent ${bearingText(al.azimuth)}`],
        ...al.curves.map((c, k): [string, string] => [`Horizontal curve ${k + 1}`, `PI Sta. ${stationText(c.pi)}, R = ${f2(c.radius)} ft, ahead ${bearingText(c.azimuth)}${c.spiralIn || c.spiralOut ? `, spirals ${f2(c.spiralIn ?? 0)} / ${f2(c.spiralOut ?? 0)} ft` : ""}`]),
        ["Profile", `Sta. ${stationText(b.profile.station)} at El. ${f2(b.profile.elevation)}, grade ${f2(b.profile.grade)}%`],
        ...b.profile.curves.map((c, k): [string, string] => [`Vertical curve ${k + 1}`, `PVI Sta. ${stationText(c.pvi)}, exit grade ${f2(c.grade)}%, L = ${f2(c.length)} ft`]),
        ["Roadway section", `left ${b.roadway.leftSlope} ft/ft, right ${b.roadway.rightSlope} ft/ft, crown ${f2(b.roadway.crownOffset)} ft from the alignment${b.roadway.sections?.length ? `; ${b.roadway.sections.length} superelevation templates` : ""}`],
        ["Girders", `${b.nGirders} ${lay.shapeName} at ${f2(b.spacing)} ft${b.supports.some((s) => s.spacing && s.spacing !== b.spacing) ? " (flared: spacing set at each support)" : ""}, bridge line ${f2(b.bridgeLineOffset)} ft from the alignment`],
        ["Deck", `${f2(b.leftEdge + b.rightEdge)} ft wide, ${b.deckT} in (${b.sacrificial} in sacrificial), f'c ${b.fcDeck} ksi, slab offset ${b.slabOffset} in, future wearing surface ${b.fws} psf`],
        ["Bridge rail", b.rail && b.rail.type !== "custom" ? `CDOT ${b.rail.type.replace("type", "Type ").replace("-mash", " MASH").replace("-4", " (#4)").replace("-3", " (#3)")}, ${b.rail.testLevel}` : `barrier, ${f2(b.barrierWidth)} ft wide`],
      ],
      "THE BRIDGE",
    ),
  );
  lines.push({
    region: textTable(
      [{ title: "Support", x: 4 }, { title: "Station", x: 120 }, { title: "Skew (deg)", x: 250, anchor: "end" }, { title: "Type", x: 262 }, { title: "End dist. (ft)", x: 500, anchor: "end" }, { title: "Brg offset (ft)", x: 590, anchor: "end" }, { title: "Brg ht (in)", x: 670, anchor: "end" }],
      b.supports.map((s) => [s.name, stationText(s.station), f2(s.skew), TYPE[s.type] ?? s.type, f2(s.endDistance), f2(s.bearingOffset), f2(s.bearingHeight)]),
      720,
      "SUPPORTS",
    ),
  });
  lines.push({
    region: textTable(
      [{ title: "Span", x: 4 }, { title: "From – to", x: 60 }, { title: "Girder", x: 230 }, { title: "Brg–brg L (ft)", x: 380, anchor: "end" }, { title: "Length (ft)", x: 470, anchor: "end" }, { title: "Seat start", x: 560, anchor: "end" }, { title: "Seat end", x: 650, anchor: "end" }],
      lay.spans.flatMap((sp) => sp.girders.map((g) => [String(sp.index + 1), `${sp.from} – ${sp.to}`, `G${g.k + 1}`, f2(g.L), f2(g.length), f2(g.start.seat), f2(g.end.seat)])),
      720,
      "GIRDER LAYOUT (seat: top of the bearing seat, El. ft)",
    ),
  });
  if (p.figures?.plan) {
    text("Plan", "subheading", { newPage: true, keepWithNext: true });
    lines.push({ region: p.figures.plan });
  }
  if (p.figures?.profile) {
    text("Profile", "subheading", { keepWithNext: true });
    lines.push({ region: p.figures.profile });
  }

  // --- summary of the design checks --------------------------------------------------------------------------------------
  text("Summary of design checks", "subheading", { newPage: true, keepWithNext: true });
  lines.push({
    region: textTable(
      [{ title: "Part", x: 4 }, { title: "Component", x: 110 }, { title: "Design", x: 300 }, { title: "Result", x: 560 }],
      [
        ...p.superstructure.map((x) => ["Superstructure", x.label, wrap(x.name, 44), verdictOf(x.checks.flatMap((g) => g.checks))]),
        ...p.supports.flatMap((s) => s.parts.map((x) => ["Substructure", wrap(x.label, 30), wrap(x.name, 44), verdictOf(x.checks.flatMap((g) => g.checks))])),
      ],
      720,
      "DESIGN CHECKS BY COMPONENT",
    ),
  });
  lines.push(...summaryOf("Summary of superstructure design checks", p.superstructure));
  lines.push(...summaryOf("Summary of substructure design checks", p.supports.flatMap((s) => s.parts)));

  // --- Part 1: superstructure ------------------------------------------------------------------------------------------
  text("PART 1: SUPERSTRUCTURE", "heading", { newPage: true });
  text("The deck, its overhang and the bridge rail, then the girders of each group of spans, each designed with the layout above; the reactions they hand to the supports close the part.");
  for (const x of p.superstructure) {
    text(`${x.label}: ${x.name}`, "subheading", { newPage: true, keepWithNext: true });
    lines.push(...x.lines);
  }
  text("Load path: the superstructure's reactions at the supports", "subheading", { newPage: true, keepWithNext: true });
  text("Per girder at each support, unfactored (kip): DC and DW from the girder lines, the live load from the design truck or tandem with the lane, with and without IM; the larger of the interior and exterior girders. At a continuous pier the girders and deck act simple, the later dead loads and the live load on the continuous beam (AASHTO 5.12.3.3).", "note", { keepWithNext: true });
  lines.push({
    region: textTable(
      [{ title: "Support", x: 4 }, { title: "DC", x: 210, anchor: "end" }, { title: "DW", x: 290, anchor: "end" }, { title: "LL", x: 370, anchor: "end" }, { title: "LL+IM", x: 450, anchor: "end" }, { title: "Service I (DC+DW+LL+IM)", x: 620, anchor: "end" }],
      run.reactions.map((r) => [r.name, f1(r.DC), f1(r.DW), f1(r.LL), f1(r.LLIM), f1(r.DC + r.DW + r.LLIM)]),
      720,
      "REACTIONS PER GIRDER",
    ),
  });

  // --- Part 2: substructure -------------------------------------------------------------------------------------------
  text("PART 2: SUBSTRUCTURE", "heading", { newPage: true });
  text("Support by support from the first abutment to the last: the loads each receives from the superstructure, then its bearings, its abutment (or its pier cap and column), its foundation, and at an abutment its approach slab and wingwall.");
  p.supports.forEach((s, k) => {
    const r = run.reactions[k];
    text(`${s.name} (${TYPE[s.type] ?? s.type})`, "heading", { newPage: true });
    text(`Loads from the superstructure:- per girder, DC ${f1(r.DC)} kip, DW ${f1(r.DW)} kip, LL+IM ${f1(r.LLIM)} kip (LL ${f1(r.LL)} kip without IM); ${b.nGirders} girders.`);
    if (!s.parts.length) text("No component designs are linked at this support.", "note");
    for (const x of s.parts) {
      text(`${x.label}: ${x.name}`, "subheading", { newPage: true, keepWithNext: true });
      lines.push(...x.lines);
    }
  });

  // --- Part 3: quantities ---------------------------------------------------------------------------------------------
  text("PART 3: QUANTITIES", "heading", { newPage: true });
  text("Summary of quantities:- each pay item's quantity in each part of the bridge and in all, as the parts' tabulations that follow give them: concrete to 0.1 CY, reinforcing steel to 10 LB, the rest whole.");
  const rows = soqRows(p.pay);
  const n = p.pay.length;
  const colW = Math.min(80, Math.floor(330 / Math.max(1, n + 1)));
  const x0 = 380;
  lines.push({
    region: textTable(
      [
        { title: "Item No.", x: 4 },
        { title: "Description", x: 76 },
        { title: "Unit", x: 316 },
        ...p.pay.map((c, k) => ({ title: wrap(c.label, 11).split("\n") as [string, string] | [string], x: x0 + (k + 1) * colW, anchor: "end" as const })),
        { title: "Total", x: x0 + (n + 1) * colW + 4, anchor: "end" as const },
      ].map((c) => ({ ...c, title: Array.isArray(c.title) && c.title.length === 1 ? c.title[0] : c.title })) as Parameters<typeof textTable>[0],
      rows.map((r) => [r.code, wrap(r.description, 38), r.unit, ...r.values.map((v) => qty(r.unit, v)), qty(r.unit, r.total)]),
      Math.max(720, x0 + (n + 1) * colW + 8),
      "SUMMARY OF QUANTITIES",
    ),
  });
  for (const t of p.tabulations) {
    text(`Tabulation: ${t.label}`, "subheading", { newPage: true, keepWithNext: true });
    lines.push(...t.lines);
  }
  return lines;
}
