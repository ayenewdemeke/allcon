import type { BridgeAnalysis, Selection } from "./bridge";
import type { BridgeDefinition } from "./definition";
import type { LiveLoad } from "./moving";

// From the bridge model to the design tools: which parts of a bridge have a design tool, and the
// inputs each design starts with, taken from the model's geometry and its analysis (reactions,
// envelopes with their concurrent forces). The design tools' engines and checks are unchanged:
// a design started here is an ordinary design, with these values filled in.

export type DesignTarget = { key: string; label: string; tool: string; kind: string; from: string };

const lineName = (d: BridgeDefinition, k: number) => (k === 0 ? "Abutment 1" : k === d.supports.length - 1 ? "Abutment 2" : `Pier ${k}`);

export function designTargets(d: BridgeDefinition): DesignTarget[] {
  const out: DesignTarget[] = [
    { key: "girders", label: "Girders", tool: "LRFD Bridge Design Check", kind: "lrfd-girder-check", from: "Spans, girders, deck and loads" },
    { key: "deck", label: "Deck", tool: "Deck Slab", kind: "deck-slab", from: "Girder spacing, overhang, deck, barrier" },
  ];
  out.push({ key: "description", label: "Whole bridge: load path and foundations", tool: "Bridge Description and Load Path", kind: "bridge", from: "Spans, skew, supports, girders, deck and piers; it then creates and updates the abutments, pier caps, columns, foundations and approach slabs, with one calc package and an IFC model with bars" });
  d.supports.forEach((_, k) => out.push({ key: `bearing-${k}`, label: `${lineName(d, k)} bearings`, tool: "Elastomeric Bearing", kind: "elastomeric-bearing", from: "The largest bearing reaction on the line, dead and live; the expansion length" }));
  if (d.piers.model) for (let k = 1; k < d.supports.length - 1; k++) out.push({ key: `column-${k}`, label: `Pier ${k} columns`, tool: "Pier Column", kind: "pier-column", from: "Strength I forces at the top of the hardest-worked column, with their concurrent forces" });
  d.supports.forEach((s, k) => {
    if ((k === 0 || k === d.supports.length - 1) && s.bearing === "expansion") out.push({ key: `joint-${k}`, label: `${lineName(d, k)} joint`, tool: "Strip Seal Expansion Joint", kind: "strip-seal-joint", from: "The expansion length to the fixed bearings; the skew" });
  });
  return out;
}

/** The distance along the bridge from a support line to the nearest fixed line (the length that expands toward it). */
function expansionLength(d: BridgeDefinition, line: number): number {
  const x: number[] = [0];
  d.spans.forEach((L) => x.push(x[x.length - 1] + L));
  const fixed = d.supports.flatMap((s, k) => (s.bearing === "fixed" ? [x[k]] : []));
  return fixed.length ? Math.min(...fixed.map((f) => Math.abs(x[line] - f))) : x[x.length - 1];
}

const SERVICE: Selection = { kind: "combination", name: "Service I" };
const STRENGTH: Selection = { kind: "combination", name: "Strength I" };

