import { describe, expect, it } from "vitest";
import { girderInputs } from "../kinds";
import { railDef, railOnDeck } from "../decks/rails";
import { DECK_DEFAULTS } from "../decks/deck";
import { takeoffFor, takeoffPayLines } from "../takeoff";
import { girderFigures } from "../figures";
import { bridgeSection, deckLength } from "./bridge-deck";
import { girderShape } from "./prestressed";

// The girder design's bridge: its rail, its typical section, and its deck's quantities.

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe("the girder design's bridge rail and section", () => {
  it("a standard rail sets the barrier's width, weight and height", () => {
    const i = girderInputs({ rail: { type: "type9-4", testLevel: "TL-5", steel: "A1035" }, barrierWidth: 2, barrierWeight: 1 });
    const def = railDef("type9-4")!;
    expect(i.barrierWidth).toBe(1.5);
    close(i.barrierWeight, +railOnDeck(def, { fc: 4.5, steel: "A1035", testLevel: "TL-5", gammaC: i.wcDeck }).weight.toFixed(4));
    close(i.site!.barrierHeight, 43 / 12);
    // An entered barrier stays as entered.
    expect(girderInputs({ barrierWidth: 2 }).barrierWidth).toBe(2);
  });

  it("the section: out to out, between the rails, a crown at the centerline or offset, or one way", () => {
    const i = girderInputs({ nGirders: 6, S: 7.2, overhang: 3.5, rail: { type: "type9-4", testLevel: "TL-5", steel: "A1035" } });
    const b = bridgeSection(i);
    close(b.W, 43);
    close(b.roadway, 40);
    close(b.surface(0), b.surface(43));
    close(b.surface(0), -0.02 * 21.5);
    const off = bridgeSection({ ...i, crown: { kind: "crown", offset: 4 } });
    close(off.xc, 25.5);
    const one = bridgeSection({ ...i, crown: { kind: "one-way", offset: 0 } });
    close(one.surface(43), -0.02 * 43);
  });

  it("the typical section draws every girder and both rails into the calc package", () => {
    const i = girderInputs({ nGirders: 6, S: 7.2, overhang: 3.5, rail: { type: "type9-4", testLevel: "TL-5", steel: "A1035" } });
    const f = girderFigures(i);
    expect(f.bridge.svg).toContain("6 spaces".replace("6", "5"));
    expect((f.bridge.svg.match(/<polygon/g) ?? []).length).toBeGreaterThanOrEqual(1 + 6 * 2 + 2);
  });
});

describe("the deck's quantities from the girder design", () => {
  const i = girderInputs({ nGirders: 6, S: 7.2, overhang: 3.5, L: 64, extraSpans: [{ L: 128, strands: null, harped: null }, { L: 64, strands: null, harped: null }], endDist: 0.75, deckT: 8, haunch: 2, rail: { type: "type9-4", testLevel: "TL-5", steel: "A1035" } });

  it("deck slab and haunches by the bridge's length; the rails by the foot; waterproofing between them", () => {
    const Ld = deckLength(i);
    close(Ld, 256 + 1.5);
    const t = takeoffFor("lrfd-girder-check", i, {})!;
    const flange = girderShape(i).topWidth / 12;
    close(t.schedule.concrete[0].cy, (43 * (8 / 12) * Ld) / 27);
    close(t.schedule.concrete[1].cy, (6 * flange * (2 / 12) * Ld) / 27);
    const pay = takeoffPayLines("lrfd-girder-check", t, {}, i, "cdot");
    expect(pay.find((p) => p.role === "concrete")!.code).toBe("601-03056");
    const rail = pay.find((p) => p.role === "rail")!;
    expect(rail.code).toBe("606-10900");
    expect(rail.quantity).toBe(Math.round(2 * Ld));
    expect(pay.find((p) => p.role === "waterproofing")!.quantity).toBe(Math.round((40 * Ld) / 9));
    expect(pay.some((p) => p.role === "girder")).toBe(true);
    // The deck's length is adjustable.
    close(takeoffFor("lrfd-girder-check", i, { length: 250 })!.schedule.concrete[0].cy, (43 * (8 / 12) * 250) / 27);
  });

  it("a Deck Slab design started from it carries only the bars", () => {
    const deck = { ...DECK_DEFAULTS, rail: { type: "type9-4" as const, testLevel: "TL-5" as const, steel: "A1035" as const }, fromGirder: { id: "g", name: "Girders" } };
    const t = takeoffFor("deck-slab", deck, { length: 100 })!;
    const pay = takeoffPayLines("deck-slab", t, {}, deck);
    expect(pay.map((p) => p.role)).toEqual(["rebar"]);
    expect(t.notes[0]).toMatch(/girder design "Girders"/);
  });
});
