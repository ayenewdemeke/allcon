import { describe, expect, it } from "vitest";
import benchmarks from "./pgsuper-benchmarks.json";
import fixture from "./pgsuper-principal.json";
import { designGirder, GIRDER_DEFAULTS, type GirderInputs } from "./prestressed";

// Principal tension in the web (5.9.2.3.3) against PGSuper 9.0.4: the harped WF74G benchmark girder
// with f′c raised to 10.5 ksi (the check applies above 10 ksi), at the tenth points, by the LRFD method.
// The shear stress differs by up to about 5% (PGSuper's Service III shear envelope and section
// properties), the axial stress by about 3%.

const within = (ours: number, theirs: number, rel: number, label: string, abs = 0.01) =>
  expect(Math.abs(ours - theirs), `${label}: ours ${ours.toFixed(4)}, PGSuper ${theirs.toFixed(4)}`).toBeLessThanOrEqual(rel * Math.abs(theirs) + abs);

const b = (benchmarks as unknown as { name: string; inputs: Partial<GirderInputs> & { timeline: { tRelease: number; tDeck: number; tFinal: number } } }[]).find((f) => f.name === fixture.name)!;
const { timeline, ...inputs } = b.inputs;
const d = designGirder({ ...GIRDER_DEFAULTS, losses: "refined", elasticGain: false, ...timeline, ...inputs, fc: fixture.fc } as GirderInputs);

describe.each(["interior", "exterior"] as const)("PGSuper principal tension, %s girder", (side) => {
  const g = d[side];
  for (const p of fixture[side]) {
    it(`x = ${p.x} ft: the largest principal tension in the web (8%, 0.01 ksi)`, () => {
      const s = g.stations.find((st) => Math.abs(st.x - p.x) < 1e-6)!;
      within(s.principal!.ft, p.ft, 0.08, `${side} x=${p.x}`);
    });
  }
  it("applies above 10 ksi only", () => {
    const low = designGirder({ ...GIRDER_DEFAULTS, losses: "refined", elasticGain: false, ...timeline, ...inputs } as GirderInputs);
    expect(low[side].checks.some((c) => c.id === "principal")).toBe(false);
    expect(g.checks.some((c) => c.id === "principal")).toBe(true);
  });
});
