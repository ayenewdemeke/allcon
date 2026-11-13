import { describe, expect, it } from "vitest";
import { creep, designGirder, GIRDER_DEFAULTS, refinedLosses, shrinkage, type Composite, type GirderInputs } from "./prestressed";
import { profileProps } from "./sections";

// WSDOT's "Precast, Prestressed Girder Design Example – PGSuper Training" (R. Brice, version 3.5, 9/17/2024):
// the exterior girder (Girder A) of a WF74G bridge, 159.578 ft bearing to bearing, 6 girders at 7 ft,
// f′ci 7.2 / f′c 8.7 ksi, 61 permanent strands (44 straight, 17 harped) and 4 temporary top strands,
// to AASHTO LRFD 9th ed. and the WSDOT BDM. Its numbers are worked out by hand from PGSuper.
//
// This tool is checked against the parts that are AASHTO's (unchanged in the 10th edition for these
// articles). What the example does by WSDOT policy, which this tool does not (it follows AASHTO 10th, or
// the CDOT BDM under CDOT criteria), is compared with that policy undone, or left out:
// - the exterior girder's live load distribution factor (WSDOT BDM 3.9.3.A: 0.694; AASHTO: 0.757);
// - relaxation before transfer (ΔfpR0 = 1.98 ksi) and temporary top strands (not modelled here);
// - 50% of the deck's shrinkage (WSDOT BDM 5.1.4.3.D) and ΔfpR1 by C5.9.3.4.2c-1 (this tool: Eq. 5.9.3.4.2c-1);
// - camber and haunch by WSDOT's D40/D120 method (CDOT criteria use BDM 5.5.2.1 instead);
// - a horizontally curved girder with a varying overhang (here straight; the slab's load matched at midspan).

const profile: [number, number][] = [[0, 18.1875], [1, 19.1875], [5.125, 19.1875], [9.625, 6.0625], [12.625, 3.0625], [65, 3.0625], [68, 6.0625], [71, 24.5], [74, 24.5]];

const example: GirderInputs = {
  ...GIRDER_DEFAULTS,
  shape: "custom",
  custom: { profile, web: 6.125, topWidth: 49 },
  L: 159.578,
  endDist: 1.7083,
  nGirders: 6,
  S: 7,
  overhang: 3.5, // the example limits the overhang to S/2 for the section's effective width (C4.6.2.6.1)
  barrierWidth: 1.0835, // 39.833 ft curb to curb on a 42 ft deck
  deckT: 7.5,
  sacrificial: 0.5,
  haunch: 4.53, // the example's haunch load at midspan (760.28 kip·ft)
  haunchInSection: false,
  fcDeck: 4,
  wcDeck: 0.15,
  wcDeckLoad: 0.155,
  fci: 7.2,
  fc: 8.7,
  wc: 0.155,
  wcLoad: 0.165,
  K1: 1,
  strandDia: 0.6,
  fpu: 270,
  fpjRatio: 0.75,
  strands: [{ y: 35.657 - 31.748, count: 44 }], // e = 31.748 in
  harped: { count: 17, yEnd: 35.657 + 26.813, yHarp: 35.657 - 30.775, harpPoint: 0.4 }, // e = −26.813 and 30.775 in
  losses: "refined",
  elasticGain: true,
  humidity: 75,
  tRelease: 1,
  tDeck: 120,
  tFinal: 2000,
  diaphragms: 3,
  diaphragmWeight: 2 * 1.756, // 1.76 kip on the exterior girder, which carries half
  otherDC1: (2465.61 * 8) / 159.578 ** 2 - (7.5 / 12) * 7 * 0.155, // the slab past S/2 (its overhang varies), uniform
  barrierWeight: 0.69,
  barriersOnExterior: false,
  otherDC2: 0,
  fws: 35,
  stirrups: [
    { length: 12, bar: 5, legs: 2, spacing: 6 },
    { length: 0, bar: 5, legs: 2, spacing: 18 },
  ],
  bearingLength: 12,
  criteria: "aashto",
};

