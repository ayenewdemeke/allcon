import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROACH_SLAB_DEFAULTS } from "../approach/approach-slab";
import { DECK_DEFAULTS } from "../decks/deck";
import { ABUTMENT_DEFAULTS } from "../foundations/abutment";
import { FOOTING_DEFAULTS } from "../foundations/footing";
import { PILE_DEFAULTS } from "../foundations/piles";
import { SHAFT_DEFAULTS } from "../foundations/shaft";
import { COLUMN_DEFAULTS } from "../piers/column";
import { groupWeight } from "../rebar/schedule";
import { stmInputs } from "../stm/strut-tie";
import { buildTemplate, MULTICOLUMN_DEFAULTS } from "../stm/templates";
import { BRIDGE_DEFAULTS, runBridge } from "./bridge";
import { bridgeIfc, type BridgeComponents, type IfcElement, type V3 } from "./ifc";
import { attachRebar, barPath, elementBox, rebarSources, rebarTotals, type RebarDesigns } from "./ifc-rebar";
import { capFromBridge } from "./loadpath";

// The Bridge's IFC model with every component linked: each linked design's bars on its concrete, as
// api/_bridge.py writes them. The Python half (scripts/ifc-rebar-check.py) runs where the desktop
// copy's Python is (./python), writing the model with IfcOpenShell and reading it back.

const b = BRIDGE_DEFAULTS;
const run = runBridge(b);
const pier = b.supports.findIndex((s) => !s.type.endsWith("abutment"));
const foundation = b.supports[pier].pier!.foundation;
const comps: BridgeComponents = {
  verdicts: {},
  abutments: { 0: { id: "abut-1", inputs: ABUTMENT_DEFAULTS }, [b.supports.length - 1]: { id: "abut-1", inputs: ABUTMENT_DEFAULTS } },
  approachSlabs: { 0: { id: "ap-1", inputs: APPROACH_SLAB_DEFAULTS }, [b.supports.length - 1]: { id: "ap-1", inputs: APPROACH_SLAB_DEFAULTS } },
  foundations: {
    [pier]:
      foundation === "spread-footing" ? { id: "fdn-1", kind: "spread-footing", inputs: FOOTING_DEFAULTS }
      : foundation === "pile-foundation" ? { id: "fdn-1", kind: "pile-foundation", inputs: PILE_DEFAULTS }
      : { id: "fdn-1", kind: "drilled-shaft", inputs: SHAFT_DEFAULTS },
  },
  deckId: "deck-1",
  ids: { girders: [], caps: { [pier]: "cap-1" }, columns: { [pier]: "col-1" } },
};
const designs: RebarDesigns = {
  deck: { id: "deck-1", inputs: DECK_DEFAULTS },
  caps: { [pier]: { id: "cap-1", inputs: capFromBridge(b, run, pier, buildTemplate(MULTICOLUMN_DEFAULTS, stmInputs({})), ["g"], ["Girders"]) } },
  columns: { [pier]: { id: "col-1", inputs: COLUMN_DEFAULTS } },
};
const sources = rebarSources(comps, designs);
const m = attachRebar(bridgeIfc(b, run, comps, "Sample bridge"), sources);
const hosts = m.elements.filter((e) => e.rebar?.bars.length);

const profileArea = (e: IfcElement) => {
  const p = e.profile;
  if (p.kind === "rect") return p.x * p.y;
  if (p.kind === "circle") return Math.PI * p.r ** 2;
  if (p.kind === "poly") return Math.abs(p.pts.reduce((t, q, k) => t + q[0] * p.pts[(k + 1) % p.pts.length][1] - p.pts[(k + 1) % p.pts.length][0] * q[1], 0)) / 2;
  return 0; // meshes are checked elsewhere (the deck's volume)
};
const dot = (a: V3, c: V3) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
const inside = (e: IfcElement, p: V3, tol: number) => {
  const box = elementBox(e)!;
  const d: V3 = [p[0] - box.c[0], p[1] - box.c[1], p[2] - box.c[2]];
  return box.ax.every((a, k) => Math.abs(dot(d, a)) <= box.half[k] + tol);
};

