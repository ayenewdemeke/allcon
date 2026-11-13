import { describe, expect, it } from "vitest";
import benchmarks from "./pgsuper-typeiv.json";
import handling from "./pgsuper-typeiv-handling.json";
import { designGirder, GIRDER_DEFAULTS, HANDLING_DEFAULTS, HAUL_TRUCKS, type GirderInputs } from "./prestressed";

// The AASHTO Type IV against PGSuper 9.0.4: the tool's library outline ("aashto-iv") checked against
// PGSuper's Type IV (TxDOT's library dimensions; PGSuper adds ¾ in chamfers at the bottom flange's
// corners) in WSDOT's WF58G benchmark setup (plain AASHTO criteria, as pgsuper-benchmark.test.ts):
// a 90 ft span with 28 straight strands, and with 20 straight and 6 harped. The same checks and
// tolerances as the WF benchmarks, plus lifting and hauling (pgsuper-handling.test.ts's setup).

type Row = { x: number; Mg: number; Mdeck: number; Mdc2: number; Mdw: number; Mll: number; Mu: number; Vu: number; Mn: number; dv: number; Vc: number; Vs: number; Vn: number; beta: number; theta: number; dES: number; fpe: number; lossFinal: number; Vp: number; psRelTop: number; psRelBot: number };
type Bench = { name: string; source: string; inputs: Partial<GirderInputs> & { timeline: { tRelease: number; tDeck: number; tFinal: number } }; exterior: Row[]; interior: Row[] };
type Handling = (typeof handling)[number];

const within = (ours: number, theirs: number, rel: number, label: string, abs = 1e-6) =>
  expect(Math.abs(ours - theirs), `${label}: ours ${ours.toFixed(3)}, PGSuper ${theirs.toFixed(3)}`).toBeLessThanOrEqual(rel * Math.abs(theirs) + abs);

describe.each(benchmarks as unknown as Bench[])("PGSuper AASHTO Type IV benchmark $name", (b) => {
  const { timeline, custom: _c, shape: _s, ...inputs } = b.inputs;
  void _c;
  void _s;
  const i = { ...GIRDER_DEFAULTS, losses: "refined", elasticGain: false, ...timeline, ...inputs, shape: "aashto-iv", handling: { ...HANDLING_DEFAULTS, liftPoint: 1.75, bunkPoint: 5, haulAge: 10, truck: HAUL_TRUCKS[0].truck } } as GirderInputs;
  const d = designGirder(i);
  for (const side of ["exterior", "interior"] as const) {
    const g = d[side];
    describe(`${side} girder`, () => {
      for (const row of b[side]) {
        const s = g.stations.find((st) => Math.abs(st.x - row.x) < 1e-6)!;
        const at = `${side} x=${row.x}`;
        it(`dead and live load moments at x = ${row.x} ft match (0.5%)`, () => {
          within(s.Mg, row.Mg, 0.005, `${at} girder`);
          within(s.Mdeck, row.Mdeck, 0.005, `${at} deck, haunch, diaphragms`);
          within(s.Mdc2, row.Mdc2, 0.005, `${at} barriers`);
          within(s.Mdw, row.Mdw, 0.005, `${at} overlay`);
          within(s.Mll, row.Mll, 0.005, `${at} LL+IM with the DF`);
        });
        it(`Strength I Mu and Vu at x = ${row.x} ft match (0.5%)`, () => {
          within(s.Mu, row.Mu, 0.005, `${at} Mu`);
          within(s.Vu, row.Vu, 0.005, `${at} Vu`);
        });
        it(`flexural resistance at x = ${row.x} ft: conservative, within 4%`, () => {
          expect(s.phiMn, `${at} Mn ours ${s.phiMn.toFixed(0)} vs PGSuper ${row.Mn.toFixed(0)}`).toBeLessThanOrEqual(row.Mn * 1.005);
          within(s.phiMn, row.Mn, 0.04, `${at} Mn`);
        });
        it(`shear at x = ${row.x} ft matches (dv 1%, β 4%, θ 1.5%, Vp 3%, Vn 3%)`, () => {
          const sh = s.shear!;
          within(sh.dv, row.dv, 0.01, `${at} dv`);
          within(sh.beta, row.beta, 0.04, `${at} β`);
          within(sh.theta, row.theta, 0.015, `${at} θ`);
          within(sh.Vc, row.Vc, 0.04, `${at} Vc`);
          within(sh.Vs, row.Vs, 0.02, `${at} Vs`);
          within(sh.Vp, row.Vp, 0.03, `${at} Vp`, 0.01);
          within(sh.Vn, row.Vn, 0.03, `${at} Vn`);
        });
        it(`prestress at release at x = ${row.x} ft matches (3%)`, () => {
          within(s.release.psBot, row.psRelBot, 0.03, `${at} bottom`);
          within(s.release.psTop, row.psRelTop, 0.03, `${at} top`, 0.02);
        });
      }
      it("total loss at final, at midspan, matches the refined method (2%)", () => {
        const l = g.losses;
        if (l.kind !== "refined") throw new Error("refined losses expected");
        const R0 = (Math.log10(24 * timeline.tRelease) / 40) * (l.fpj / (0.9 * 270) - 0.55) * l.fpj;
        within(l.dES + l.dLT - l.dSS + R0, b[side][b[side].length - 1].lossFinal, 0.02, `${side} total loss`);
      });
    });
  }
  const h = (handling as Handling[]).find((x) => x.name === b.name)!;
  const hd = d.exterior.handling!;
  it("lifting: factors of safety (2%) and stresses (2%)", () => {
    const L = hd.lifting.summary;
    within(L.FScr, h.lifting.FScr, 0.02, "FScr", 0.01);
    within(L.adjFSf, h.lifting.adjFSf, 0.02, "FSf", 0.01);
    within(L.minDirect, h.lifting.minDirect, 0.02, "plumb compression", 0.01);
    within(L.maxStress, h.lifting.maxStress, 0.02, "tilted tension", 0.01);
  });
  for (const slope of ["crown", "superelevation"] as const) {
    it(`hauling on the ${slope}: factors of safety (2%) and stresses (2%)`, () => {
      const s = hd.hauling[slope].summary;
      const p = h.hauling[slope];
      within(s.FScr, p.FScr, 0.02, "FScr", 0.01);
      within(s.FSf, p.FSf, 0.02, "FSf", 0.01);
      within(s.FSr, p.FSr, 0.02, "FSr", 0.01);
      within(s.minDirect, p.minDirect, 0.02, "plumb compression", 0.01);
      within(s.maxStress, p.maxStress, 0.02, "tilted tension", 0.01);
    });
  }
  it("splitting force (1.5%) and the confinement length", () => {
    within(d.exterior.splitting.demand, h.splitting.force, 0.015, "splitting");
    within(d.exterior.checks.find((c) => c.id === "conf-length")!.demand * 12, h.confinement.required, 0, "1.5d", 0.01);
  });
});
