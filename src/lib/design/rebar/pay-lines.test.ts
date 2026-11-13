import { describe, expect, it } from "vitest";
import { STM_DEFAULTS, stmInputs } from "../stm/strut-tie";
import { detailCap } from "../stm/detail";
import { buildTemplate, HAMMERHEAD_DEFAULTS } from "../stm/templates";
import { CDOT_ITEMS, GENERIC_ITEMS, payItem, payItemsFor, toolPayItems, TOOL_PAY_ITEMS } from "./cdot-items";
import { designPayLines, roundFor } from "./pay-lines";

describe("CDOT pay items for a design's quantities", () => {
  it("every tool's items are in the catalog, with CDOT's item numbers and pay units", () => {
    for (const roles of Object.values(TOOL_PAY_ITEMS)) for (const codes of Object.values(roles)) for (const c of codes!) expect(payItem(c), c).not.toBeNull();
    expect(new Set(CDOT_ITEMS.map((p) => p.code)).size).toBe(CDOT_ITEMS.length);
    expect(payItem("601-03040")).toEqual({ code: "601-03040", description: "Concrete Class D (Bridge)", unit: "CY" });
    expect(payItem("602-00020")!.unit).toBe("LB");
    // Bridge elements default to epoxy-coated bars, as CDOT's bridge quantity sets carry them.
    expect(payItemsFor("stm-d-region", "rebar", "cdot")[0].code).toBe("602-00020");
  });

  it("generic pay items: one MasterFormat section per quantity, for every tool's quantities", () => {
    expect(new Set(GENERIC_ITEMS.map((p) => p.code)).size).toBe(GENERIC_ITEMS.length);
    for (const kind of Object.keys(TOOL_PAY_ITEMS))
      for (const [role, codes] of Object.entries(toolPayItems(kind))) {
        expect(codes, `${kind} ${role}`).toHaveLength(1);
        // The same pay unit as the agency's items, so a quantity reads the same either way.
        expect(payItem(codes![0])!.unit, `${kind} ${role}`).toBe(payItem(TOOL_PAY_ITEMS[kind][role as keyof (typeof TOOL_PAY_ITEMS)[string]]![0])!.unit);
      }
    expect(payItemsFor("stm-d-region", "rebar")[0]).toEqual({ code: "03 21 00", description: "Reinforcement Bars", unit: "LB" });
  });

  it("a cap's concrete and bars as pay lines, rounded as a summary of quantities carries them", () => {
    const d = detailCap(buildTemplate(HAMMERHEAD_DEFAULTS, STM_DEFAULTS));
    const lines = designPayLines(d.schedule, { concrete: "601-03040", rebar: "602-00020" }, TOOL_PAY_ITEMS["stm-d-region"]);
    expect(lines.map((l) => l.code)).toEqual(["601-03040", "602-00020"]);
    expect(lines[0].quantity).toBeCloseTo(roundFor("CY", d.schedule.concreteTotal), 9);
    expect(lines[1].quantity).toBe(Math.round(d.schedule.total / 10) * 10); // to the nearest 10 lb
    // An item the tool doesn't allow falls back to its default.
    expect(designPayLines(d.schedule, { concrete: "618-01154" }, TOOL_PAY_ITEMS["stm-d-region"])[0].code).toBe("601-03040");
  });

  it("the chosen items and the line items' heading are saved with the design", () => {
    const i = stmInputs({ ...STM_DEFAULTS, payItems: { concrete: "601-03041", rebar: "602-00020", headingId: "x" } });
    expect(i.payItems).toEqual({ agency: "generic", concrete: "601-03041", rebar: "602-00020", headingId: "x" });
  });
});