describe("the Bridge's reinforcing bars in its IFC model", () => {
  it("puts each linked design's bars on its concrete", () => {
    const kinds = new Set(hosts.map((h) => h.rebar!.designKind));
    for (const k of ["abutment", "approach-slab", "deck-slab", "pier-column", "stm-d-region", foundation]) expect(kinds, k).toContain(k);
    // Never on steel (H-piles) or bearings.
    for (const h of hosts) expect(h.material).toMatch(/oncrete/);
    expect(hosts.filter((h) => h.cls === "IfcSlab" && h.type === "FLOOR")).toHaveLength(run.layout.spans.length);
  });

  it("carries the schedule: size, diameter, count, each length, weight and shape", () => {
    for (const h of hosts)
      for (const bar of h.rebar!.bars) {
        expect(bar.mark).toMatch(/^\d{3,4}$/);
        expect(bar.diameter).toBeCloseTo(bar.size <= 8 ? bar.size / 8 : bar.diameter, 6);
        expect(bar.count).toBeGreaterThan(0);
        expect(bar.length).toBeGreaterThan(0);
        expect(bar.weight).toBeGreaterThan(0);
        // The drawn shape is as long as the bar, but a closed stirrup's hooks (in its length, not drawn).
        const drawn = bar.path.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - bar.path[k][0], p[1] - bar.path[k][1]), 0) * 12;
        if (bar.shape !== "closed") expect(Math.abs(drawn - bar.dims.reduce((s, d) => s + d, 0))).toBeLessThan(1e-3);
      }
  });

  it("keeps each design's bar weight: an abutment's schedule shared out over its parts, not repeated", () => {
    const sched = sources.find((s) => s.designId === "abut-1")!.schedule(hosts[0])!;
    const expected = sched.groups.filter((g) => !g.paid).reduce((s, g) => s + g.count * g.length, 0);
    for (const part of new Set(hosts.filter((h) => h.rebar!.designId === "abut-1").map((h) => h.part))) {
      const here = hosts.filter((h) => h.part === part && h.rebar!.designId === "abut-1");
      const inches = here.reduce((s, h) => s + h.rebar!.bars.reduce((t, x) => t + x.count * x.length, 0), 0);
      expect(inches).toBeCloseTo(expected, 6);
    }
    const col = hosts.find((h) => h.rebar!.designId === "col-1")!;
    // A column gets its whole schedule: the take-off's bar weight (to the rounding of each set's weight).
    const colSched = sources.find((s) => s.designId === "col-1")!.schedule(col)!;
    expect(rebarTotals(col.rebar).weight).toBeCloseTo(colSched.groups.filter((g) => !g.paid).reduce((s, g) => s + groupWeight(g), 0), 0);
  });

  it("gives each span's deck the bars for its own length", () => {
    const decks = hosts.filter((h) => h.rebar!.designKind === "deck-slab");
    for (const d of decks) {
      const box = elementBox(d)!;
      const L = 2 * Math.max(...box.half);
      const longest = Math.max(...d.rebar!.bars.map((x) => x.length / 12));
      expect(longest).toBeLessThanOrEqual(L + 1e-6);
    }
  });

  it("lays the bars inside their host", () => {
    for (const h of hosts)
      for (const bar of h.rebar!.bars) {
        const { origin, u, v, step, drawn } = bar.at;
        expect(drawn).toBeLessThanOrEqual(Math.min(bar.count, 400));
        for (const i of [0, drawn - 1]) {
          const o: V3 = [origin[0] + i * step[0], origin[1] + i * step[1], origin[2] + i * step[2]];
          // The bar's start (a hooked bar's main leg) sits in the concrete; a bar longer than its host runs past it.
          const start = bar.path[bar.shape === "hooked" ? 1 : 0];
          const p: V3 = [o[0] + start[0] * u[0] + start[1] * v[0], o[1] + start[0] * u[1] + start[1] * v[1], o[2] + start[0] * u[2] + start[1] * v[2]];
          expect(inside(h, p, 0.01), `${h.name} ${bar.mark}`).toBe(true);
        }
      }
  });

  it("draws a bar's bending shape from its dimensions", () => {
    expect(barPath({ mark: "501", size: 5, count: 1, length: 120, use: "", callout: "", shape: { kind: "hooked", dims: [12, 96, 12], hooks: 2 } })).toEqual([[0, 1], [0, 0], [8, 0], [8, 1]]);
    expect(barPath({ mark: "401", size: 4, count: 1, length: 60, use: "", callout: "", shape: { kind: "closed", dims: [12, 24], hook: 6 } })).toEqual([[0, 0], [1, 0], [1, 2], [0, 2], [0, 1 / 12]]); // open by two diameters
  });

  // The writer itself: the description through api/_bridge.py into IFC 4.3, and the same bars in an IFC4 file;
  // read back with IfcOpenShell and checked against the schema.
  const python = resolve("python/python.exe");
  it.skipIf(!existsSync(python))("writes IfcReinforcingBar sets, quantity sets and the schedule (IFC 4.3 and IFC4)", () => {
    const dir = mkdtempSync(join(tmpdir(), "allcon-ifc-rebar-"));
    try {
      const desc = join(dir, "bridge.json");
      writeFileSync(desc, JSON.stringify({ ...m, project: "Sample bridge" }));
      const out = execFileSync(python, ["-I", resolve("scripts/ifc-rebar-check.py"), resolve("api"), desc, join(dir, "bridge.ifc")], { encoding: "utf8", timeout: 300_000 });
      const r = JSON.parse(out.trim().split("\n").pop()!);
      // ALLCON_DUMP_REBAR_IFC=folder keeps the written files and the checker's counts there.
      if (process.env.ALLCON_DUMP_REBAR_IFC) {
        cpSync(dir, process.env.ALLCON_DUMP_REBAR_IFC, { recursive: true });
        writeFileSync(join(process.env.ALLCON_DUMP_REBAR_IFC, "check.json"), JSON.stringify({ ...r, hosts: hosts.map((h) => [h.name, h.rebar!.designKind, h.rebar!.bars.length, Math.round(rebarTotals(h.rebar).weight)]) }, null, 1));
      }
      const expectedSets = hosts.reduce((s, h) => s + h.rebar!.bars.length, 0);
      const expectedLb = hosts.reduce((s, h) => s + rebarTotals(h.rebar).weight, 0);
      for (const schema of ["IFC4X3", "IFC4"] as const) {
        const x = r[schema];
        expect(x.errors, schema).toEqual([]);
        expect(x.bars, schema).toBe(schema === "IFC4X3" ? expectedSets : x.bars);
        expect(x.bars).toBeGreaterThan(0);
        expect(x.unaggregated).toBe(0); // every bar in a host
        expect(x.untyped).toBe(0);
        expect(x.withoutQto).toBe(0);
        expect(x.withoutSchedule).toBe(0);
        expect(x.withoutShape).toBe(0);
        expect(x.hostsWithoutReinforcementQto).toBe(0);
      }
      const x = r.IFC4X3;
      expect(x.weightKg / 0.45359237).toBeCloseTo(expectedLb, 0);
      expect(x.concreteWithoutQto).toEqual([]);
      // Concrete volume: the quantity sets add up to the elements' own geometry.
      const vol = m.elements.filter((e) => /oncrete/.test(e.material)).reduce((s, e) => s + profileArea(e) * e.depth, 0);
      expect(x.extrudedConcreteM3 / 0.028316846592).toBeCloseTo(vol, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