const within = (ours: number, theirs: number, rel: number, label: string) => expect(Math.abs(ours - theirs), `${label}: ours ${ours.toFixed(4)}, the example ${theirs.toFixed(4)}`).toBeLessThanOrEqual(rel * Math.abs(theirs));

describe("WSDOT PGSuper training: Girder Design Example (WF74G, 2024)", () => {
  const d = designGirder(example);
  const g = d.exterior;
  const mid = g.stations.find((s) => Math.abs(s.x - example.L / 2) < 1e-6)!;

  it("WF74G section properties (example §2.3)", () => {
    const p = profileProps(profile);
    within(p.A, 923.531, 1e-5, "A");
    within(p.I, 734356.0, 1e-5, "Ix");
    within(p.yb, 35.657, 1e-5, "Yb");
    within(p.perimeter, 289.284, 1e-5, "perimeter");
  });

  it("composite section (§3.3.2, §4.7.1: 84 in effective width, n = 0.725, 7 in structural deck)", () => {
    within(g.comp.A, 1349.614, 1e-4, "Ac");
    within(g.comp.I, 1246570.6, 1e-4, "Ic");
    within(g.comp.yb, 48.867, 1e-4, "Ybc");
  });

  it("dead load moments at midspan and HL-93 per lane (§3.4.3.2)", () => {
    within(mid.Mg, 3368.43, 1e-3, "girder");
    within(mid.Mdeck, 140.14 + 2465.61 + 760.28, 1e-3, "diaphragms, slab and haunch");
    within(mid.Mdc2, 732.12, 1e-3, "traffic barrier");
    within(mid.Mdw, 739.63, 1e-3, "future overlay");
    // The example's live load per girder is 3804.05 kip·ft with WSDOT's exterior factor 0.694; AASHTO's is larger.
    within(mid.Mll / g.df.moment, 5485.09, 1e-3, "HL-93 + IM per lane");
    expect(g.df.moment).toBeGreaterThan(0.694);
  });

  it("flexural resistance at midspan (§4.7.3): dp as PGSuper, Mn within 2% and conservative", () => {
    within(g.flexMid.dp, 76.822, 1e-4, "dp");
    // PGSuper: nonlinear strain compatibility (Mn 20526.2 kip·ft); this tool: the stress block of 5.6.3.1.1 by strain compatibility.
    expect(g.flexMid.Mn).toBeLessThanOrEqual(20526.2);
    within(g.flexMid.Mn, 20526.2, 0.02, "Mn");
  });

  it("shear at the critical section, dv from the support's face (§5.1, §5.2)", () => {
    const crit = g.stations.find((s) => s.label === "Shear critical section")!;
    within(crit.x, 6.282, 0.01, "location from the bearing");
    const sh = crit.shear!;
    within(sh.dv, 69.384, 1e-3, "dv");
    within(sh.theta, 28.02, 0.01, "θ");
    within(sh.beta, 6.07, 0.03, "β"); // Vu here uses AASHTO's distribution factor, the example WSDOT's
    within(sh.Vp, 43.18, 0.03, "Vp");
    within(sh.Vs, 808.29, 0.01, "Vs (#5 at 6 in)");
    within(sh.Vmax, 967.51, 0.005, "0.25 f′c bv dv + Vp, which governs");
    within(sh.Vn, 967.51, 0.005, "Vn");
  });

  it("prestress camber at release (§6.4.2): the example's 7.161 in less its temporary strands' 0.697 in", () => {
    // Temporary strands (4, e = −36.343 in, 162.93 kip): 0.655 in of rebound with Ec, so 0.697 in with Eci.
    // This tool has no ΔfpR0 (1.98 ksi): its prestress is about 1% higher.
    within(g.camber.dPs, 7.161 + 0.655 * (5886.891 / 5530.5), 0.015, "Δps");
  });

  it("elastic shortening (§4.2.2.2): within 3% (the example adds ΔfpR0 and iterates at each section)", () => {
    within(g.losses.dES, 20.328, 0.03, "ΔfpES");
  });

  describe("refined losses (§4.6.1, §4.7.1) with the example's own inputs", () => {
    const i: GirderInputs = { ...example };
    const gp = { ...profileProps(profile) };
    const comp = (Aps: number): Composite => ({ beff: 681.165 / 7, ts: 7, hh: 0, n: 0.725, A: 1349.614, I: 1246570.6, yb: 48.867, Sbc: 1246570.6 / 48.867, Stc: 1246570.6 / 25.133, Std: 1246570.6 / 32.133, h: 81, deckCg: 48.867 + 28.883 + 0 * Aps });
    const base = { i, g: gp, e: 31.477, fpt: 202.5 - 1.98 - 20.328, fcgp: 3.945, Eci: 5530.5, Ec: 5886.891, Ecd: 4266.223, Mdeck: 3366.05 * 12, Msidl: 1471.75 * 12 };
    // Transfer to deck: the example's Kid counts the 4 temporary strands (65 × 0.217 = 14.105 in², their
    // centroid at e = 27.304 in), with Ag·e·epg = 923.531 × 27.304 × 31.477 for Ag·epg².
    const toDeck = refinedLosses({ ...base, comp: comp(14.105), Aps: 14.105, e: Math.sqrt(27.304 * 31.477) });
    // Deck to final: the 61 permanent strands (13.237 in²); the deck's actual area, 681.165 in².
    const final = refinedLosses({ ...base, comp: comp(13.237), Aps: 13.237 });

    it("creep and shrinkage factors (5.4.2.3)", () => {
      const VS = gp.A / gp.perimeter;
      within(creep(i, VS, 7.2, 1999, 1), 1.135, 0.005, "ψb(tf, ti)");
      within(creep(i, VS, 7.2, 119, 1), 0.912, 0.005, "ψb(td, ti)");
      within(creep(i, VS, 7.2, 1880, 120), 0.644, 0.005, "ψb(tf, td)");
      within(shrinkage(i, VS, 7.2, 119), 0.000228, 0.005, "εbid");
      within(shrinkage(i, VS, 7.2, 1999), 0.000284, 0.005, "εbif");
    });

    it("transfer to deck placement: Kid, ΔfpSR, ΔfpCR (5.9.3.4.2)", () => {
      within(toDeck.Kid, 0.773, 0.002, "Kid");
      within(toDeck.dSR, 5.022, 0.005, "ΔfpSR");
      within(toDeck.dCR, 14.327, 0.005, "ΔfpCR");
      // ΔfpR1 by Eq. 5.9.3.4.2c-1 (KL = 30); the example uses C5.9.3.4.2c-1 (1.007 ksi).
      within(toDeck.dR1, (180.192 / 30) * (180.192 / 243 - 0.55), 1e-3, "ΔfpR1, Eq. 5.9.3.4.2c-1");
    });

    it("deck placement to final: Kdf, ΔfpSD, Δfcd, ΔfpCD, ΔfpSS (5.9.3.4.3)", () => {
      within(final.Kdf, 0.777, 0.002, "Kdf");
      within(final.dSD, 1.234, 0.01, "ΔfpSD");
      within(final.dfcd, -3.02, 0.01, "Δfcd");
      // Eq. 5.9.3.4.3b-1 with the example's printed values gives −3.79 ksi; the example prints −2.892.
      const eq = (28500 / 5530.5) * 3.945 * (1.135 - 0.912) * 0.777 + (28500 / 5886.891) * -3.02 * 0.644 * 0.777;
      within(final.dCD, eq, 0.02, "ΔfpCD, Eq. 5.9.3.4.3b-1");
      // Deck shrinkage: AASHTO's full strain; the example takes half (WSDOT BDM 5.1.4.3.D): −0.498 ksi.
      within(final.dSS, 2 * -0.498, 0.03, "ΔfpSS, full deck shrinkage");
    });
  });
});
