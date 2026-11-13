import { brakingPerLane, superstructureWind, windKz, SITE_WIND_DEFAULTS } from "../girders/substructure-loads";
import type { GirderInputs } from "../girders/prestressed";
import { capCaseLoads, type StmInputs } from "../stm/strut-tie";
import { DesignError } from "../walls/cip";
import { bridgeBraking, type BridgeData, type ColumnLink } from "./column";

// What a pier column takes from its cap's strut-and-tie design: the cap's factored load cases (every
// one, both ways a hammerhead turns), its geometry, and, from the girder designs the cap is loaded
// from, what the loads along the bridge need.

export function columnLinkFrom(stmId: string, stmName: string, i: StmInputs, girders: Map<string, GirderInputs>): ColumnLink {
  const t = i.template;
  if (!t) throw new DesignError("That strut-and-tie design isn't built from a standard pier cap.");
  if (t.kind === "abutment") throw new DesignError("That strut-and-tie design is an abutment cap: pick a pier cap.");
  const capLoads = capCaseLoads(i);
  const source = capLoads ? capLoads.cases : i.cases;
  const xOf = (label: string) => {
    const nd = i.nodes.find((x) => x.label === label.trim());
    if (!nd) throw new DesignError(`The cap's load node ${label} isn't in its model.`);
    return nd.x;
  };
  const cases = source.map((c) => ({ name: c.name, loads: c.loads.map((l) => ({ x: xOf(l.node), fx: l.fx, fy: l.fy })) }));
  // Service I for the foundation's settlement and crack control (Table 3.4.1-1): each bearing's DC, DW
  // and the most live load reaching it (with IM and the multiple presence factor), unfactored.
  if (capLoads) cases.push({ name: "Service I (DC + DW + LL+IM, the most live load at each bearing)", loads: capLoads.bearingLoads.map((b) => ({ x: b.x, fx: 0, fy: -(b.dc + b.dw + b.ll) })) });
  return {
    stmId,
    stmName,
    kind: t.kind,
    columns: [...t.columns].sort((a, b) => a - b),
    columnWidth: t.columnWidth,
    capLength: t.length,
    capDepth: t.depth,
    capWidth: t.capWidth,
    fcCap: i.fc,
    cases,
    wind: !!i.girders?.enabled && !!i.girders.wind?.enabled,
    bridge: i.girders?.enabled ? bridgeData(i, girders) : null,
    refreshed: new Date().toISOString(),
  };
}

function bridgeData(i: StmInputs, girders: Map<string, GirderInputs>): BridgeData | null {
  const sides = [i.girders?.back, i.girders?.ahead].filter((s): s is NonNullable<typeof s> => !!s);
  if (!sides.length) return null;
  const ids = [...new Set(sides.map((s) => s.designId))];
  const designs = ids.map((id) => girders.get(id)).filter((d): d is GirderInputs => !!d);
  if (!designs.length) return null;
  const spans = designs.flatMap((d) => [d.L, ...d.extraSpans.map((s) => s.L)]);
  const length = spans.reduce((p, L) => p + L, 0);
  const roadway = Math.min(...sides.map((s) => (s.n - 1) * s.S + 2 * s.overhang - 2 * s.barrierWidth));
  const lanes = Math.max(1, Math.floor(roadway / 12));
  const per = brakingPerLane(length);
  const br = bridgeBraking(per.perLane, lanes);
  const d0 = designs[0];
  const site = { ...SITE_WIND_DEFAULTS, ...(d0.site ?? {}) };
  const w = superstructureWind(d0, site);
  return {
    names: [...new Set(sides.map((s) => s.name))].join(", "),
    length,
    maxSpan: Math.max(...spans),
    lanes,
    braking: br.force,
    brakingBasis: `${per.governs}, ${per.perLane.toFixed(1)} kip a lane on ${length.toFixed(0)} ft, ${br.lanes} lane${br.lanes > 1 ? "s" : ""} with m = ${[1.2, 1, 0.85, 0.65][Math.min(3, br.lanes - 1)]}`,
    depth: w.depth,
    lineIII: w.strengthIII?.line ?? null,
    lineV: w.strengthV.line,
    V: site.V,
    Kz: windKz(site.Z, site.exposure),
    Z: site.Z,
  };
}
