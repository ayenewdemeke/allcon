import { describe, expect, it } from "vitest";
import { clothoid, crossSlopeAt, deckElevation, horizontalElements, pointAt, sectionAt, type Alignment, type RoadwaySection } from "./alignment";
import { BRIDGE_DEFAULTS, bridgeLayout, girderInputsFor, runBridge, spanGroups, type BridgeInputs } from "./bridge";

// Spirals, superelevation transitions and flared girders (docs/bridge-model.md, phase 2).

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);
const rad = (d: number) => (d * Math.PI) / 180;

describe("spiral curves", () => {
  const R = 1000;
  const Ls = 200;
  const spiral: Alignment = { refStation: 0, northing: 0, easting: 0, azimuth: 0, curves: [{ pi: 1000, radius: R, azimuth: 30, spiralIn: Ls, spiralOut: Ls }] };

  it("the clothoid's end: θs = Ls/2R, X and Y by the series (Hickerson)", () => {
    const e = clothoid(Ls, R, Ls);
    close(e.th, 0.1, 1e-12);
    // X = Ls(1 − θ²/10 + θ⁴/216), Y = Ls(θ/3 − θ³/42 + θ⁵/1320)
    close(e.x, 200 * (1 - 0.01 / 10 + 0.0001 / 216), 1e-7);
    close(e.y, 200 * (0.1 / 3 - 0.001 / 42 + 0.00001 / 1320), 1e-7);
  });

  it("a symmetric spiral curve: T = (R + p)·tan(Δ/2) + k, Lc = R(Δ − 2θs), ST = TS + 2Ls + Lc", () => {
    const d = horizontalElements(spiral).details[0];
    const e = clothoid(Ls, R, Ls);
    const p = e.y - R * (1 - Math.cos(0.1));
    const k = e.x - R * Math.sin(0.1);
    close(p, 1.6658, 1e-3); // ≈ Ls²/24R
    close(k, 99.9667, 1e-3); // ≈ Ls/2 − Ls³/240R²
    close(d.T, (R + p) * Math.tan(rad(15)) + k, 1e-9);
    close(d.Lc, R * (rad(30) - 0.2), 1e-9);
    close(d.pt, d.pc + 2 * Ls + d.Lc, 1e-9);
  });

  it("runs on without a break: position and bearing continuous at the TS, SC, CS and ST, the front tangent's bearing at the ST", () => {
    const c = horizontalElements(spiral);
    const d = c.details[0];
    for (const st of [d.pc, d.sc, d.cs, d.pt]) {
      const a = pointAt(spiral, st - 1e-7, c);
      const b = pointAt(spiral, st + 1e-7, c);
      close(a.x, b.x, 1e-5);
      close(a.y, b.y, 1e-5);
      close(a.az, b.az, 1e-4);
    }
    close(pointAt(spiral, d.pt, c).az, 30, 1e-9);
    // The ST on the front tangent, T from the PI.
    const pi = { x: 0, y: d.pc + d.T }; // north from the origin along the back tangent
    const st = pointAt(spiral, d.pt, c);
    close(Math.hypot(st.x - pi.x, st.y - pi.y), d.T2, 1e-6);
  });

  it("is the circular curve when the spirals are 0", () => {
    const plain: Alignment = { ...spiral, curves: [{ pi: 1000, radius: R, azimuth: 30 }] };
    const d = horizontalElements(plain).details[0];
    close(d.T, R * Math.tan(rad(15)), 1e-9);
    close(d.Lc, R * rad(30), 1e-9);
  });

  it("refuses spirals longer than the curve's turn", () => {
    expect(() => horizontalElements({ ...spiral, curves: [{ pi: 1000, radius: 500, azimuth: 10, spiralIn: 100, spiralOut: 100 }] })).toThrow(/spirals/);
  });
});

describe("superelevation transitions", () => {
  const road: RoadwaySection = {
    leftSlope: -0.02,
    rightSlope: -0.02,
    crownOffset: 0,
    sections: [
      { station: 1000, leftSlope: -0.02, rightSlope: -0.02, crownOffset: 0 }, // normal crown
      { station: 1100, leftSlope: 0.06, rightSlope: -0.06, crownOffset: 0 }, // full super, falling to the right
    ],
  };
  const flat = { station: 0, elevation: 100, grade: 0, curves: [] };

  it("straight-line between the templates, constant outside them", () => {
    const m = sectionAt(road, 1050);
    close(m.leftSlope, 0.02);
    close(m.rightSlope, -0.04);
    close(sectionAt(road, 900).rightSlope, -0.02);
    close(sectionAt(road, 1200).leftSlope, 0.06);
  });

  it("the deck's elevation and cross slope follow the transition", () => {
    close(deckElevation(flat, road, 1050, 10), 100 - 0.4);
    close(deckElevation(flat, road, 1050, -10), 100 + 0.2); // the left lane now rising away from the crown, 0.02 ft/ft
    close(deckElevation(flat, road, 1100, 10), 100 - 0.6);
    close(crossSlopeAt(road, 10, 1100), -0.06);
    close(crossSlopeAt(road, -10, 1100), -0.06);
  });

  it("is the single roadway section without templates", () => {
    close(deckElevation(flat, { leftSlope: -0.02, rightSlope: -0.02, crownOffset: 0 }, 1050, 10), 99.8);
  });
});

describe("flared girders", () => {
  const b: BridgeInputs = { ...BRIDGE_DEFAULTS, supports: BRIDGE_DEFAULTS.supports.map((s, k) => ({ ...s, spacing: k === 2 ? 7 : 8 })) };

  it("the girder lines run between each support's spacing", () => {
    const lay = bridgeLayout(b);
    const g = lay.spans[1].girders[0]; // span 2, the left exterior girder: 8 ft spacing at the pier, 7 at the abutment
    close(g.start.offset, -2.5 * 8, 0.05); // the bearing is just ahead of the pier's line
    close(g.end.offset, -2.5 * 7, 0.05);
    close(g.flare, 2.5, 1e-6);
    expect(lay.spans[0].girders[0].flare).toBeCloseTo(0, 9);
  });

  it("designs the girders for the widest spacing in the group", () => {
    const lay = bridgeLayout(b);
    expect(girderInputsFor(b, lay, spanGroups(b)[0]).S).toBe(8);
    expect(runBridge(b).layout.overhang).toBeCloseTo(23.5 - 2.5 * 8, 9);
  });
});
