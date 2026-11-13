import { describe, expect, it } from "vitest";
import fixtures from "./pgsuper-continuous.json";
import { designGirder, GIRDER_DEFAULTS, type GirderInputs } from "./prestressed";

// Girders made continuous, against PGSuper 9.0.4 (WSDOT's BridgeLink). The WF74G harped benchmark
// girder (pgsuper-benchmarks.json) in three bridges made continuous after the deck: 2 × 120 ft,
// 100 + 130 ft and 100 + 130 + 100 ft, with deck bars over the piers (#6 at 6 in top, #5 at 6 in
// bottom). PGSuper ran in continuous analysis (not WSDOT's simple/continuous envelope), without
// restraint moments, and its test mode reports the first span only, so span 1 is compared, from the
// abutment to the first pier.
//
// PGSuper's continuous beam spans from the abutment's bearing to the pier's centerline (the bearings
// 0.8255 m either side of it); the tool does the same (pierBearingOffset).
//
// Where the two differ by method:
// - The 90% two-truck load (3.6.1.3.1): the tool applies it wherever the section lies between the
//   points of contraflexure under a uniform load on all spans, as AASHTO words it. PGSuper applies it
//   over a shorter length near the pier, so near 0.7–0.9L of an end span next to a longer span the
//   tool's negative live load is up to about 5% larger (conservative); at the piers they agree.
// - Negative moment resistance: the tool's is about 3% lower (conservative).
// - Vu: the tool adds the dead and live load shears' magnitudes, so where their signs differ (near
//   midspan) its Vu is larger (conservative).

type Station = { x: number; Mdc2: number; Mdw: number; LLpos: number; LLneg: number; Mu: number; MuNeg: number; Vu: number };
type Pier = { x: number; Mdc2: number; Mdw: number; LLneg: number; MuNeg: number; MnNeg: number; McrNeg: number };
type Bench = { name: string; inputs: Partial<GirderInputs> & { timeline: { tRelease: number; tDeck: number; tFinal: number } }; interior: { stations: Station[]; pier: Pier }; exterior: { stations: Station[]; pier: Pier } };

const within = (ours: number, theirs: number, rel: number, label: string, abs = 0.5) =>
  expect(Math.abs(ours - theirs), `${label}: ours ${ours.toFixed(2)}, PGSuper ${theirs.toFixed(2)}`).toBeLessThanOrEqual(rel * Math.abs(theirs) + abs);

describe.each(fixtures as unknown as Bench[])("PGSuper continuous benchmark $name", (b) => {
  const { timeline, ...inputs } = b.inputs;
  const d = designGirder({ ...GIRDER_DEFAULTS, losses: "refined", elasticGain: false, ...timeline, ...inputs } as GirderInputs);
  for (const side of ["interior", "exterior"] as const) {
    const g = d.spans[0][side];
    describe(`${side} girder, span 1`, () => {
      for (const p of b[side].stations) {
        const s = g.stations.find((st) => Math.abs(st.x - p.x) < 1e-6)!;
        const n = s.negative!;
        const at = `${side} x=${p.x}`;
        it(`barriers and overlay on the continuous beam at x = ${p.x} ft match (0.5%)`, () => {
          within(n.Mdc2, p.Mdc2, 0.005, `${at} DC2`);
          within(n.Mdw, p.Mdw, 0.005, `${at} DW`);
        });
        it(`HL-93 per lane at x = ${p.x} ft: positive matches (0.5%); negative matches, or is conservative where the two-truck load applies`, () => {
          within(s.Mll / g.df.moment, p.LLpos, 0.005, `${at} LL+`);
          const ours = n.Mll / n.df;
          if (n.governs.startsWith("90%")) {
            expect(ours, `${at} LL− conservative`).toBeLessThanOrEqual(p.LLneg * 0.995);
            within(ours, p.LLneg, 0.06, `${at} LL−`);
          } else within(ours, p.LLneg, 0.005, `${at} LL−`);
        });
        it(`Strength I Mu and Vu at x = ${p.x} ft`, () => {
          // Positive Mu near the pier is small; there the components' factors leave about 3%.
          within(s.Mu, p.Mu, p.x / g.L > 0.75 ? 0.03 : 0.005, `${at} Mu`);
          expect(s.Vu, `${at} Vu not less`).toBeGreaterThanOrEqual(p.Vu * 0.995);
          within(s.Vu, p.Vu, 0.1, `${at} Vu`);
        });
      }
      it("at the pier: the continuous loads, the live load and Strength I Mu− match (1.5%)", () => {
        const s = g.stations.find((st) => st.pier && st.x > 1)!;
        const n = s.negative!;
        const p = b[side].pier;
        within(n.Mdc2, p.Mdc2, 0.005, "pier DC2");
        within(n.Mdw, p.Mdw, 0.005, "pier DW");
        within(n.Mll / n.df, p.LLneg, 0.01, "pier LL−");
        within(n.Mu, p.MuNeg, 0.015, "pier Mu−");
      });
      it("over the pier: Mn conservative within 3%, Mcr within 1%", () => {
        const neg = g.negativeSection!;
        expect(neg.Mn).toBeLessThanOrEqual(-b[side].pier.MnNeg * 1.005);
        within(neg.Mn, -b[side].pier.MnNeg, 0.03, "Mn−");
        within(neg.Mcr, -b[side].pier.McrNeg, 0.01, "Mcr−");
      });
    });
  }
});
