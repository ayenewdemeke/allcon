import { describe, expect, it } from "vitest";
import { BEARING_DEFAULTS, designBearing } from "../bearings/elastomeric";
import { DECK_DEFAULTS, designDeck } from "../decks/deck";
import { BRIDGE_DEFAULTS, runBridge } from "./bridge";
import { bearingFromBridge, deckFromBridge } from "./loadpath";

// The deck slab and the bearings, set from the Bridge (the superstructure's last links).

describe("the deck slab from the Bridge", () => {
  const r = runBridge(BRIDGE_DEFAULTS);
  const d = deckFromBridge(BRIDGE_DEFAULTS, r, DECK_DEFAULTS, { id: "g", name: "girders" });

  it("takes the girders, spacing, overhang, thickness and the girder's top flange", () => {
    expect(d.nGirders).toBe(6);
    expect(d.S).toBe(8);
    expect(d.overhang).toBeCloseTo(23.5 - 2.5 * 8, 9);
    expect(d.t).toBe(BRIDGE_DEFAULTS.deckT);
    expect(d.flange).toBe(42); // BT-72's top flange
    expect(d.fromGirder).toEqual({ id: "g", name: "girders" }); // its concrete is the girder design's
  });

  it("the wearing surface from the Bridge's psf at the deck design's density", () => {
    expect(d.wearing).toBeCloseTo(((BRIDGE_DEFAULTS.fws / 1000) / DECK_DEFAULTS.gammaWS) * 12, 3);
  });

  it("runs", () => {
    expect(designDeck(d).checks.length).toBeGreaterThan(5);
  });
});

describe("the bearings from the Bridge", () => {
  const r = runBridge(BRIDGE_DEFAULTS);

  it("leveling pads under girders cast into a diaphragm: the girder and deck only, no live load, no movement", () => {
    const b = bearingFromBridge(BRIDGE_DEFAULTS, r, 1, BEARING_DEFAULTS); // a continuous pier
    // Each line of bearings carries its own span's end: about half the pier's DC1 for two equal spans.
    const side = Math.max(...r.reactions[1].sides.map((x) => Math.max(x.interior.DC1, x.exterior.DC1)));
    expect(b.DL).toBeCloseTo(side, 1);
    expect(b.DL).toBeLessThan(0.6 * r.reactions[1].DC1);
    expect(b.LL).toBe(0);
    expect(b.expansionLength).toBe(0);
    expect(bearingFromBridge(BRIDGE_DEFAULTS, r, 0, BEARING_DEFAULTS).expansionLength).toBe(0); // an integral abutment
  });

  it("bearings at a seat abutment: DC + DW, the live load without IM (14.4.1), movement from the bridge's middle, a joint", () => {
    const seat = { ...BRIDGE_DEFAULTS, supports: BRIDGE_DEFAULTS.supports.map((x, k) => (k === 0 ? { ...x, type: "seat-abutment" as const } : x)) };
    const rs = runBridge(seat);
    const b = bearingFromBridge(seat, rs, 0, BEARING_DEFAULTS);
    expect(b.DL).toBeCloseTo(rs.reactions[0].DC + rs.reactions[0].DW, 1);
    expect(b.LL).toBeCloseTo(rs.reactions[0].LL, 1);
    expect(b.expansionLength).toBeCloseTo(122, 6);
    expect(b.jointed).toBe(true);
  });

  it("runs", () => {
    expect(designBearing(bearingFromBridge(BRIDGE_DEFAULTS, r, 1, BEARING_DEFAULTS)).checks.length).toBeGreaterThan(3);
  });
});

describe("a new girder design for any section", () => {
  it("brings a starting pattern's harped strands inside a shallower girder (a CBT 54 from the BT-72 start)", () => {
    const b = { ...BRIDGE_DEFAULTS, shape: "cbt-54" };
    const r = runBridge(b);
    expect(r.groups[0].inputs.harped.yEnd).toBe(43);
    expect(r.groups[0].result.spans.length).toBe(2);
  });
});
