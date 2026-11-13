import { describe, expect, it } from "vitest";
import benchmarks from "../design/girders/pgsuper-benchmarks.json";
import { analyzeBridge } from "./bridge";
import { BRIDGE_DEFAULTS, bridgeDefinition, supportsFor, type BridgeDefinition } from "./definition";
import type { Member } from "./generate";

// The bridge model against PGSuper's line-girder results (the fixtures the girder design check is
// held to), hand solutions, and statics.

const within = (ours: number, theirs: number, rel: number, label: string) => expect(Math.abs(ours - theirs), `${label}: ours ${ours.toFixed(3)}, reference ${theirs.toFixed(3)}`).toBeLessThanOrEqual(rel * Math.abs(theirs) + 1e-6);
const at = (stations: { x: number }[], x: number) => stations.reduce((best, s) => (Math.abs(s.x - x) < Math.abs(best.x - x) ? s : best)) as { x: number; forces: { My: number; Vz: number }; dz: number };
const girder = (members: Member[], g: number, span = 1) => members.find((m) => m.kind === "girder" && m.girder === g && m.span === span)!;

type Row = { x: number; Mg: number; Mdeck: number; Mdc2: number; Mdw: number };
type Bench = { name: string; inputs: { custom: { profile: [number, number][]; web: number; topWidth: number }; L: number; nGirders: number; S: number; overhang: number; barrierWidth: number; deckT: number; sacrificial: number; haunch: number; fcDeck: number; wcDeck: number; fc: number; wc: number; diaphragms: number; diaphragmWeight: number; barrierWeight: number; fws: number }; interior: Row[]; exterior: Row[] };

const fromBench = (b: Bench): BridgeDefinition => {
  const i = b.inputs;
  return bridgeDefinition({
    ...BRIDGE_DEFAULTS,
    spans: [i.L],
    girder: { shape: "custom", custom: i.custom, fc: i.fc, wc: i.wc },
    nGirders: i.nGirders,
    spacing: i.S,
    overhang: i.overhang,
    deck: { thickness: i.deckT, sacrificial: i.sacrificial, haunch: i.haunch, fc: i.fcDeck, wc: i.wcDeck },
    diaphragms: { perSpan: i.diaphragms, weight: i.diaphragmWeight, thickness: 0.75, atSupports: true },
    loads: { barrierWeight: i.barrierWeight, barrierWidth: i.barrierWidth, wearingSurface: i.fws },
  });
};

describe.each((benchmarks as unknown as Bench[]).slice(0, 2))("PGSuper line girder: $name", (b) => {
  const a = analyzeBridge(fromBench(b));
  const m = a.generated.members;
  const n = b.inputs.nGirders;
  it("every load case is in equilibrium", () => {
    expect(a.checks.map((c) => [c.name, c.ok])).toEqual(a.checks.map((c) => [c.name, true]));
  });
  it("the girders alone: self-weight, and the deck with the haunch and diaphragms, match at the tenth points (0.5%)", () => {
    for (const [side, g] of [["interior", 3], ["exterior", 1]] as const)
      for (const row of b[side]) {
        within(at(a.member(girder(m, g), { kind: "case", name: "Girders" }), row.x).forces.My, row.Mg, 0.005, `${side} girder x=${row.x}`);
        const deck = at(a.member(girder(m, g), { kind: "case", name: "Deck and haunch" }), row.x).forces.My + at(a.member(girder(m, g), { kind: "case", name: "Diaphragms" }), row.x).forces.My;
        within(deck, row.Mdeck, 0.005, `${side} deck x=${row.x}`);
      }
  });
  it("barriers and wearing surface: PGSuper shares them equally, the grillage by stiffness; the girders' total is the same (0.5%)", () => {
    for (const row of b.interior) {
      const total = (name: string) => Array.from({ length: n }, (_, k) => at(a.member(girder(m, k + 1), { kind: "case", name }), row.x).forces.My).reduce((s, v) => s + v, 0);
      within(total("Barriers"), n * row.Mdc2, 0.005, `barriers x=${row.x}`);
      within(total("Wearing surface"), n * row.Mdw, 0.005, `wearing surface x=${row.x}`);
    }
    // The grillage puts more of the barriers on the exterior girders than an equal share.
    const mid = b.inputs.L / 2;
    const ext = at(a.member(girder(m, 1), { kind: "case", name: "Barriers" }), mid).forces.My;
    const int = at(a.member(girder(m, Math.ceil(n / 2)), { kind: "case", name: "Barriers" }), mid).forces.My;
    expect(ext).toBeGreaterThan(int);
    expect(int).toBeGreaterThan(0);
  });
  it("Strength I adds the cases with their factors", () => {
    const g = girder(m, 3);
    const x = b.inputs.L / 2;
    const c = (name: string) => at(a.member(g, { kind: "case", name }), x).forces.My;
    within(at(a.member(g, { kind: "combination", name: "Strength I" }), x).forces.My, 1.25 * (c("Girders") + c("Deck and haunch") + c("Diaphragms") + c("Barriers")) + 1.5 * c("Wearing surface"), 1e-9, "Strength I");
  });
});

