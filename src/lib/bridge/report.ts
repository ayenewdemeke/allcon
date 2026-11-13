import type { Line } from "@/lib/calcs/library/templates";
import { textTable, type TableColumn } from "../design/svg-table";
import type { BridgeAnalysis, Selection } from "./bridge";
import type { BridgeDefinition } from "./definition";
import type { LiveLoad } from "./moving";

// The bridge's analysis written out as a Calcs worksheet: what was modeled and how, the load cases
// with their equilibrium, and the results (girder forces at the stations, bearing reactions, pier
// forces) as tables. A record of the analysis, to go with the designs' own calc packages.

const n = (v: number, d = 1) => (Math.abs(v) < 0.5 * 10 ** -d ? "0" : v.toFixed(d));
const cols = (titles: (string | [string, string])[], width = 640): TableColumn[] =>
  titles.map((title, k) => (k === 0 ? { title, x: 0 } : { title, x: 110 + ((width - 110) * k) / (titles.length - 1), anchor: "end" as const }));

const SERVICE: Selection = { kind: "combination", name: "Service I" };
const STRENGTH: Selection = { kind: "combination", name: "Strength I" };

export function bridgeCalcLines(d: BridgeDefinition, a: BridgeAnalysis, live: LiveLoad, title: string): Line[] {
  const g = a.generated;
  const p = g.properties;
  const lines: Line[] = [];
  const text = (t: string, style: "heading" | "subheading" | "note" | "normal" = "normal", keepWithNext = false) => lines.push({ text: t, style, keepWithNext });
  const table = (titles: (string | [string, string])[], rows: string[][], caption?: string) => lines.push({ region: textTable(cols(titles), rows, 640, caption) });
  const lanes = live.arrangements[0].length;

  text(`${title}: bridge analysis`, "heading");
  text("Not verified: check these results independently (another program, or by hand) before using them.", "note");
  text("Purpose:- The forces in the bridge's members under the permanent loads and HL-93 live load, for their design to AASHTO LRFD.", "normal");
  text("The bridge", "subheading", true);
  text(
    `${d.spans.length} span${d.spans.length === 1 ? "" : "s"} of ${d.spans.map((L) => `${+L.toFixed(2)} ft`).join(", ")}${d.skew ? `, the supports skewed ${d.skew}°` : ""}; ${d.nGirders} girders (${g.stage2.sections[0].name}) at ${d.spacing} ft with ${d.overhang} ft overhangs; ` +
      `a ${d.deck.thickness} in deck (${d.deck.sacrificial} in sacrificial) on ${d.deck.haunch} in haunches. Girder f'c ${d.girder.fc} ksi, deck f'c ${d.deck.fc} ksi.` +
      (d.spans.length > 1 ? ` The girders are ${d.continuity === "continuous" ? "made continuous over the piers for the loads after the deck" : "simple spans"}.` : "") +
      ` Bearings: ${d.supports.map((s, k) => `${k === 0 ? "abutment 1" : k === d.supports.length - 1 ? "abutment 2" : `pier ${k}`} ${s.bearing}`).join(", ")}.` +
      (d.spans.length > 1 && d.piers.model ? ` Piers: a ${d.piers.capWidth} × ${d.piers.capDepth} ft cap on ${d.piers.columns} columns of ${d.piers.columnDiameter} ft diameter, ${d.piers.columnHeight} ft high, at ${d.piers.columnSpacing} ft.` : ""),
  );
  text("The model", "subheading", true);
  text(
    `A grillage of beam elements (${g.stage2.nodes.length} nodes, ${g.stage2.elements.length} elements): each girder a line of elements with its composite section's properties, deck strips between the girders at every station, diaphragms, ` +
      "bearings as links to the abutments and the pier caps, the caps on their columns. Two stages: the girders alone on simple spans carry their own weight, the deck, the haunches and the diaphragms; the composite bridge carries the barriers, the wearing surface and live load. Linear elastic analysis by the direct stiffness method.",
  );
  table(
    ["Section", "A (in²)", "I (in⁴)", "yb (in)", "Effective width (in)"],
    [
      ["Girder", n(p.girder.A), n(p.girder.I, 0), n(p.girder.yb, 2), ""],
      ["Composite, interior", n(p.composite.interior.A), n(p.composite.interior.I, 0), n(p.composite.interior.yb, 2), n(p.composite.interior.beff)],
      ["Composite, exterior", n(p.composite.exterior.A), n(p.composite.exterior.I, 0), n(p.composite.exterior.yb, 2), n(p.composite.exterior.beff)],
    ],
    `Section properties (Ec ${n(p.Ec.girder, 0)} ksi girder, ${n(p.Ec.deck, 0)} ksi deck, n = ${p.n.toFixed(3)})`,
  );
  text("Loads", "subheading", true);
  table(
    ["Load case", "Type", "Acts on", "Applied (kip)", "Reactions (kip)"],
    a.checks.map((c, k) => [c.name, a.cases[k].type, a.cases[k].stage === 1 ? "Girders alone" : "Composite", n(c.applied, 2), n(c.reactions, 2)]),
    "Static load cases, with the reactions that balance each",
  );
  text(
    `Live load: HL-93 (AASHTO 3.6.1) in ${lanes} design lane${lanes === 1 ? "" : "s"} of 12 ft between the barriers, placed against either barrier and centered; the design truck (rear axles 14 to 30 ft apart) or tandem with ${Math.round(live.IM * 100)}% dynamic allowance, plus the 0.64 klf lane load on the lengths that add to each effect; ` +
      "90% of two trucks with the lane load for negative moment between points of contraflexure and for reactions at interior piers (3.6.1.3.1); multiple presence factors 1.2, 1.0, 0.85, 0.65 (3.6.1.1.2). Each result's worst loading is found on its influence lines, from a unit axle moved along each lane.",
    "note",
  );
  text("Combinations (Table 3.4.1-1): " + a.combinations.map((c) => `${c.name} = ${c.description}`).join("; ") + ".", "note");

  // Girders: an exterior and an interior one in each span.
  const nG = d.nGirders;
  const picks = [...new Set([1, Math.ceil(nG / 2)])];
  for (let sp = 1; sp <= d.spans.length; sp++)
    for (const gk of picks) {
      const m = g.members.find((x) => x.kind === "girder" && x.girder === gk && x.span === sp)!;
      const perm = (name: string) => a.member(m, { kind: "case", name }, 1);
      const cases = a.cases.filter((c) => c.name !== "Substructure").map((c) => perm(c.name));
      const dc = (k: number, key: "My" | "Vz") => cases.reduce((s, st, ci) => s + (a.cases.filter((c) => c.name !== "Substructure")[ci].type === "DC" ? st[k].forces[key] : 0), 0);
      const dw = (k: number, key: "My" | "Vz") => cases.reduce((s, st, ci) => s + (a.cases.filter((c) => c.name !== "Substructure")[ci].type === "DW" ? st[k].forces[key] : 0), 0);
      const ll = a.member(m, { kind: "live" }, 1, live);
      const su = a.member(m, STRENGTH, 1, live);
      const keep = ll.map((_, k) => k).filter((k) => k === 0 || k === ll.length - 1 || k % 2 === 1);
      text(`${m.name}${gk === 1 ? " (exterior)" : " (interior)"}`, "subheading", true);
      table(
        ["x (ft)", ["DC", "M"], ["DW", "M"], ["LL+IM", "M max"], ["LL+IM", "M min"], ["Strength I", "M max"], ["Strength I", "M min"]],
        keep.map((k) => [n(ll[k].x, 1), n(dc(k, "My")), n(dw(k, "My")), n(ll[k].max!.My), n(ll[k].min!.My), n(su[k].max!.My), n(su[k].min!.My)]),
        "Moments (kip·ft), sagging +",
      );
      table(
        ["x (ft)", ["DC", "V"], ["DW", "V"], ["LL+IM", "V max"], ["LL+IM", "V min"], ["Strength I", "V max"], ["Strength I", "V min"]],
        keep.map((k) => [n(ll[k].x, 1), n(dc(k, "Vz")), n(dw(k, "Vz")), n(ll[k].max!.Vz), n(ll[k].min!.Vz), n(su[k].max!.Vz), n(su[k].min!.Vz)]),
        "Shears (kip)",
      );
    }

  text("Bearing reactions", "subheading", true);
  const bearings = a.bearings(SERVICE, live);
  table(
    ["Support", "Girder", "Permanent (kip)", "With LL+IM, max (kip)", "With LL+IM, min (kip)"],
    bearings.map((b) => [b.support === 1 ? "Abutment 1" : b.support === d.supports.length ? "Abutment 2" : `Pier ${b.support - 1}`, `G${b.girder}`, n(b.vertical), n(b.max ?? b.vertical), n(b.min ?? b.vertical)]),
    "Service I, vertical",
  );

  const columns = g.members.filter((m) => m.kind === "column");
  if (columns.length) {
    text("Pier columns", "subheading", true);
    table(
      ["Column", ["Axial", "max comp. (kip)"], ["Moment along", "bridge (kip·ft)"], ["Moment across", "bridge (kip·ft)"], ["Shear along", "(kip)"], ["Shear across", "(kip)"]],
      columns.map((m) => {
        const st = a.member(m, STRENGTH, 1, live);
        const big = (key: "My" | "Mz" | "Vy" | "Vz") => Math.max(...st.flatMap((s) => [Math.abs(s.max![key]), Math.abs(s.min![key])]));
        return [m.name, n(-Math.min(...st.map((s) => s.min!.N))), n(big("My")), n(big("Mz")), n(big("Vz")), n(big("Vy"))];
      }),
      "Strength I, the largest of each along the column (an envelope: each is its own loading)",
    );
  }
  return lines;
}
