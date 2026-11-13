import { describe, expect, it } from "vitest";
import { ledgeChecks } from "./ledge";
import { nodeLpSolver } from "./lp-node";
import { designStm, STM_DEFAULTS } from "./strut-tie";
import { ABUTMENT_DEFAULTS, buildTemplate, INVERTED_T_DEFAULTS } from "./templates";

// Inverted-T ledges by AASHTO 5.8.4.3, against a hand calculation; the inverted-T and abutment
// templates through the design (illustrative dimensions, the templates' defaults).

const input = { fc: 5, fy: 60, bw: 36, bl: 24, hf: 24, cover: 3, bottomCover: 5, av: 12, W: 16, L: 12, primary: { size: 6, spacing: 6 }, ties: { size: 5, spacing: 6 }, hangers: { size: 5, spacing: 4 } };

describe("beam ledges (5.8.4.3), an interior bearing by hand", () => {
  const c = Object.fromEntries(ledgeChecks(input, { label: "G2", Vu: 300, Vs: 200, S: 96, c: 200, exterior: false }).map((x) => [x.id.split("-")[0], x]));
  it("shear friction: b = W + 4av = 64 in; Avf = (0.44/6 + 0.31/6)(64) = 8.0 in²; Vn = min(1.4 Avf fy, 0.2 f'c b de, 0.8 b de) = 672 kip", () => {
    expect(c.sf.capacity).toBeCloseTo(0.9 * 1.4 * ((0.44 + 0.31) / 6) * 64 * 60, 6);
    expect(c.sf.ok).toBe(true);
  });
  it("punching: bo = W + 2L + 2df = 78 in; Vn = 0.125 √f'c bo df = 414 kip", () => {
    expect(c.pu.capacity).toBeCloseTo(0.9 * 0.125 * Math.sqrt(5) * 78 * 19, 6);
    expect(c.pu.ok).toBe(true);
  });
  it("hangers, strength: the lesser of (Ahr fy/s) S = 446 kip and 0.063 √f'c bf df + (Ahr fy/s)(W + 2df) = 476 kip", () => {
    expect(c.hs.capacity).toBeCloseTo(0.9 * ((0.31 * 60) / 4) * 96, 6);
  });
  it("hangers, service: 0.5 Ahr fy (W + 3av)/s = 121 kip, short of 200 kip", () => {
    expect(c.hv.capacity).toBeCloseTo((0.5 * 0.31 * 60 * 52) / 4, 6);
    expect(c.hv.ok).toBe(false);
  });
  it("bearing: m = 2 (limited across the ledge, 6 in each side of the 12 in pad); φ 0.85 f'c A1 m = 1,142 kip", () => {
    expect(c.br.capacity).toBeCloseTo(0.7 * 0.85 * 5 * 192 * 2, 6);
  });
  it("an exterior bearing near the ledge's end: bo by Eq. 5.8.4.3.4-5, smaller", () => {
    const ext = ledgeChecks(input, { label: "G1", Vu: 300, Vs: 200, S: 96, c: 18, exterior: true }).find((x) => x.id.startsWith("pu"))!;
    expect(ext.capacity).toBeCloseTo(0.9 * 0.125 * Math.sqrt(5) * Math.min(0.5 * 16 + 12 + 19 + 18, 78) * 19, 6);
  });
});

describe("the inverted-T and abutment templates", () => {
  it("inverted-T: each load enters at the ledge with a hanger tie up the stem; ledges checked at every bearing; equilibrium", async () => {
    const m = buildTemplate(INVERTED_T_DEFAULTS, { ...STM_DEFAULTS, girders: null });
    const r = await designStm(m, nodeLpSolver);
    expect(r.perCase.every((p) => p.equilibrium.ok)).toBe(true);
    // The loads are at bottom-chord nodes, each with a vertical tie (hangers) carrying it up.
    const loaded = m.cases[0].loads.map((l) => l.node);
    for (const n of loaded.filter((x) => !x.startsWith("C"))) {
      const hanger = r.members.find((x) => x.key.split("-").includes(n) && Math.abs(r.nodes[x.a][0] - r.nodes[x.b][0]) < 1e-6);
      expect(hanger?.tension).toBeGreaterThan(0);
    }
    expect(r.ledges.length).toBeGreaterThan(0);
    expect(new Set(r.ledges.map((x) => x.id.split("-")[0]))).toEqual(new Set(["sf", "fl", "as", "ah", "pu", "hs", "br"]));
    // Without girder designs there's no service reaction: the service hanger check is named as needing it.
    expect(r.coverage.some((x) => x.status === "missing-input" && x.item.includes("hangers, service"))).toBe(true);
    expect(r.coverage.some((x) => x.item === "Inverted-T torsion" && x.status === "not-implemented")).toBe(true);
  });

  it("abutment on piles: the piles are the supports; a component of its own", async () => {
    const m = buildTemplate({ ...ABUTMENT_DEFAULTS, bearings: [4, 12, 20, 28, 36].map((x) => ({ x, P: 150 })) }, { ...STM_DEFAULTS, girders: null });
    expect(m.component).toBe("abutment");
    expect(m.supports.length).toBe(ABUTMENT_DEFAULTS.columns.length);
    const r = await designStm(m, nodeLpSolver);
    expect(r.perCase.every((p) => p.equilibrium.ok)).toBe(true);
    expect(r.supportReport.filter((s) => s.direction === "y").reduce((t, s) => t + s.reactions[0], 0)).toBeCloseTo(750, 6);
  });
});
