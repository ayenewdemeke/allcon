import { describe, expect, it } from "vitest";
import benchmarks from "./pgsuper-benchmarks.json";
import handling from "./pgsuper-handling.json";
import { designGirder, GIRDER_DEFAULTS, HANDLING_DEFAULTS, HAUL_TRUCKS, splittingAs, type GirderInputs } from "./prestressed";

// Lifting, hauling, splitting and confinement against PGSuper 9.0.4 (WSDOT's BridgeLink), on the
// single-span benchmark girders (pgsuper-benchmarks.json). PGSuper writes these for the exterior
// girder in test mode, with WSDOT's criteria: lifting devices 1.75 ft from the ends (the template's),
// truck supports 5 ft from the ends, the HT40-72 truck, losses to hauling at 10 days (WSDOT's
// library), impact 20% on the normal crown only.
//
// Where the two differ by method: PGSuper adds the strands' relaxation before transfer (about 2 ksi,
// not in the 9th edition's refined method), so the tool's prestress at handling is about 1% higher
// and its stresses up to about 2% more compressive.

type Fixture = (typeof handling)[number];
const within = (ours: number, theirs: number, rel: number, label: string, abs = 0.01) =>
  expect(Math.abs(ours - theirs), `${label}: ours ${ours.toFixed(4)}, PGSuper ${theirs.toFixed(4)}`).toBeLessThanOrEqual(rel * Math.abs(theirs) + abs);

describe.each(handling as Fixture[])("PGSuper handling benchmark $name", (h) => {
  const b = (benchmarks as unknown as { name: string; inputs: Partial<GirderInputs> & { timeline: { tRelease: number; tDeck: number; tFinal: number } } }[]).find((f) => f.name === h.name)!;
  const { timeline, ...inputs } = b.inputs;
  const i = { ...GIRDER_DEFAULTS, losses: "refined", elasticGain: false, ...timeline, ...inputs, handling: { ...HANDLING_DEFAULTS, liftPoint: 1.75, bunkPoint: 5, haulAge: 10, truck: HAUL_TRUCKS.find((t) => t.name === "HT40-72")!.truck } } as GirderInputs;
  const g = designGirder(i).exterior;
  const hd = g.handling!;

  it("lifting: factors of safety (1–2%) and stresses (2%)", () => {
    const L = hd.lifting.summary;
    const p = h.lifting;
    within(L.FScr, p.FScr, 0.02, "FScr");
    within(L.adjFSf, p.adjFSf, 0.01, "FSf");
    within(L.minDirect, p.minDirect, 0.02, "plumb compression");
    within(L.minStress, p.minStress, 0.02, "tilted compression");
    within(L.maxStress, p.maxStress, 0.02, "tilted tension");
  });
  for (const slope of ["crown", "superelevation"] as const) {
    it(`hauling on the ${slope}: factors of safety (1–2%) and stresses (2%)`, () => {
      const s = hd.hauling[slope].summary;
      const p = h.hauling[slope];
      within(s.FScr, p.FScr, 0.02, "FScr");
      within(s.FSf, p.FSf, 0.01, "FSf");
      within(s.FSr, p.FSr, 0.01, "FSr");
      within(s.minDirect, p.minDirect, 0.02, "plumb compression");
      within(s.minStress, p.minStress, 0.02, "tilted compression");
      within(s.maxStress, p.maxStress, 0.02, "tilted tension");
    });
  }
  it("splitting: 4% of the bonded strands' force after transfer (1.5%), over h/4", () => {
    within(g.splitting.demand, h.splitting.force, 0.015, "splitting force");
    within(g.splitting.zone, h.splitting.zone, 0, "h/4", 0.01);
  });
  it("confinement: required over 1.5d from the end", () => {
    const req = g.checks.find((c) => c.id === "conf-length")!;
    within(req.demand * 12, h.confinement.required, 0, "1.5d", 0.01);
  });
});

it("splitting resistance from PGSuper's own stirrup zones (from the girder's end): 20 ksi × As within h/4", () => {
  // The WF74G template: one #5 pair at the end (1.5 in), then #5 pairs at 3.5 in for 21 in, then at 6 in.
  const zones = [
    { length: 1.5, bar: 5, legs: 2, spacing: 1.5 },
    { length: 21, bar: 5, legs: 2, spacing: 3.5 },
    { length: 144, bar: 5, legs: 2, spacing: 6 },
  ];
  const As = splittingAs(zones, 74 / 4);
  within(20 * As, (handling as Fixture[])[0].splitting.resistance, 0.001, "Pr", 0.01);
});