/** The inputs a design for a target starts with (merged over the tool's defaults), and its name. */
export function designPrefill(target: DesignTarget, d: BridgeDefinition, a: BridgeAnalysis, live: LiveLoad): { inputs: Record<string, unknown>; name: string } {
  const name = target.label;
  if (target.kind === "lrfd-girder-check")
    return {
      name,
      inputs: {
        shape: d.girder.shape,
        ...(d.girder.custom ? { custom: d.girder.custom } : {}),
        L: d.spans[0],
        extraSpans: d.spans.slice(1).map((L) => ({ L, strands: null, harped: null })),
        nGirders: d.nGirders,
        S: d.spacing,
        overhang: d.overhang,
        barrierWidth: d.loads.barrierWidth,
        skew: d.skew,
        deckT: d.deck.thickness,
        sacrificial: d.deck.sacrificial,
        haunch: d.deck.haunch,
        fcDeck: d.deck.fc,
        wcDeck: d.deck.wc,
        fc: d.girder.fc,
        wc: d.girder.wc,
        diaphragms: d.diaphragms.perSpan,
        diaphragmWeight: d.diaphragms.weight,
        barrierWeight: d.loads.barrierWeight,
        fws: d.loads.wearingSurface,
      },
    };
  if (target.kind === "bridge") {
    // The description record (stations from 10+00): the supports by their bearings and continuity, the piers as modeled.
    const stations: number[] = [1000];
    d.spans.forEach((L) => stations.push(stations[stations.length - 1] + L));
    const half = ((d.nGirders - 1) * d.spacing) / 2 + d.overhang;
    const last = d.supports.length - 1;
    return {
      name: "Description and load path",
      inputs: {
        alignment: { refStation: 1000, northing: 10000, easting: 10000, azimuth: 90, curves: [] },
        profile: { station: 1000, elevation: 5280, grade: 0, curves: [] },
        supports: d.supports.map((s, k) =>
          k === 0 || k === last
            ? { name: `Abutment ${k + 1}`, station: stations[k], skew: d.skew, type: s.bearing === "fixed" ? "integral-abutment" : "seat-abutment", endDistance: 1, bearingOffset: 1, bearingHeight: Math.max(d.piers.bearingHeight, 1) }
            : {
                name: `Pier ${k + 1}`,
                station: stations[k],
                skew: d.skew,
                type: d.continuity === "continuous" ? "continuous-pier" : "simple-pier",
                endDistance: 0.75,
                bearingOffset: 1,
                bearingHeight: Math.max(d.piers.bearingHeight, 1),
                pier: { kind: "multicolumn", capLength: (d.nGirders - 1) * d.spacing + 3, capDepth: d.piers.capDepth, capWidth: d.piers.capWidth * 12, columns: d.piers.columns, columnSpacing: d.piers.columnSpacing, columnShape: "round", columnSize: d.piers.columnDiameter * 12, columnDepth: d.piers.columnDiameter * 12, foundationTop: 0, foundation: "drilled-shaft" },
              },
        ),
        ...(d.girder.custom ? {} : { shape: d.girder.shape }),
        nGirders: d.nGirders,
        spacing: d.spacing,
        leftEdge: half,
        rightEdge: half,
        barrierWidth: d.loads.barrierWidth,
        deckT: d.deck.thickness,
        sacrificial: d.deck.sacrificial,
        slabOffset: d.deck.thickness + d.deck.haunch,
        fcDeck: d.deck.fc,
        fws: d.loads.wearingSurface,
      },
    };
  }
  if (target.kind === "deck-slab")
    return { name, inputs: { nGirders: d.nGirders, S: d.spacing, overhang: d.overhang, t: d.deck.thickness - d.deck.sacrificial, fc: d.deck.fc, barrierWidth: d.loads.barrierWidth * 12, barrierWeight: d.loads.barrierWeight } };
  const line = Number(target.key.split("-")[1]);
  if (target.kind === "elastomeric-bearing") {
    // The bearing with the largest total reaction on the line: its permanent load, and its live load.
    const rows = a.bearings(SERVICE, live).filter((b) => b.support === line + 1);
    const worst = rows.reduce((p, b) => ((b.max ?? b.vertical) > (p.max ?? p.vertical) ? b : p));
    return { name, inputs: { DL: +worst.vertical.toFixed(1), LL: +((worst.max ?? worst.vertical) - worst.vertical).toFixed(1), expansionLength: expansionLength(d, line), jointed: line === 0 || line === d.supports.length - 1 } };
  }
  if (target.kind === "pier-column") {
    // Each column's top (its element runs from the base up): Strength I, the permanent loads plus
    // 1.75 times the live loading that gives the most compression, and the ones for each moment.
    const columns = a.generated.members.filter((m) => m.kind === "column" && m.support === line + 1);
    const cases: { name: string; P: number; MT: number; ML: number; HT: number; HL: number; score: number }[][] = columns.map((m) => {
      const id = m.elements[m.elements.length - 1];
      const st = a.member(m, STRENGTH, 1);
      const perm = st[st.length - 1].forces;
      const gamma = a.liveFactor(STRENGTH);
      const of = (label: string, c: { N: number; Vy: number; Vz: number; My: number; Mz: number } | undefined) => {
        const f = c ?? { N: 0, Vy: 0, Vz: 0, My: 0, Mz: 0 };
        const P = -(perm.N + gamma * f.N); // compression +
        return { name: label, P: +P.toFixed(1), MT: +(perm.Mz + gamma * f.Mz).toFixed(1), ML: +(perm.My + gamma * f.My).toFixed(1), HT: +(perm.Vy + gamma * f.Vy).toFixed(1), HL: +(perm.Vz + gamma * f.Vz).toFixed(1), score: P };
      };
      return [
        of("Strength I, most axial load", live.at(id, 1, "N")?.min.concurrent),
        of("Strength I, least axial load", live.at(id, 1, "N")?.max.concurrent),
        of("Strength I, most moment along the bridge", ((e) => (e ? (Math.abs(e.max.value) > Math.abs(e.min.value) ? e.max.concurrent : e.min.concurrent) : undefined))(live.at(id, 1, "My"))),
        of("Strength I, most moment across the bridge", ((e) => (e ? (Math.abs(e.max.value) > Math.abs(e.min.value) ? e.max.concurrent : e.min.concurrent) : undefined))(live.at(id, 1, "Mz"))),
      ];
    });
    const worst = cases.reduce((p, c) => (c[0].score > p[0].score ? c : p));
    return {
      name,
      inputs: {
        shape: "round",
        T: d.piers.columnDiameter * 12,
        W: d.piers.columnDiameter * 12,
        height: d.piers.columnHeight,
        capDepth: d.piers.capDepth,
        fc: d.piers.fc,
        loads: "entered",
        cases: worst.map(({ score, ...c }) => (void score, c)),
        longitudinal: { bearings: d.supports[line].bearing },
      },
    };
  }
  return { name, inputs: { L: expansionLength(d, line), skew: Math.abs(d.skew) } };
}
