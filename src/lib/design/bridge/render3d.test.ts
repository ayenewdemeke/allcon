import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRIDGE_DEFAULTS, runBridge, type BridgeInputs } from "./bridge";
import { bridgeIfc } from "./ifc";
import { elementTriangles, renderBridgeSvg } from "./render3d";

describe("the bridge's 3D schematic", () => {
  const b: BridgeInputs = { ...BRIDGE_DEFAULTS, rail: { type: "type10-mash", testLevel: "TL-5", steel: "A1035" } };
  const m = bridgeIfc(b, runBridge(b));
  const svg = renderBridgeSvg(m, { title: "Bridge" });
  if (process.env.ALLCON_DUMP_BRIDGE_SVG) writeFileSync(process.env.ALLCON_DUMP_BRIDGE_SVG, svg);

  it("draws every element's visible faces into a sized SVG", () => {
    expect(svg.startsWith('<svg width="720" height="400"')).toBe(true);
    const n = (svg.match(/<polygon/g) ?? []).length;
    expect(n).toBeGreaterThan(1000);
    expect(svg.length).toBeLessThan(1_500_000);
  });

  it("turns an extrusion into a closed prism cut along its length", () => {
    const g = m.elements.find((e) => e.cls === "IfcBeam" && e.type === "GIRDER_SEGMENT")!;
    const t = elementTriangles(g);
    expect(t.length).toBeGreaterThan(100);
  });
});
