import { describe, expect, it } from "vitest";
import benchmarks from "./pgsuper-benchmarks.json";
import { designGirder, GIRDER_DEFAULTS, type GirderInputs } from "./prestressed";

// The design check against PGSuper 9.0.4 (WSDOT's BridgeLink), the reference program for precast
// girder design. Each benchmark bridge was built in PGSuper from a WSDOT WF girder template with its
// criteria set to plain AASHTO (LRFD distribution factors, the rigid cross-section check, barriers
// shared by all girders, no elastic gains) and run in PGSuper's NCHRP 12-50 test mode; the fixture
// holds the same bridge as this tool's inputs (the girder's outline, strand rows, harped strands'
// centroid and debonding read from the PGSuper file and its results) and PGSuper's results at the
// tenth points. The bridges: WF74G 120 ft (straight strands), WF58G 85 ft, WF74G 120 ft with 8
// harped strands, WF74G 120 ft with 6 strands debonded (10 and 15 ft).
//
// PGSuper ran WSDOT's refined losses: AASHTO 5.9.3.4 exactly, plus the initial relaxation before
// transfer (ΔfpR0) and, as its criteria were set, without the deck's shrinkage gain (ΔfpSS). Its test
// mode can't run the plain AASHTO loss methods. So this tool runs refined losses on PGSuper's
// timeline (release at 1 day, deck at 123, final at 2000) and the totals are compared with ΔfpR0
// added and ΔfpSS left out.
//
// Where the two differ by method:
// - Flexural resistance: PGSuper uses strain compatibility, this tool the approximate fps of
//   5.6.3.1.1, which is a little lower (conservative), by up to about 3%.

type Row = { x: number; Mg: number; Mdeck: number; Mdc2: number; Mdw: number; Mll: number; Mu: number; Vu: number; Mn: number; dv: number; Vc: number; Vs: number; Vn: number; beta: number; theta: number; dES: number; fpe: number; lossFinal: number; Vp: number; psRelTop: number; psRelBot: number };
type Bench = { name: string; source: string; inputs: Partial<GirderInputs> & { timeline: { tRelease: number; tDeck: number; tFinal: number } }; exterior: Row[]; interior: Row[] };

const within = (ours: number, theirs: number, rel: number, label: string, abs = 1e-6) =>
  expect(Math.abs(ours - theirs), `${label}: ours ${ours.toFixed(3)}, PGSuper ${theirs.toFixed(3)}`).toBeLessThanOrEqual(rel * Math.abs(theirs) + abs);

describe.each(benchmarks as unknown as Bench[])("PGSuper benchmark $name", (b) => {
  const { timeline, ...inputs } = b.inputs;
  const d = designGirder({ ...GIRDER_DEFAULTS, losses: "refined", elasticGain: false, ...timeline, ...inputs } as GirderInputs);
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
          const Mn = s.phiMn; // φ = 1.0, tension-controlled
          expect(Mn, `${at} Mn ours ${Mn.toFixed(0)} vs PGSuper ${row.Mn.toFixed(0)}`).toBeLessThanOrEqual(row.Mn * 1.005);
          within(Mn, row.Mn, 0.04, `${at} Mn`);
        });
        // β is sensitive where εs is near zero (a 4% change in β is about 4e-5 of strain there).
        it(`shear by the general procedure at x = ${row.x} ft matches (dv 1%, β 4%, θ 1.5%, Vp 3%, Vn 3%)`, () => {
          const sh = s.shear!;
          within(sh.dv, row.dv, 0.01, `${at} dv`);
          within(sh.beta, row.beta, 0.04, `${at} β`);
          within(sh.theta, row.theta, 0.015, `${at} θ`);
          within(sh.Vc, row.Vc, 0.04, `${at} Vc`);
          within(sh.Vs, row.Vs, 0.02, `${at} Vs`);
          within(sh.Vp, row.Vp, 0.03, `${at} Vp`, 0.01);
          within(sh.Vn, row.Vn, 0.03, `${at} Vn`);
        });
        // AASHTO 5.9.3.2.3a takes fcgp at the section of maximum moment, so this tool has one ΔfpES;
        // PGSuper works it out section by section (more loss near the ends) and adds ΔfpR0.
        it(`prestress at release at x = ${row.x} ft matches (3%)`, () => {
          within(s.release.psBot, row.psRelBot, 0.03, `${at} bottom`);
          within(s.release.psTop, row.psRelTop, 0.03, `${at} top`, 0.02);
        });
      }
      it("elastic shortening at midspan matches (3%)", () => {
        within(g.losses.dES, b[side][b[side].length - 1].dES, 0.03, `${side} ΔfpES`);
      });
      it("total loss at final, at midspan, matches the refined method (2%)", () => {
        const l = g.losses;
        if (l.kind !== "refined") throw new Error("refined losses expected");
        const fpj = l.fpj;
        const fpy = 0.9 * 270;
        const R0 = (Math.log10(24 * timeline.tRelease) / 40) * (fpj / fpy - 0.55) * fpj; // initial relaxation, as WSDOT adds
        const ours = l.dES + l.dLT - l.dSS + R0;
        within(ours, b[side][b[side].length - 1].lossFinal, 0.02, `${side} total loss`);
      });
    });
  }
});
