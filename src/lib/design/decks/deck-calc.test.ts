import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { WORKSHEET_TOLERANCE } from "../calc-style";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { DECK_DEFAULTS, designDeck, type DeckInputs } from "./deck";
import { deckCalcLines } from "./deck-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: DeckInputs) {
  const regions = readingOrder(layout(deckCalcLines(inputs, "Test deck"), { x: 0, y: 0 }));
  const items = regions.flatMap((r): SheetItem[] => (r.kind === "text" || r.kind === "image" ? [] : [r as SheetItem]));
  const values = new Map<string, Value>();
  const results = evaluateSheet(items, DEFAULT_SETTINGS, values);
  const errors = regions.flatMap((r) => (results.get(r.id)?.kind === "error" ? [`${r.kind === "math" ? r.latex : r.kind}: ${(results.get(r.id) as { message: string }).message}`] : []));
  const checks = regions.filter((r) => r.kind === "math" && r.latex.startsWith("\\operatorname{if}")).map((r) => (results.get(r.id) as { result?: string }).result ?? "");
  const value = (start: string, unit?: string) => {
    const r = regions.find((x) => x.kind === "math" && x.latex.startsWith(start));
    if (!r) throw new Error(`No region ${start}`);
    const v = values.get(r.id);
    return unit ? (v as Unit).toNumber(unit) : (v as number);
  };
  return { errors, checks, value };
}

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(WORKSHEET_TOLERANCE * Math.max(1, Math.abs(b)));

describe("deck calc package", () => {
  for (const [name, inputs] of [
    ["the default deck", DECK_DEFAULTS],
    ["five girders at 9 ft, a wide overhang and light bars", { ...DECK_DEFAULTS, nGirders: 5, S: 9, overhang: 7, botBars: { bar: 4, spacing: 12 }, exposure: 2, utilities: 0.005 }],
  ] as [string, DeckInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designDeck(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("M_{up}\\coloneq", "kip*ft/ft"), r.pos.Mu);
      close(c.value("M_{un}\\coloneq", "kip*ft/ft"), -r.neg.Mu);
      close(c.value("M_{rb}\\coloneq", "kip*ft/ft"), r.bottom.MR);
      close(c.value("s_{maxt}\\coloneq", "in"), r.top.sMax);
      close(c.value("M_{u1}\\coloneq", "kip*ft/ft"), r.overhang.case1.Mu);
      close(c.value("M_{r1}\\coloneq", "kip*ft/ft"), r.overhang.case1.MR);
      close(c.value("M_{u3}\\coloneq", "kip*ft/ft"), r.overhang.case3.Mu);
      close(c.value("M_{r3}\\coloneq", "kip*ft/ft"), r.overhang.case3.MR);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(r.checks.filter((x) => !x.ok).length);
      expect(c.checks.length).toBe(r.checks.length);
    });
  }
});