describe("the bridge model", () => {
  const two: BridgeDefinition = bridgeDefinition({ ...BRIDGE_DEFAULTS, spans: [100, 100], supports: supportsFor(2), diaphragms: { ...BRIDGE_DEFAULTS.diaphragms, perSpan: 1 } });

  it("the default bridge: a girder's deflection under its own weight is the beam formula's, with a little shear deformation", () => {
    const a = analyzeBridge(BRIDGE_DEFAULTS);
    const p = a.generated.properties;
    const mid = at(a.member(girder(a.generated.members, 2), { kind: "case", name: "Girders" }), 60);
    const bending = (5 * p.girder.weight * 120 ** 4 * 1728) / (384 * p.Ec.girder * p.girder.I); // in
    expect(-mid.dz * 12).toBeGreaterThan(bending);
    expect(-mid.dz * 12).toBeLessThan(bending * 1.03);
  });

  it("two spans made continuous: simple for the deck, continuous for the barriers, on a pier of cap and columns", () => {
    const a = analyzeBridge(two);
    expect(a.ok).toBe(true);
    const m = a.generated.members;
    const n = two.nGirders;
    // Stage 1: no moment over the pier; the simple-span moment at midspan.
    const g1 = a.member(girder(m, 3), { kind: "case", name: "Girders" });
    within(g1[g1.length - 1].forces.My, 0, 1, "stage 1 pier moment");
    within(at(g1, 50).forces.My, (a.generated.properties.girder.weight * 100 ** 2) / 8, 1e-6, "stage 1 midspan");
    // Stage 2: the girders' total over the pier is near −wL²/8 of the whole load (a little less: the pier's bearings and cap give).
    const total = (name: string, span: number, x: number) => Array.from({ length: n }, (_, k) => at(a.member(girder(m, k + 1, span), { kind: "case", name }), x).forces.My).reduce((s, v) => s + v, 0);
    const w = 2 * two.loads.barrierWeight;
    const pier = total("Barriers", 1, 100);
    expect(pier).toBeLessThan(-0.9 * ((w * 100 ** 2) / 8));
    expect(pier).toBeGreaterThan(-1.02 * ((w * 100 ** 2) / 8));
    within(total("Barriers", 2, 0), pier, 1e-6, "the moment is the same either side of the pier");
    // Statics in each span: the simple-span moment hangs from the line between the end moments.
    within(total("Barriers", 1, 50) - pier / 2, (w * 100 ** 2) / 8, 1e-6, "span 1 statics");
    // The pier: the columns' bases carry what the bearings put on the cap, plus the pier's own weight.
    const line = a.bearings({ kind: "combination", name: "Service I" }).filter((x) => x.support === 2);
    const onCap = line.reduce((s, x) => s + x.vertical, 0);
    const piers = two.piers;
    const own = (piers.capWidth * piers.capDepth * ((n - 1) * two.spacing) + piers.columns * ((Math.PI * piers.columnDiameter ** 2) / 4) * (piers.columnHeight + piers.capDepth / 2)) * 0.15;
    const bases = a.reactions({ kind: "combination", name: "Service I" }).filter((r) => r.node >= 400000).reduce((s, r) => s + r.R[2], 0);
    within(bases, onCap + own, 1e-6, "pier reactions");
    expect(line.every((x) => x.vertical > 0)).toBe(true);
    // A cap between columns sags under the girders: moment along it, shear at the columns.
    const cap = a.member(m.find((x) => x.kind === "cap")!, { kind: "combination", name: "Service I" });
    expect(Math.max(...cap.map((s) => Math.abs(s.forces.My)))).toBeGreaterThan(50);
  });

  it("simple spans stay simple under every load", () => {
    const a = analyzeBridge({ ...two, continuity: "simple" });
    const g = a.member(girder(a.generated.members, 1), { kind: "case", name: "Barriers" });
    within(g[g.length - 1].forces.My, 0, 1, "pier moment");
    expect(a.ok).toBe(true);
  });

  it("a skewed bridge of three spans without modeled piers is stable and in equilibrium", () => {
    const a = analyzeBridge(bridgeDefinition({ ...BRIDGE_DEFAULTS, spans: [80, 110, 80], skew: 25, supports: supportsFor(3), piers: { ...BRIDGE_DEFAULTS.piers, model: false } }));
    expect(a.ok).toBe(true);
    const total = a.reactions({ kind: "combination", name: "Service I" }).reduce((s, r) => s + r.R[2], 0);
    const applied = a.checks.reduce((s, c) => s + c.applied, 0);
    within(total, applied, 1e-8, "all the load reaches the supports");
  });

  it("keeps a saved definition within what the generator takes", () => {
    const d = bridgeDefinition({ spans: [50, "x", 9000], nGirders: 99, girder: { shape: "nope" }, supports: [] });
    expect(d.spans).toEqual([50, 100, 500]);
    expect(d.nGirders).toBe(20);
    expect(d.girder.shape).toBe("bt-72");
    expect(d.supports.map((s) => s.bearing)).toEqual(["expansion", "fixed", "expansion", "expansion"]);
  });
});
