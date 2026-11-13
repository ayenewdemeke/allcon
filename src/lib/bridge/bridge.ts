import type { BridgeDefinition } from "./definition";
import { generate, type Generated, type Member } from "./generate";
import type { Dof6, LoadType } from "./model";
import { analyze, type Analysis, type SectionForces } from "./solver";

// A bridge analyzed: its two stages solved, their load cases side by side, the AASHTO LRFD load
// combinations of them (Table 3.4.1-1), and each member's forces and deflections along its length.
// Live load comes with the moving load analysis; until then the combinations carry the permanent
// loads only, and say so.

export type CaseRef = { name: string; type: LoadType; stage: 1 | 2; description?: string; index: number };
export type Combination = { name: string; description: string; factors: Record<LoadType, number> };

/** Permanent loads at their maximum factors (Table 3.4.1-2). */
export const COMBINATIONS: Combination[] = [
  { name: "Service I", description: "1.0 DC + 1.0 DW", factors: { DC: 1, DW: 1, LL: 1, TU: 1, WS: 1, USER: 1 } },
  { name: "Strength I", description: "1.25 DC + 1.5 DW", factors: { DC: 1.25, DW: 1.5, LL: 1.75, TU: 0.5, WS: 0, USER: 1 } },
  { name: "Strength IV", description: "1.5 DC + 1.5 DW", factors: { DC: 1.5, DW: 1.5, LL: 0, TU: 0.5, WS: 0, USER: 1 } },
];

/** What to show results for: one load case, or a combination. */
export type Selection = { kind: "case"; name: string } | { kind: "combination"; name: string };

export type MemberStation = { x: number; forces: SectionForces; dz: number }; // x along the member, ft; dz the deflection (down −), ft
export type Check = { name: string; applied: number; reactions: number; ok: boolean }; // vertical equilibrium, kip

export type BridgeAnalysis = {
  generated: Generated;
  cases: CaseRef[];
  combinations: Combination[];
  checks: Check[];
  ok: boolean;
  /** A member's stations (each element's ends, and points between for the diagram's curve). */
  member: (member: Member, selection: Selection, perElement?: number) => MemberStation[];
  /** Reactions at the supports, by support line: vertical force and the moments, global. */
  reactions: (selection: Selection) => { node: number; R: Dof6<number> }[];
  /** Each bearing's forces: vertical (compression +), across and along the bridge. */
  bearings: (selection: Selection) => { support: number; girder: number; vertical: number; transverse: number; longitudinal: number }[];
  /** Node displacements (global), for the deflected shape. */
  displacements: (selection: Selection) => Map<number, Dof6<number>>;
  stage: (stage: 1 | 2) => Analysis;
};

export function analyzeBridge(definition: BridgeDefinition): BridgeAnalysis {
  const generated = generate(definition);
  const a1 = analyze(generated.stage1);
  const a2 = analyze(generated.stage2);
  const stageOf = (s: 1 | 2) => (s === 1 ? a1 : a2);
  const cases: CaseRef[] = [
    ...generated.stage1.loadCases.map((c, index) => ({ ...c, stage: 1 as const, index })),
    ...generated.stage2.loadCases.map((c, index) => ({ ...c, stage: 2 as const, index })),
  ];
  /** A selection as load cases with their factors. */
  const terms = (sel: Selection): { ref: CaseRef; factor: number }[] => {
    if (sel.kind === "case") return cases.filter((c) => c.name === sel.name).map((ref) => ({ ref, factor: 1 }));
    const combo = COMBINATIONS.find((c) => c.name === sel.name);
    return combo ? cases.map((ref) => ({ ref, factor: combo.factors[ref.type] })).filter((t) => t.factor !== 0) : [];
  };
  const index = { 1: new Map(generated.stage1.elements.map((e, i) => [e.id, i])), 2: new Map(generated.stage2.elements.map((e, i) => [e.id, i])) };
  const nodeIndex = new Map(generated.stage1.nodes.map((n, i) => [n.id, i])); // the same nodes in both stages
  const elementNodes = new Map(generated.stage2.elements.map((e) => [e.id, [e.n1, e.n2] as const]));

  const member = (m: Member, sel: Selection, perElement = 4): MemberStation[] => {
    const ts = terms(sel);
    const out: MemberStation[] = [];
    let x0 = 0;
    for (const id of m.elements) {
      const k2 = index[2].get(id)!;
      const L = a2.lengthOf(k2);
      const [n1, n2] = elementNodes.get(id)!;
      for (let p = 0; p <= perElement; p++) {
        const t = p / perElement;
        const forces: SectionForces = { N: 0, Vy: 0, Vz: 0, T: 0, My: 0, Mz: 0 };
        let dz = 0;
        for (const { ref, factor } of ts) {
          const a = stageOf(ref.stage);
          const k = index[ref.stage].get(id);
          if (k === undefined) continue;
          const f = a.forcesAt(ref.index, k, t);
          (Object.keys(forces) as (keyof SectionForces)[]).forEach((key) => (forces[key] += factor * f[key]));
          const u = a.cases[ref.index].displacements;
          dz += factor * ((1 - t) * u[nodeIndex.get(n1)!][2] + t * u[nodeIndex.get(n2)!][2]);
        }
        out.push({ x: x0 + t * L, forces, dz });
      }
      x0 += L;
    }
    return out;
  };

  const sumDof = (sel: Selection, pick: (a: Analysis, c: number) => { node: number; R: Dof6<number> }[]) => {
    const total = new Map<number, Dof6<number>>();
    for (const { ref, factor } of terms(sel))
      for (const r of pick(stageOf(ref.stage), ref.index)) {
        const cur = total.get(r.node) ?? ([0, 0, 0, 0, 0, 0] as Dof6<number>);
        r.R.forEach((v, d) => (cur[d] += factor * v));
        total.set(r.node, cur);
      }
    return total;
  };
  const reactions = (sel: Selection) => [...sumDof(sel, (a, c) => a.cases[c].reactions)].map(([node, R]) => ({ node, R }));
  const displacements = (sel: Selection) => sumDof(sel, (a, c) => a.cases[c].displacements.map((R, i) => ({ node: a.model.nodes[i].id, R })));
  const linkIndex = new Map(generated.stage1.links.map((l, i) => [l.id, i]));
  const bearings = (sel: Selection) =>
    generated.bearings.map((b) => {
      const f = [0, 0, 0];
      for (const { ref, factor } of terms(sel)) {
        const lf = stageOf(ref.stage).cases[ref.index].linkForces[linkIndex.get(b.link)!];
        for (let d = 0; d < 3; d++) f[d] += factor * lf[d];
      }
      return { support: b.support, girder: b.girder, vertical: -f[0], transverse: f[1], longitudinal: f[2] };
    });

  const checks: Check[] = cases.map((c) => {
    const e = stageOf(c.stage).cases[c.index].equilibrium;
    const scale = Math.max(1, Math.abs(e.applied[2]));
    return { name: c.name, applied: -e.applied[2], reactions: e.reactions[2], ok: Math.abs(e.applied[2] + e.reactions[2]) < 1e-6 * scale && e.residual < 1e-5 * scale };
  });
  return { generated, cases, combinations: COMBINATIONS, checks, ok: checks.every((c) => c.ok), member, reactions, bearings, displacements, stage: stageOf };
}
