import { DesignError, type Check } from "../walls/cip";
import { agencyOf, isPayCode, type Agency } from "../rebar/cdot-items";
import { bar, crackGrid, nodeFace, rcTie, type Confinement, type FaceType, type NodeType } from "./aashto";
import { development, type Coating } from "./anchorage";
import { hookDimensions } from "./detailing";
import { ledgeChecks, type LedgeCheck } from "./ledge";
import { capLoadCases, type CapLoads, type GirderLink, type GirderSide } from "./cap-loads";
import { candidates, polygon, visible, type Pt } from "./geometry";
import { bandFits, barsFit, exitPoint, insideWithin, SINGULAR, templateZones, zoneOverlap, type Zone } from "./nodal-zones";
import { templateOf, type StmTemplate } from "./templates";
import { angleScreen, crossings } from "./model";
import { optimize, type LpSolver } from "./optimizer";
import { diagonalCrackScreen } from "./serviceability";

// A planar strut-and-tie model of a reinforced concrete D-region (a pier cap or an abutment),
// AASHTO LRFD 10th Edition 5.8.2: the model's forces in equilibrium (the engineer's layout, or one
// found by layout optimization), the 25° strut-tie angle limit (5.8.2.2), the ties (5.8.2.4), the
// node faces with nonhydrostatic nodes (5.8.2.5), the crack-control grid (5.8.2.6), the ties'
// anchorage (5.10.8.2), and the diagonal-cracking screen (C5.8.2.2). Geometry in feet, details in
// inches, forces in kips (y up, loads down negative). Normalweight, nonprestressed concrete only.

export type StmNode = { label: string; x: number; y: number }; // ft
export type StmSupport = { node: string; x: boolean; y: boolean; upwardOnly: boolean };
export type StmLoad = { node: string; fx: number; fy: number }; // kip
export type StmCase = { name: string; loads: StmLoad[] };
export type TieEnd = { node: string; kind: "straight" | "hook"; available: number; clearCover: number; clearSpacing: number; topCast: boolean; coating: Coating };
export type StmTie = { member: string; barSize: number; bars: number; ends: TieEnd[] };
export type StmFace = { source: string; type: FaceType; width: number }; // source: a member "A-B" or "external"
export type StmNodeCheck = { node: string; thickness: number; faces: StmFace[]; confinement: { A1: number; A2: number; basis: string } | null };

export type StmInputs = {
  component: "pier_cap" | "abutment" | "other";
  fc: number; // ksi
  fy: number; // ksi
  b: number; // in, the member's width (out of plane)
  outline: Pt[]; // ft
  nodes: StmNode[];
  supports: StmSupport[];
  cases: StmCase[]; // factored, strength limit state
  layout: "entered" | "optimized";
  members: string[]; // "A-B", when entered
  study: { tension: number; compression: number }; // ksi, exploratory (optimized layout only)
  grid: { provided: boolean; Av: number; sv: number; Ah: number; sh: number; d: number };
  ties: StmTie[];
  nodeChecks: StmNodeCheck[];
  service: { check: boolean; V: number; a: number; d: number };
  /** Loads from girder designs (lane placement on the cap); when enabled they replace `cases`. */
  girders: GirderLink | null;
  /** The standard cap the model was last built from (its dimensions, to rebuild it), if any. */
  template?: StmTemplate | null;
  /** The column's boundary below the cap: reactions from statics and the solver (default), or kept near the column's linear stress. */
  columnBoundary?: "solver" | "linear-stress";
  /** A standard cap's node faces, tie anchorage and fit: worked out from its geometry (default), or as entered under Ties and Node faces. */
  nodeGeometry?: "auto" | "entered";
  /** A standard cap's B-regions (every load 2h or more from the supports, 5.8.2.1) also checked by the sectional method (5.6, 5.7). */
  sectional?: boolean;
  /** The pay items its quantities go to in the project's line items, and the heading they went under. */
  /** The quantities' pay items, the original ground (ft) for the M-206-2 excavation, and the line items' heading. */
  payItems?: { agency?: Agency; concrete: string; rebar: string; excavation?: string; backfill?: string; "soil-reinforcement"?: string; refill?: string; ground?: number; headingId?: string | null };
};

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * The defaults: a cantilever bent cap carrying two factored loads (2005 and 926 kip) from four
 * girders, f'c = 6 ksi, 8 ft wide and 8.5 ft deep, sloping 0.0516 ft/ft, modeled one column width
 * down into the column with a single truss panel in the cantilever.
 */
export const STM_DEFAULTS: StmInputs = (() => {
  const s = 0.0516;
  const depth = 8.5 * Math.sqrt(1 + s * s);
  const y0 = depth + 10 * s;
  const tie = (5.16 / 12) * Math.sqrt(1 + s * s);
  const top = (x: number) => y0 - s * x;
  const yE = top(9.69) - depth + (2.23 / 12) * Math.sqrt(1 + s * s);
  const node = (label: string, x: number, y: number): StmNode => ({ label, x, y: r4(y) });
  const end = (n: string, available: number): TieEnd => ({ node: n, kind: "straight", available, clearCover: 2.75, clearSpacing: 8.49, topCast: true, coating: "uncoated" });
  return {
    component: "pier_cap",
    fc: 6,
    fy: 60,
    b: 96,
    outline: [[0, -10], [10, -10], [10, 0], [28.42, r4(-s * 18.42)], [28.42, r4(top(28.42))], [0, r4(y0)]],
    nodes: [node("A", 0.67, top(0.67) - tie), node("B", 6.97, top(6.97) - tie), node("C", 22.99, top(22.99) - tie), node("D", 7.52, yE), node("E", 9.69, yE), node("A'", 0.67, -10), node("D'", 7.52, -10), node("E'", 9.69, -10)],
    supports: ["A'", "D'", "E'"].map((n) => ({ node: n, x: true, y: true, upwardOnly: false })),
    cases: [{ name: "Strength I", loads: [{ node: "B", fx: 0, fy: -2005 }, { node: "C", fx: 0, fy: -926 }] }],
    layout: "entered",
    members: ["A-B", "B-C", "A-A'", "A-D", "B-D", "D-E", "C-E", "D-D'", "E-E'"],
    study: { tension: 60, compression: 5 },
    grid: { provided: true, Av: 1.76, sv: 6, Ah: 1.58, sh: 5, d: 96.8 },
    ties: [
      { member: "A-B", barSize: 11, bars: 20, ends: [] },
      { member: "B-C", barSize: 11, bars: 20, ends: [end("C", 91.3)] },
      { member: "A-A'", barSize: 11, bars: 20, ends: [] },
    ],
    nodeChecks: [
      { node: "B", thickness: 48.2, faces: [{ source: "external", type: "bearing", width: 48.2 }, { source: "B-D", type: "interface", width: 49.1 }], confinement: { A1: 48.2 ** 2, A2: 96 ** 2, basis: "The 96 in square of the cap's width, concentric with the 48.2 in square effective bearing (Article 5.6.5)" } },
      { node: "C", thickness: 39.1, faces: [{ source: "external", type: "bearing", width: 39.1 }, { source: "C-E", type: "interface", width: 29.1 }], confinement: { A1: 39.1 ** 2, A2: 96 ** 2, basis: "The 96 in square of the cap's width, concentric with the 39.1 in square effective bearing (Article 5.6.5)" } },
      { node: "E", thickness: 96, faces: [{ source: "E-E'", type: "bearing", width: 7.5 }, { source: "D-E", type: "back", width: 4.9 }, { source: "C-E", type: "interface", width: 7.9 }], confinement: null },
    ],
    service: { check: true, V: 689, a: 155.9, d: 96.8 },
    girders: null,
  };
})();

function girderSideOf(v: unknown): GirderSide | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const pair = (p: unknown) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return { interior: numOr(o.interior, 0), exterior: numOr(o.exterior, 0) };
  };
  return {
    designId: str(s.designId),
    name: str(s.name, "Girder design"),
    span: numOr(s.span, 0),
    n: Math.max(1, Math.round(numOr(s.n, 1))),
    S: numOr(s.S, 8),
    overhang: numOr(s.overhang, 3),
    barrierWidth: numOr(s.barrierWidth, 1.5),
    skew: numOr(s.skew, 0),
    L: numOr(s.L, 0),
    continuous: s.continuous === true,
    dc: pair(s.dc),
    dw: pair(s.dw),
    ...(s.end === "start" || s.end === "end" ? { end: s.end } : {}),
    // Copied from the girder design by girderSide: kept as saved (numbers checked where used).
    ...(s.liveContinuous && typeof s.liveContinuous === "object" ? { liveContinuous: s.liveContinuous as GirderSide["liveContinuous"] } : {}),
    ...(s.wind && typeof s.wind === "object" ? { wind: s.wind as GirderSide["wind"] } : {}),
    ...(typeof s.brakingPerLane === "number" && Number.isFinite(s.brakingPerLane) ? { brakingPerLane: s.brakingPerLane } : {}),
  };
}

function windOf(v: unknown) {
  const w = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { enabled: w.enabled === true };
}

function girderLinkOf(v: unknown): GirderLink | null {
  if (!v || typeof v !== "object") return null;
  const g = v as Record<string, unknown>;
  return {
    enabled: g.enabled === true,
    wind: windOf(g.wind),
    back: girderSideOf(g.back),
    ahead: girderSideOf(g.ahead),
    x0: numOr(g.x0, 0),
    reverse: g.reverse === true,
    loadNodes: Array.isArray(g.loadNodes) ? (g.loadNodes as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 150) : [],
    selfWeight: g.selfWeight !== false,
    soffit: numOr(g.soffit, 0),
    wc: numOr(g.wc, 0.15),
  };
}

// ----- inputs as saved -----

const numOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v.slice(0, 200) : d);
const list = <T>(v: unknown, f: (x: Record<string, unknown>) => T, max = 200): T[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object").slice(0, max).map((x) => f(x as Record<string, unknown>)) : []);

/** A strut-and-tie design's inputs as saved, filled in from the defaults. */
export function stmInputs(saved: unknown): StmInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  if (Object.keys(s).length === 0) return structuredClone(STM_DEFAULTS);
  const d = STM_DEFAULTS;
  const g = (s.grid ?? {}) as Record<string, unknown>;
  const sv = (s.service ?? {}) as Record<string, unknown>;
  const st = (s.study ?? {}) as Record<string, unknown>;
  return {
    component: s.component === "abutment" || s.component === "other" ? s.component : "pier_cap",
    fc: numOr(s.fc, d.fc),
    fy: numOr(s.fy, d.fy),
    b: numOr(s.b, d.b),
    outline: Array.isArray(s.outline) ? (s.outline as unknown[]).filter((p): p is Pt => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v))).slice(0, 100) : d.outline,
    nodes: list(s.nodes, (n) => ({ label: str(n.label), x: numOr(n.x, 0), y: numOr(n.y, 0) }), 150),
    supports: list(s.supports, (x) => ({ node: str(x.node), x: x.x === true, y: x.y === true, upwardOnly: x.upwardOnly === true })),
    cases: list(s.cases, (c) => ({ name: str(c.name, "Case"), loads: list(c.loads, (l) => ({ node: str(l.node), fx: numOr(l.fx, 0), fy: numOr(l.fy, 0) })) }), 20),
    layout: s.layout === "optimized" ? "optimized" : "entered",
    members: Array.isArray(s.members) ? (s.members as unknown[]).filter((m): m is string => typeof m === "string").slice(0, 2000) : [],
    study: { tension: numOr(st.tension, d.study.tension), compression: numOr(st.compression, d.study.compression) },
    grid: { provided: g.provided !== false, Av: numOr(g.Av, d.grid.Av), sv: numOr(g.sv, d.grid.sv), Ah: numOr(g.Ah, d.grid.Ah), sh: numOr(g.sh, d.grid.sh), d: numOr(g.d, d.grid.d) },
    ties: list(s.ties, (t) => ({
      member: str(t.member),
      barSize: numOr(t.barSize, 11),
      bars: numOr(t.bars, 1),
      ends: list(t.ends, (e) => ({ node: str(e.node), kind: e.kind === "hook" ? "hook" : "straight", available: numOr(e.available, 0), clearCover: numOr(e.clearCover, 2), clearSpacing: numOr(e.clearSpacing, 6), topCast: e.topCast === true, coating: (["uncoated", "epoxy", "galvanized", "dual"] as const).find((c) => c === e.coating) ?? "uncoated" }), 2),
    })),
    nodeChecks: list(s.nodeChecks, (n) => {
      const c = n.confinement as Record<string, unknown> | null | undefined;
      return {
        node: str(n.node),
        thickness: numOr(n.thickness, d.b),
        faces: list(n.faces, (f) => ({ source: str(f.source, "external"), type: f.type === "back" || f.type === "interface" ? f.type : "bearing", width: numOr(f.width, 0) }), 12),
        confinement: c && typeof c === "object" ? { A1: numOr(c.A1, 0), A2: numOr(c.A2, 0), basis: str(c.basis) } : null,
      };
    }),
    service: { check: sv.check === true, V: numOr(sv.V, d.service.V), a: numOr(sv.a, d.service.a), d: numOr(sv.d, d.service.d) },
    girders: girderLinkOf(s.girders),
    ...(s.template ? { template: templateOf(s.template) } : {}),
    ...(s.columnBoundary === "linear-stress" ? { columnBoundary: "linear-stress" as const } : {}),
    ...(s.nodeGeometry === "entered" ? { nodeGeometry: "entered" as const } : {}),
    ...(s.sectional === true ? { sectional: true } : {}),
    ...(s.payItems && typeof s.payItems === "object"
      ? (() => {
          const p = s.payItems as Record<string, unknown>;
          const code = (v: unknown, d: string) => (isPayCode(v) ? v : d);
          const earth = Object.fromEntries((["excavation", "backfill", "soil-reinforcement", "refill"] as const).flatMap((k) => (isPayCode(p[k]) ? [[k, p[k]]] : [])));
          const ground = typeof p.ground === "number" && Number.isFinite(p.ground) && p.ground >= 0 ? { ground: p.ground } : {};
          return { payItems: { agency: agencyOf(p.agency), concrete: code(p.concrete, "601-03040"), rebar: code(p.rebar, "602-00020"), ...earth, ...ground, headingId: typeof p.headingId === "string" ? p.headingId : null } };
        })()
      : {}),
  };
}

/** The cap's loads from the girder designs, placed lane by lane across the cap (null where the cases are as entered). */
export function capCaseLoads(i: StmInputs): CapLoads | null {
  if (!i.girders?.enabled) return null;
  const vertical = i.supports.filter((s) => s.y).map((s) => i.nodes.find((n) => n.label === s.node.trim())?.x).filter((x): x is number => x !== undefined);
  const supportX = vertical.length ? vertical.reduce((s, x) => s + x, 0) / vertical.length : 0;
  // A standard cap's arms beyond its outer column faces: their service shear for the diagonal-cracking screen.
  const t = i.template;
  const faces: { x: number; side: -1 | 1; label: string }[] = [];
  if (t) {
    const cols = [...t.columns].sort((a, b) => a - b);
    const fl = cols[0] - t.columnWidth / 2;
    const fr = cols[cols.length - 1] + t.columnWidth / 2;
    if (t.bearings.some((b) => b.x < fl)) faces.push({ x: fl, side: -1, label: t.kind === "hammerhead" ? "Left arm" : "Left overhang" });
    if (t.bearings.some((b) => b.x > fr)) faces.push({ x: fr, side: 1, label: t.kind === "hammerhead" ? "Right arm" : "Right overhang" });
  }
  // A bent's spans between columns: their service shear at each column face.
  const spans: { a: number; b: number; faceA: number; faceB: number; label: string }[] = [];
  if (t?.kind === "multicolumn") {
    const cols = [...t.columns].sort((a, b) => a - b);
    for (let k = 0; k + 1 < cols.length; k++) if (t.bearings.some((b) => b.x > cols[k] && b.x < cols[k + 1])) spans.push({ a: cols[k], b: cols[k + 1], faceA: cols[k] + t.columnWidth / 2, faceB: cols[k + 1] - t.columnWidth / 2, label: `Span ${k + 1}` });
  }
  return capLoadCases(i.girders, i.nodes, i.outline, i.b, supportX, faces, spans);
}

// ----- the design -----

export type MemberResult = { key: string; a: number; b: number; length: number; tension: number; compression: number; active: boolean; role: "tie" | "strut" | "zero"; tensionCase: number | null; compressionCase: number | null };

/** What a physical check's status is: checked (and its verdict), or why it isn't. Missing checks never count as passing. */
export type Coverage = { item: string; group: "tie" | "anchorage" | "node" | "strut" | "geometry" | "grid" | "service"; status: "pass" | "fail" | "not-checked" | "missing-input" | "not-implemented" | "not-required"; detail: string };

/**
 * Target reactions for the "linear-stress" column boundary: per case, the column's linear stress
 * P/A ± Mc/I across its width (per unit depth, P and M from the case's loads about the column's
 * centerline), integrated over each vertical support's tributary width. Null for the "solver"
 * boundary or a model without a single template column.
 */
function columnBoundaryTargets(i: StmInputs, supports: [number, number][], loads: Pt[][], labels: string[]) {
  const t = i.template;
  if (i.columnBoundary !== "linear-stress" || !t || t.kind !== "hammerhead" || t.columns.length !== 1) return null;
  const c = t.columns[0];
  const w = t.columnWidth;
  const vertical = supports.map(([n, ax], r) => ({ r, ax, x: i.nodes[n].x })).filter((s) => s.ax === 1);
  if (vertical.length < 2) return null;
  const sorted = [...vertical].sort((p, q) => p.x - q.x);
  const edges = sorted.map((s, k) => ({ r: s.r, lo: k === 0 ? -w / 2 : (sorted[k - 1].x + s.x) / 2 - c, hi: k === sorted.length - 1 ? w / 2 : (s.x + sorted[k + 1].x) / 2 - c }));
  const targets = loads.map((load) => {
    const P = -load.reduce((s, f) => s + f[1], 0);
    const M = -load.reduce((s, f, n) => s + f[1] * (i.nodes[n].x - c), 0); // kip·ft, + turning toward larger x
    const row: (number | null)[] = supports.map(() => null);
    for (const e of edges) row[e.r] = (P * (e.hi - e.lo)) / w + (6 * M * (e.hi ** 2 - e.lo ** 2)) / w ** 3;
    return row;
  });
  return { targets, supports: sorted.map((s) => labels[supports[s.r][0]]) };
}
export type NodeFaceResult = { node: string; source: string; type: FaceType; width: number; thickness: number; area: number; nodeType: NodeType; case: number; demand: number; nu: number; m: number; capacity: number; ok: boolean; confinement: { A1: number; A2: number; basis: string } | null; basis: string | null; steel?: number };
export type TieEndResult = { node: string; required: number; available: number; ok: boolean; kind: string; basic: number; confinement: number; location: number; coatingFactor: number; radius: number; Fh: number; clearCover: number; clearSpacing: number; coating: Coating; basis: string | null };
export type TieResult = { member: string; barSize: number; bars: number; demand: number; area: number; capacity: number; requiredArea: number; ok: boolean; ends: TieEndResult[] };
export type ServiceResult = { label: string; V: number; a: number; d: number; b: number; Vcr: number; ok: boolean; basis: string };
const SIN10 = Math.sin((10 * Math.PI) / 180);

/** A member as entered, "A-B", "A-B:strut" (compression only) or "A-B:tie" (tension only). */
export function roleOf(entry: string) {
  const [key, role] = entry.split(":").map((s) => s.trim());
  const r = (role ?? "").toLowerCase();
  return { key, sign: r === "strut" || r === "s" ? -1 : r === "tie" || r === "t" ? 1 : 0 };
}

/** The member key as entered, read either way round. */
const keyOf = (labels: string[], a: number, b: number) => `${labels[a]}-${labels[b]}`;

export async function designStm(i: StmInputs, solve: LpSolver) {
  const labels = i.nodes.map((n) => n.label.trim());
  if (labels.some((l) => !l)) throw new DesignError("Every node needs a label.");
  if (new Set(labels).size !== labels.length) throw new DesignError("Two nodes have the same label.");
  const at = (label: string, what: string) => {
    const k = labels.indexOf(label.trim());
    if (k < 0) throw new DesignError(`${what} refers to node "${label}", which isn't in the list.`);
    return k;
  };
  const pair = (entry: string) => {
    const key = roleOf(entry).key;
    const parts = key.split("-");
    // Labels may contain "-" only if unambiguous: try every split.
    for (let s = 1; s < parts.length; s++) {
      const a = labels.indexOf(parts.slice(0, s).join("-").trim());
      const b = labels.indexOf(parts.slice(s).join("-").trim());
      if (a >= 0 && b >= 0) return a < b ? ([a, b] as [number, number]) : ([b, a] as [number, number]);
    }
    throw new DesignError(`Member "${key}" doesn't join two listed nodes.`);
  };
  if (!(i.b > 0)) throw new DesignError("Give the member's width.");
  const nodes: Pt[] = i.nodes.map((n) => [n.x * 12, n.y * 12]);
  const outline = polygon(i.outline.map(([x, y]) => [x * 12, y * 12] as Pt), "Concrete outline");

  let members: [number, number][];
  if (i.layout === "optimized") members = candidates(nodes, outline);
  else {
    members = i.members.map(pair);
    const seen = new Set<string>();
    for (const [a, b] of members) {
      if (seen.has(`${a}:${b}`)) throw new DesignError(`Member ${keyOf(labels, a, b)} is listed twice.`);
      seen.add(`${a}:${b}`);
      if (!visible(nodes[a], nodes[b], outline, [])) throw new DesignError(`Member ${keyOf(labels, a, b)} passes outside the concrete.`);
      const d: Pt = [nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1]];
      const dd = d[0] * d[0] + d[1] * d[1];
      const through = nodes.findIndex((p, k) => {
        if (k === a || k === b) return false;
        const v: Pt = [p[0] - nodes[a][0], p[1] - nodes[a][1]];
        const t = (v[0] * d[0] + v[1] * d[1]) / dd;
        // Within 0.05 in of the member's line, between its ends: coordinates are entered rounded.
        return Math.abs(d[0] * v[1] - d[1] * v[0]) / Math.sqrt(dd) <= 0.05 && t > 1e-9 && t < 1 - 1e-9;
      });
      if (through >= 0) throw new DesignError(`Member ${keyOf(labels, a, b)} runs through node ${labels[through]}: split it there.`);
    }
    candidates(nodes, outline); // validates every node lies in the concrete
  }

  const supports: [number, number][] = [];
  const upward: number[] = [];
  for (const s of i.supports) {
    const k = at(s.node, "A support");
    if (s.x) supports.push([k, 0]);
    if (s.y) {
      if (s.upwardOnly) upward.push(supports.length);
      supports.push([k, 1]);
    }
  }
  if (!supports.length) throw new DesignError("The model needs supports.");
  const capLoads = capCaseLoads(i);
  let cases = capLoads ? capLoads.cases : i.cases;
  // A hammerhead model is laid out for one direction (FHWA's way): cases turning the column the
  // other way need a model laid out for that side.
  const reversed: string[] = [];
  const tpl = i.template;
  if (tpl?.kind === "hammerhead" && tpl.layoutSign && tpl.columns.length === 1) {
    const c = tpl.columns[0];
    const w = tpl.columnWidth;
    const keep = cases.filter((k) => {
      let P = 0;
      let M = 0;
      for (const l of k.loads) {
        const n = i.nodes.find((x) => x.label === l.node.trim());
        if (!n) continue;
        P += -l.fy;
        M += -l.fy * (n.x - c);
      }
      // Turning the other way: a moment against the layout's side beyond a whisker (0.1% of P times the width).
      const other = tpl.layoutSign! * M < -1e-3 * Math.abs(P) * w;
      if (other) reversed.push(k.name);
      return !other;
    });
    if (!keep.length) throw new DesignError(`Every load case turns the column toward the ${tpl.layoutSign > 0 ? "left" : "right"}: build the model laid out for that side (Start from a standard cap, Lay out for).`);
    cases = keep;
  }
  if (!cases.length) throw new DesignError("Add a load case.");
  const loads: Pt[][] = cases.map((c) => {
    const f: Pt[] = nodes.map(() => [0, 0]);
    for (const l of c.loads) {
      const k = at(l.node, `Load case "${c.name}"`);
      f[k] = [f[k][0] + l.fx, f[k][1] + l.fy];
    }
    return f;
  });

  const signs = i.layout === "entered" ? i.members.map((m) => roleOf(m).sign) : [];
  // The column's boundary (an assumption, compared in the report): reactions left to statics and the
  // solver ("solver"), or held as close as statics allows to the column's linear stress, P/A ± Mc/I,
  // lumped to each support over its tributary width ("linear-stress", FHWA's assumption at the
  // disturbed region's boundary). Only for a single-column template, where the column is known.
  const boundary = columnBoundaryTargets(i, supports, loads, labels);
  const solved = await optimize(nodes, members, supports, loads, solve, i.study.tension, i.study.compression, upward, signs, boundary?.targets ?? null);
  if (!solved.ok) {
    if (loads.some((l) => l.some((f) => Math.abs(f[0]) > 1e-9)) && i.template?.kind === "hammerhead")
      throw new DesignError(`${solved.message} The wind's horizontal force needs a path into the column: rebuild the model from the standard cap (it restrains the column where it meets the cap).`);
    throw new DesignError(solved.message);
  }
  const zeroBelow = 1e-9 * Math.max(1, ...loads.flat(2).map(Math.abs)); // the solver's round-off: no force
  const memberResults: MemberResult[] = members.map(([a, b], k) => {
    const forces = solved.forces.map((f) => (Math.abs(f[k]) > zeroBelow ? f[k] : 0));
    const tension = Math.max(0, ...forces);
    const compression = Math.max(0, ...forces.map((f) => -f));
    const active = solved.activeIndex.includes(k);
    // The case each extreme comes from (nonsimultaneous: a member's tension and compression maxima, and different members', may come from different cases).
    const tensionCase = tension > 0 ? forces.indexOf(tension) : null;
    const compressionCase = compression > 0 ? forces.indexOf(-compression) : null;
    return { key: keyOf(labels, a, b), a, b, length: Math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1]), tension, compression, active, role: !active ? "zero" : tension >= compression ? "tie" : "strut", tensionCase, compressionCase };
  });

  // Each case on its own: equilibrium checked here from the member forces, reactions and loads,
  // independently of the solver's own check (nodal residuals, and the whole model's force and
  // moment balance), and its strut-tie angles.
  const perCase = cases.map((c, ci) => {
    const sum = loads[ci].map((f) => [f[0], f[1]]);
    members.forEach(([a, b], k) => {
      const len = memberResults[k].length;
      const u = [(nodes[b][0] - nodes[a][0]) / len, (nodes[b][1] - nodes[a][1]) / len];
      const q = solved.forces[ci][k];
      for (const ax of [0, 1]) {
        sum[a][ax] += u[ax] * q;
        sum[b][ax] -= u[ax] * q;
      }
    });
    supports.forEach(([node, ax], r) => (sum[node][ax] += solved.reactions[ci][r]));
    const nodal = Math.max(...sum.map((f) => Math.max(Math.abs(f[0]), Math.abs(f[1]))));
    // Whole model: Σ loads + Σ reactions, and their moment about the origin (kip, kip·ft).
    let Fx = 0;
    let Fy = 0;
    let M = 0;
    loads[ci].forEach((f, n) => {
      Fx += f[0];
      Fy += f[1];
      M += (nodes[n][0] * f[1] - nodes[n][1] * f[0]) / 12;
    });
    supports.forEach(([node, ax], r) => {
      const R = solved.reactions[ci][r];
      if (ax === 0) {
        Fx += R;
        M -= (nodes[node][1] * R) / 12;
      } else {
        Fy += R;
        M += (nodes[node][0] * R) / 12;
      }
    });
    const scale = Math.max(1, ...loads[ci].flat().map(Math.abs));
    const ang = angleScreen(nodes, solved.active, [solved.activeIndex.map((k) => solved.forces[ci][k])]);
    return {
      name: c.name,
      applied: -loads[ci].reduce((s, f) => s + f[1], 0),
      reactions: solved.reactions[ci],
      equilibrium: { nodal, Fx, Fy, M, ok: nodal <= 1e-6 * scale && Math.abs(Fx) <= 1e-6 * scale && Math.abs(Fy) <= 1e-6 * scale && Math.abs(M) <= 1e-4 * scale },
      smallestAngle: ang.smallest,
      angleOk: ang.ok,
      angleFlags: ang.flags.length,
    };
  });
  const pairKey = (key: string) => {
    const [a, b] = pair(key);
    return `${a}:${b}`;
  };
  const memberIndex = (key: string) => {
    const [a, b] = pair(key);
    const k = members.findIndex((m) => m[0] === a && m[1] === b);
    if (k < 0) throw new DesignError(`Member ${key} isn't in the model.`);
    return k;
  };

  const checks: Check[] = [];
  const warnings: string[] = [...(capLoads?.warnings ?? [])];
  if (reversed.length)
    warnings.push(
      `${reversed.length} load case${reversed.length > 1 ? "s turn" : " turns"} the column toward the ${i.template!.layoutSign! > 0 ? "left" : "right"}. This model is laid out for cases turning it toward the ${i.template!.layoutSign! > 0 ? "right" : "left"}, so ${reversed.length > 1 ? "they are" : "it is"} left out here: check ${reversed.length > 1 ? "them" : "it"} in a second design built with "Lay out for: ${i.template!.layoutSign! > 0 ? "left" : "right"}".`,
    );
  // AASHTO 5.8.2.1: strut-and-tie suits loads within about twice the depth of their support.
  if (i.template) {
    const t = i.template;
    const far = t.bearings.filter((b) => Math.min(...t.columns.map((c) => Math.abs(c - b.x) - t.columnWidth / 2)) > 2 * t.depth);
    if (far.length) warnings.push(`Bearings at ${far.map((b) => `${b.x} ft`).join(", ")} are more than twice the cap's depth from a column face. That part of the cap is not a disturbed region; sectional design (AASHTO 5.7) may suit it better (AASHTO 5.8.2.1).`);
  }

  // The loads as applied, for the sketch: at the girders' bearings (Strength I, the most live load), or at the nodes.
  const topAt = (x: number) => {
    const ys: number[] = [];
    i.outline.forEach((p, j) => {
      const q = i.outline[(j + 1) % i.outline.length];
      if ((p[0] <= x && q[0] >= x) || (q[0] <= x && p[0] >= x)) ys.push(p[0] === q[0] ? Math.max(p[1], q[1]) : p[1] + ((x - p[0]) * (q[1] - p[1])) / (q[0] - p[0]));
    });
    return ys.length ? Math.max(...ys) : 0;
  };
  const appliedLoads: { x: number; y: number; P: number; label: string; detail?: string }[] = capLoads
    ? capLoads.bearingLoads.map((b) => ({ x: b.x * 12, y: topAt(b.x) * 12, P: b.strength, label: b.label, detail: `DC ${b.dc.toFixed(1)}, DW ${b.dw.toFixed(1)}, LL+IM ${b.ll.toFixed(1)} kip` }))
    : nodes.flatMap((p, k) => {
        const P = Math.max(0, ...loads.map((l) => -l[k][1]));
        return P > 0 ? [{ x: p[0], y: Math.max(p[1], topAt(p[0] / 12) * 12), P, label: labels[k] }] : [];
      });
  const activeForces = solved.forces.map((f) => solved.activeIndex.map((k) => f[k]));
  const angles = angleScreen(nodes, solved.active, activeForces);
  if (angles.smallest !== null)
    checks.push({ id: "angle", name: "Strut-tie angles greater than 25°", demand: 25, capacity: angles.smallest, unit: "deg", ok: angles.ok, ref: "AASHTO 5.8.2.2", note: angles.ok ? undefined : `${angles.flags.length} strut-tie pair(s) at or below 25°: revise the model.` });
  const cross = crossings(nodes, solved.active);
  if (cross.length) warnings.push(`Members ${cross.map(([p, q]) => `${keyOf(labels, ...solved.active[p])} and ${keyOf(labels, ...solved.active[q])}`).join("; ")} cross without a shared node. Add a node where they cross, or revise the model.`);
  if (solved.stability.mechanisms > 0)
    warnings.push(`As a pin-jointed truss the model has ${solved.stability.mechanisms} mechanism(s). It carries these loads in equilibrium, which a strut-and-tie model needs, but check that the surrounding concrete restrains the free motion.`);
  if (i.layout === "optimized") warnings.push("The layout was found by optimization with exploratory study stresses. Review it as an engineer would a hand model before relying on it.");

  // Crack-control grid (5.8.2.6): the table efficiencies need it; without it ν = 0.45.
  let grid = false;
  if (i.grid.provided) {
    const g = crackGrid(i.b, i.grid.d, i.grid.Av, i.grid.sv, i.grid.Ah, i.grid.sh);
    grid = g.ok;
    checks.push({ id: "grid-v", name: "Crack-control grid, vertical: Av/(bw sv) ≥ 0.003", demand: 0.003, capacity: g.rv, unit: "", ok: g.rv >= 0.003, ref: "AASHTO Eq. 5.8.2.6-1" });
    checks.push({ id: "grid-h", name: "Crack-control grid, horizontal: Ah/(bw sh) ≥ 0.003", demand: 0.003, capacity: g.rh, unit: "", ok: g.rh >= 0.003, ref: "AASHTO Eq. 5.8.2.6-2" });
    checks.push({ id: "grid-s", name: "Crack-control grid spacing, d/4 and 12 in or less", demand: Math.max(i.grid.sv, i.grid.sh), capacity: g.maxSpacing, unit: "in", ok: Math.max(i.grid.sv, i.grid.sh) <= g.maxSpacing, ref: "AASHTO 5.8.2.6" });
    if (!g.ok) warnings.push("The crack-control grid falls short of Article 5.8.2.6, so the nodes are checked with ν = 0.45.");
  } else if (i.component !== "other") warnings.push("No crack-control grid is given. Article 5.8.2.6 exempts only slabs and footings, so provide the grid in a pier cap or abutment. The nodes are checked with ν = 0.45.");

  // What each physical check covers, member by member and node by node; unchecked items stay visible.
  const coverage: Coverage[] = [];

  // A standard cap's finite geometry, worked out from its dimensions: each node's zone, and the
  // faces of the members meeting it, case by case (5.8.2.5.2, Figures 5.8.2.2-1 and C5.8.2.2-4).
  const T = i.template ?? null;
  const auto = !!T && i.nodeGeometry !== "entered" && i.layout === "entered";
  const supportNodes = new Set(supports.map(([s]) => s));
  const zones: Zone[] | null = auto ? templateZones(T!, nodes, labels, i.nodeChecks, supportNodes, i.fc, i.fy) : null;
  const scaleAll = Math.max(1, ...loads.flat(2).map(Math.abs));
  const tol = 1e-7 * scaleAll;
  const unitFrom = (n: number, k: number): Pt => {
    const [a, b] = members[k];
    const o = a === n ? b : a;
    const len = memberResults[k].length;
    return [(nodes[o][0] - nodes[n][0]) / len, (nodes[o][1] - nodes[n][1]) / len];
  };
  const externalAt = (n: number, c: number) => {
    let fx = loads[c][n][0];
    let fy = loads[c][n][1];
    supports.forEach(([node, axis], r) => {
      if (node !== n) return;
      if (axis === 0) fx += solved.reactions[c][r];
      else fy += solved.reactions[c][r];
    });
    return Math.hypot(fx, fy);
  };
  /** The node's type in a case: the distinct tie directions meeting it. */
  const nodeTypeIn = (n: number, c: number): NodeType => {
    const axes: Pt[] = [];
    members.forEach(([a, b], k) => {
      if ((a !== n && b !== n) || solved.forces[c][k] <= 1e-7) return;
      const u = unitFrom(n, k);
      if (!axes.some((w) => Math.abs(u[0] * w[0] + u[1] * w[1]) > 1 - 1e-6)) axes.push(u);
    });
    return axes.length === 0 ? "CCC" : axes.length === 1 ? "CCT" : "CTT";
  };
  type AutoFace = { type: FaceType; width: number; demand: number };
  const faceCache = new Map<string, Map<string, AutoFace>>();
  /** A singular node's faces in a case: the bearing (load, reaction or column strut) on its horizontal face, a chord strut on its vertical face, and each inclined strut's interface, lb sin θ + ha cos θ, the bearing and the face shared among struts by their force components. */
  const autoFaces = (n: number, c: number) => {
    const key = `${n}:${c}`;
    const hit = faceCache.get(key);
    if (hit) return hit;
    const z = zones![n];
    const out = new Map<string, AutoFace>();
    if (z.bearingMember === null) {
      const F = externalAt(n, c);
      if (F > tol) out.set("external", { type: "bearing", width: z.wx, demand: F });
    }
    const bearingKey = z.bearingMember ? pairKey(z.bearingMember) : null;
    // The node's height: a CCT node's with the chord a tie (twice the bars' depth); a CCC node's with the chord a strut (the compression block), 5.8.2.5.2.
    const chordTie = members.some(([a, b], k) => (a === n || b === n) && solved.forces[c][k] > tol && Math.abs(unitFrom(n, k)[1]) < SIN10);
    const ha = chordTie ? z.hy : z.hyC;
    const inclined: { k: number; u: Pt; f: number }[] = [];
    members.forEach(([a, b], k) => {
      if ((a !== n && b !== n) || solved.forces[c][k] >= -tol) return;
      const f = -solved.forces[c][k];
      const u = unitFrom(n, k);
      if (bearingKey === `${a}:${b}` || Math.abs(u[0]) < SIN10) out.set(memberResults[k].key, { type: "bearing", width: z.wx, demand: f });
      else if (Math.abs(u[1]) < SIN10) out.set(memberResults[k].key, { type: "back", width: ha, demand: f });
      else inclined.push({ k, u, f });
    });
    for (const s of inclined) {
      const sameV = inclined.filter((o) => Math.sign(o.u[1]) === Math.sign(s.u[1]));
      const sameH = sameV.filter((o) => Math.sign(o.u[0]) === Math.sign(s.u[0]));
      const sy = Math.abs(s.f * s.u[1]) / sameV.reduce((p, o) => p + Math.abs(o.f * o.u[1]), 0);
      const sx = Math.abs(s.f * s.u[0]) / sameH.reduce((p, o) => p + Math.abs(o.f * o.u[0]), 0);
      out.set(memberResults[s.k].key, { type: "interface", width: z.wx * sy * Math.abs(s.u[1]) + ha * sx * Math.abs(s.u[0]), demand: s.f });
    }
    faceCache.set(key, out);
    return out;
  };
  const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
  const yTop = T ? T.depth * 12 - T.topCover : 0;
  // A hammerhead's column bars: the vertical tie lines at its faces' bars.
  const tieLines = T && T.kind === "hammerhead" ? T.columns.flatMap((c) => [c * 12 - (T.columnWidth * 12) / 2 + Math.max(1, T.columnBarInset), c * 12 + (T.columnWidth * 12) / 2 - Math.max(1, T.columnBarInset)]) : [];
  const ds = T ? bar(T.stirrups.size).db : 0;
  /** Where the bars' centroid leaves the extended nodal zone: at the edge of the strut anchoring them, taken as prismatic (5.8.2.4.2, Figure C5.8.2.4.2-1); measured along the tie from the node. */
  const criticalSection = (n: number, c: number, along: 0 | 1) => {
    if (!SINGULAR.includes(zones![n].kind)) return { crit: 0, via: "" };
    const fm = autoFaces(n, c);
    let best: { key: string; width: number; f: number; s: number } | null = null;
    members.forEach(([a, b], j) => {
      if (a !== n && b !== n) return;
      const face = fm.get(memberResults[j].key);
      if (!face || face.type !== "interface") return;
      if (!best || face.demand > best.f) best = { key: memberResults[j].key, width: face.width, f: face.demand, s: Math.abs(unitFrom(n, j)[along === 0 ? 1 : 0]) };
    });
    const b = best as { key: string; width: number; f: number; s: number } | null;
    if (!b || b.s < 1e-6) return { crit: 0, via: "" };
    const crit = b.width / 2 / b.s;
    return { crit, via: `, plus ${f1(crit)} in inside it to where strut ${b.key}'s edge crosses the bars` };
  };
  /** The development length of a group of bars ending here (the 10th Edition's unified length for the full yield). */
  const develop = (size: number, count: number, kind: "hook" | "straight" | "headed", horizontal: boolean, topCast: boolean) => {
    const fit = barsFit(T!.capWidth, T!.sideCover, T!.stirrups.size, count, size);
    const db = bar(size).db;
    const clearCover = T!.sideCover + ds;
    const clearSpacing = Math.max(0.1, fit.clearSpacing);
    // Heads: net bearing area 4 Ab, clear cover 2 db, center-to-center spacing 3 db or more (5.10.8.2.7).
    const head = kind === "headed" ? { headNetArea: 4 * bar(size).area, headClearCover: 2 * db, headSpacing: clearSpacing + db, astmA970ClassHA: true } : {};
    return { fit, clearCover, clearSpacing, dev: development({ barSize: size, fy: i.fy, fc: i.fc, clearCover, clearSpacing, horizontal, concreteBelow: topCast ? T!.depth * 12 - T!.topCover : 0, coating: "uncoated", kind, ...head }) };
  };
  /** When bars can't develop in the length there is: what would (headed bars, smaller bars of the same area, or a longer end). */
  const fixes = (size: number, count: number, available: number, required: number, horizontal: boolean, topCast: boolean, cover: number | null, endWord: string) => {
    const out: string[] = [];
    if (size <= 11)
      try {
        const h = develop(size, count, "headed", horizontal, topCast).dev.required;
        out.push(`headed bars (heads of 4 Ab, ASTM A970 Class HA) need ${f1(h)} in${h <= available ? ", which fits" : ""}`);
      } catch (e) {
        if (!(e instanceof DesignError)) throw e;
        out.push("headed bars don't meet 5.10.8.2.7 at this spacing (heads need 3 db center to center and 2 db clear cover)");
      }
    const As = count * bar(size).area;
    for (const s of [10, 9, 8, 7].filter((x) => x < size)) {
      const n = Math.ceil(As / bar(s).area - 1e-9);
      const d = develop(s, n, T!.barEnds === "straight" ? "straight" : "hook", horizontal, topCast);
      if (cover !== null && d.fit.centroid > cover + 0.5) continue;
      if (d.dev.required <= available) {
        out.push(`${n} #${s} (the same area) need ${f1(d.dev.required)} in, which fits`);
        break;
      }
    }
    out.push(`or ${endWord} by ${f1(required - available)} in`);
    return `Options: ${out.join("; ")}.`;
  };
  /** A tie's anchorage where its bars stop, from the cap's geometry: a chord's bars run to the cap's end; a hammerhead's column bars run up into the cap or, at a corner, bend into the top bars; stirrups are hooked. */
  const autoAnchor = (spec: StmTie, k: number, n: number): TieEndResult | { note: string } => {
    const u = unitFrom(n, k);
    const tc = memberResults[k].tensionCase ?? 0;
    const kind: "hook" | "straight" = T!.barEnds === "straight" || spec.barSize > 11 ? "straight" : "hook";
    const result = (available: number, horizontal: boolean, topCast: boolean, basis: string, cover: number | null, endWord: string): TieEndResult => {
      const { dev, clearCover, clearSpacing } = develop(spec.barSize, spec.bars, kind, horizontal, topCast);
      const ok = available >= dev.required;
      return { node: labels[n], required: dev.required, available, ok, kind, basic: dev.basic, confinement: dev.confinement, location: dev.location, coatingFactor: dev.coatingFactor, radius: dev.radius, Fh: dev.Fh, clearCover, clearSpacing, coating: "uncoated", basis: ok ? basis : `${basis}. ${fixes(spec.barSize, spec.bars, available, dev.required, horizontal, topCast, cover, endWord)}` };
    };
    if (Math.abs(u[0]) < SIN10) {
      const column = tieLines.some((x) => Math.abs(x - nodes[n][0]) < 3.01); // the template merges nodes within 0.25 ft
      if (!column) return { note: spec.barSize <= 5 ? "Stirrups: anchored by standard hooks around the longitudinal bars (AASHTO 5.10.8.2.6b)." : `Stirrups #${spec.barSize}: a standard stirrup hook around a longitudinal bar plus an embedment between mid-height and the hook's end of at least 0.44 db fy / √f'c (AASHTO Eq. 5.10.8.2.6b-1).` };
      if (u[1] > 0) return { note: "The column's bars continue down into the column." }; // the tie runs up from this end
      // The top end. At a corner of the concrete (the column's face at the cap's end) the column bars bend into
      // the top bars: a curved-bar node, which needs no stress check (C5.8.2.2), with the bend no tighter than
      // Table 5.10.2.3-1 allows. Elsewhere the cap continues past the column, so the bars must develop up into it.
      const x = nodes[n][0];
      const corner = x <= Math.max(1, T!.columnBarInset) + 1 || T!.length * 12 - x <= Math.max(1, T!.columnBarInset) + 1;
      if (corner) {
        const h = hookDimensions(spec.barSize, 90, "uncoated", "longitudinal", i.fy);
        return { note: `The column's bars continue around the cap's corner into the top bars: bend them on an inside diameter of at least ${f1(h.inside)} in, ${h.inside / bar(spec.barSize).db} db (Table 5.10.2.3-1). The corner node itself needs review (see its node).` };
      }
      const toEnd = T!.depth * 12 - T!.sideCover - ds - bar(spec.barSize).db / 2 - nodes[n][1];
      const { crit, via } = criticalSection(n, tc, 1);
      return result(Math.max(0, toEnd + crit), false, false, `The column's bars run up into the cap to ${f1(T!.sideCover + ds)} in below its top, ${f1(toEnd)} in above node ${labels[n]}${via}`, null, "deepen the cap over the column or lower the tie");
    }
    const top = Math.abs(nodes[n][1] - yTop) < 0.6;
    // A hammerhead's top bars at a corner of the concrete over the column bars' tie: they bend down into
    // the column's bars, a curved-bar node (FHWA Example 2's node A), not a bar end (C5.8.2.2).
    const xn = nodes[n][0];
    const inset = Math.max(1, T!.columnBarInset);
    if (top && tieLines.some((x) => Math.abs(x - xn) < 3.01) && (xn <= inset + 3.01 || T!.length * 12 - xn <= inset + 3.01) && i.ties.some((o) => o !== spec && memberIndex(o.member) !== k && members[memberIndex(o.member)].includes(n) && Math.abs(unitFrom(n, memberIndex(o.member))[0]) < SIN10)) {
      const h = hookDimensions(spec.barSize, 90, "uncoated", "longitudinal", i.fy);
      return { note: `The top bars continue around the cap's corner into the column's bars: bend them on an inside diameter of at least ${f1(h.inside)} in, ${h.inside / bar(spec.barSize).db} db (Table 5.10.2.3-1). The corner node itself needs review (see its node).` };
    }
    const out = -Math.sign(u[0]); // away from the tie's other end
    const toEnd = (out < 0 ? nodes[n][0] : T!.length * 12 - nodes[n][0]) - T!.sideCover;
    const { crit, via } = criticalSection(n, tc, 0);
    return result(Math.max(0, toEnd + crit), true, top, `The bars run to ${f1(T!.sideCover)} in from the cap's ${out < 0 ? "left" : "right"} end, ${f1(toEnd)} in beyond node ${labels[n]}${via}`, top ? T!.topCover : T!.bottomCover, `lengthen the cap's ${out < 0 ? "left" : "right"} end`);
  };

  // Ties (5.8.2.4.1) and their anchorage (5.8.2.4.2, 5.10.8.2).
  const ties: TieResult[] = [];
  const scheduled = new Set<number>();
  for (const t of i.ties) {
    const k = memberIndex(t.member);
    scheduled.add(k);
    const mr = memberResults[k];
    const { area: ab } = bar(t.barSize);
    if (!(t.bars > 0)) throw new DesignError(`Tie ${t.member} needs a number of bars.`);
    const r = rcTie(mr.tension, t.bars * ab, i.fy);
    const entered: TieEndResult[] = t.ends.map((e) => {
      const n = at(e.node, `Tie ${t.member}'s anchorage`);
      if (n !== mr.a && n !== mr.b) throw new DesignError(`Tie ${t.member} doesn't end at node ${e.node}.`);
      const dev = development({ barSize: t.barSize, fy: i.fy, fc: i.fc, clearCover: e.clearCover, clearSpacing: e.clearSpacing, horizontal: e.topCast, concreteBelow: e.topCast ? 13 : 0, coating: e.coating, kind: e.kind });
      return { node: e.node, required: dev.required, available: e.available, ok: e.available >= dev.required, kind: e.kind, basic: dev.basic, confinement: dev.confinement, location: dev.location, coatingFactor: dev.coatingFactor, radius: dev.radius, Fh: dev.Fh, clearCover: e.clearCover, clearSpacing: e.clearSpacing, coating: e.coating, basis: null };
    });
    // Ends where the bars stop: not where another scheduled tie carries on in line (continuous bars).
    const tieIdx = i.ties.map((x) => memberIndex(x.member));
    const away = (k: number, n: number): Pt => {
      const [a, b] = members[k];
      const o = a === n ? b : a;
      const len = Math.hypot(nodes[o][0] - nodes[n][0], nodes[o][1] - nodes[n][1]);
      return [(nodes[o][0] - nodes[n][0]) / len, (nodes[o][1] - nodes[n][1]) / len];
    };
    const k0 = memberIndex(t.member);
    const continues = (n: number) =>
      tieIdx.some((k) => {
        if (k === k0 || (members[k][0] !== n && members[k][1] !== n)) return false;
        const [u, v] = [away(k0, n), away(k, n)];
        return u[0] * v[0] + u[1] * v[1] < -Math.cos((5 * Math.PI) / 180);
      });
    let missing = [mr.a, mr.b].filter((n) => !t.ends.some((e) => labels.indexOf(e.node.trim()) === n) && !continues(n));
    // A standard cap's ends worked out from its geometry.
    const notes = new Map<number, string>();
    const ends = [...entered];
    if (auto && mr.tension > 0)
      for (const n of missing) {
        const a = autoAnchor(t, k, n);
        if ("note" in a) notes.set(n, a.note);
        else ends.push(a);
      }
    missing = missing.filter((n) => !notes.has(n) && !ends.some((e) => labels.indexOf(e.node.trim()) === n));
    ties.push({ member: mr.key, barSize: t.barSize, bars: t.bars, demand: mr.tension, area: t.bars * ab, capacity: r.capacity, requiredArea: r.requiredArea, ok: r.ok, ends });
    checks.push({ id: `tie-${mr.key}`, name: `Tie ${mr.key}: ${t.bars} #${t.barSize}`, demand: mr.tension, capacity: r.capacity, unit: "kip", ok: r.ok, ref: "AASHTO Eq. 5.8.2.4.1-1" });
    for (const e of ends) checks.push({ id: `anchor-${mr.key}-${e.node}`, name: `Tie ${mr.key} anchored at ${e.node} (${e.kind === "hook" ? "standard hook" : "straight bars"})`, demand: e.required, capacity: e.available, unit: "in", ok: e.ok, ref: e.kind === "hook" ? "AASHTO 5.10.8.2.4" : "AASHTO 5.10.8.2.1" });
    if (mr.tension > 0 && missing.length) warnings.push(`Tie ${mr.key}: anchorage not checked at ${missing.map((n) => labels[n]).join(" and ")} (continuous bars, a curved-bar node or a splice need their own check).`);
    if (mr.tension > 0) {
      coverage.push({ item: `Tie ${mr.key}`, group: "tie", status: r.ok ? "pass" : "fail", detail: `${t.bars} #${t.barSize}, φPn ${r.capacity.toFixed(0)} kip against ${mr.tension.toFixed(0)} kip (case ${mr.tensionCase! + 1}), AASHTO 5.8.2.4.1` });
      for (const n of [mr.a, mr.b]) {
        const e = ends.find((x) => labels.indexOf(x.node.trim()) === n);
        const item = `Anchorage of tie ${mr.key} at ${labels[n]}`;
        if (e) coverage.push({ item, group: "anchorage", status: e.ok ? "pass" : "fail", detail: `${e.kind === "hook" ? "standard hook" : "straight bars"}: needs ${e.required.toFixed(1)} in, ${e.available.toFixed(1)} in available${e.basis ? ` (${e.basis})` : ""} (AASHTO 5.8.2.4.2, 5.10.8.2)` });
        else if (continues(n)) coverage.push({ item, group: "anchorage", status: "not-required", detail: "The bars continue in line into the next scheduled tie." });
        else if (notes.has(n)) coverage.push({ item, group: "anchorage", status: "not-required", detail: notes.get(n)! });
        else coverage.push({ item, group: "anchorage", status: "missing-input", detail: "Needs the length available from the extended nodal zone, the bars' cover and spacing, and straight or hooked (AASHTO 5.8.2.4.2)." });
      }
    }
  }
  memberResults.forEach((mr, k) => {
    if (mr.tension > 0 && !scheduled.has(k)) {
      if (mr.role === "tie") checks.push({ id: `tie-${mr.key}`, name: `Tie ${mr.key}: no bars given`, demand: mr.tension, capacity: 0, unit: "kip", ok: false, ref: "AASHTO 5.8.2.4.1" });
      coverage.push({ item: `Tie ${mr.key}`, group: "tie", status: "missing-input", detail: `Carries ${mr.tension.toFixed(0)} kip of tension (case ${mr.tensionCase! + 1}) with no bars given.` });
    }
  });

  // Node faces (5.8.2.5): each face's force from the solved model, per case; ν by the node's type in that case.
  const faces: NodeFaceResult[] = [];
  const checkedNodes = new Set<number>();
  /** A face checked over every case: its worst ratio of demand to strength. */
  const checkFace = (node: string, n: number, source: string, type: FaceType, thickness: number, confinement: Confinement | null, per: (c: number) => { demand: number; width: number } | null, basis: string | null, steel?: { As_fy: number; basis: string }) => {
    let worst: NodeFaceResult | null = null;
    solved.forces.forEach((_, c) => {
      const d = per(c);
      if (!d || !(d.width > 0)) return;
      const nodeType = nodeTypeIn(n, c);
      const r = nodeFace(d.demand, d.width * thickness, i.fc, nodeType, type, grid, confinement);
      // A CCC node's back face holding compression bars: augmented by their yield (5.8.2.5.1), φ for compression in STM.
      const add = steel && type === "back" && nodeType === "CCC" ? steel.As_fy : 0;
      const capacity = r.capacity + 0.7 * add;
      const result: NodeFaceResult = { node, source, type, width: d.width, thickness, area: d.width * thickness, nodeType, case: c, demand: d.demand, nu: r.nu, m: r.m, capacity, ok: d.demand <= capacity, confinement, basis: add ? `${basis ?? ""}. Augmented by ${steel!.basis}`.replace(/^\. /, "") : basis, steel: add || undefined };
      if (!worst || d.demand / r.capacity > worst.demand / worst.capacity) worst = result;
    });
    const w = worst as NodeFaceResult | null;
    if (!w) return;
    faces.push(w);
    const label = source === "external" ? "bearing (applied load or reaction)" : `${type === "interface" ? "strut-to-node interface" : `${type} face`}, ${source}`;
    checks.push({ id: `node-${node}-${source}-${type}`, name: `Node ${node} (${w.nodeType}): ${label}`, demand: w.demand, capacity: w.capacity, unit: "kip", ok: w.ok, ref: "AASHTO 5.8.2.5.3a" });
  };
  // A standard cap's singular nodes, from their zones; smeared and curved-bar nodes need no check (C5.8.2.2).
  const exempt = new Map<number, string>();
  if (zones)
    zones.forEach((z, n) => {
      if (!solved.active.some(([a, b]) => a === n || b === n)) return;
      if (!SINGULAR.includes(z.kind)) {
        if (z.kind !== "boundary") exempt.set(n, z.basis);
        return;
      }
      checkedNodes.add(n);
      const sources = new Map<string, FaceType>();
      solved.forces.forEach((_, c) => autoFaces(n, c).forEach((f, s) => sources.has(s) || sources.set(s, f.type)));
      for (const [source, type] of sources)
        checkFace(labels[n], n, source, type, z.t, z.confinement, (c) => {
          const f = autoFaces(n, c).get(source);
          return f && f.type === type ? { demand: f.demand, width: f.width } : null;
        }, z.basis, z.steelC ? { As_fy: z.steelC, basis: z.steelBasis! } : undefined);
    });
  for (const nc of i.nodeChecks) {
    const n = at(nc.node, "A node check");
    if (zones && checkedNodes.has(n)) continue; // worked out from the cap's geometry instead
    checkedNodes.add(n);
    if (!(nc.thickness > 0)) throw new DesignError(`Node ${nc.node} needs a thickness.`);
    if (nc.thickness > i.b + 1e-9) throw new DesignError(`Node ${nc.node} is thicker than the member.`);
    for (const f of nc.faces) {
      if (!(f.width > 0)) throw new DesignError(`Node ${nc.node}: each face needs a width.`);
      const k = f.source === "external" ? -1 : memberIndex(f.source);
      if (k >= 0 && members[k][0] !== n && members[k][1] !== n) throw new DesignError(`Node ${nc.node}: member ${f.source} doesn't meet it.`);
      checkFace(nc.node, n, f.source, f.type, nc.thickness, nc.confinement, (c) => ({ demand: k < 0 ? externalAt(n, c) : Math.max(0, -solved.forces[c][k]), width: f.width }), null);
    }
  }
  const unchecked = labels.filter((_, n) => !checkedNodes.has(n) && !exempt.has(n) && solved.active.some(([a, b]) => a === n || b === n) && !supports.some(([s]) => s === n));
  if (unchecked.length) warnings.push(`Nodes not checked: ${unchecked.join(", ")}. A smeared node or a curved-bar node may need no stress check (C5.8.2.2); any other node does.`);
  // Node by node: each face checked, and each strut arriving with no face checked for it.
  labels.forEach((label, n) => {
    if ((supports.some(([s]) => s === n) && !checkedNodes.has(n)) || !solved.active.some(([a, b]) => a === n || b === n)) return;
    if (exempt.has(n)) {
      // A curved-bar node isn't covered by the specification: it stays open for review.
      coverage.push({ item: `Node ${label}`, group: "node", status: zones?.[n].kind === "curved-bar" ? "not-checked" : "not-required", detail: `${exempt.get(n)!.replace(/\.?$/, ".")}` });
      return;
    }
    const mine = faces.filter((f) => f.node === label);
    for (const f of mine) coverage.push({ item: `Node ${label}: ${f.type} face (${f.source})`, group: "node", status: f.ok ? "pass" : "fail", detail: `${f.width.toFixed(1)} in by the node's thickness, ν ${f.nu.toFixed(2)}${f.m > 1 ? `, m ${f.m.toFixed(2)}` : ""}: φPn ${f.capacity.toFixed(0)} kip against ${f.demand.toFixed(0)} kip (case ${f.case + 1}), AASHTO 5.8.2.5` });
    const struts = memberResults.filter((m) => m.compression > 0 && (m.a === n || m.b === n));
    const facedSources = new Set(mine.map((f) => f.source));
    const open = struts.filter((m) => ![...facedSources].some((s) => s !== "external" && pairKey(s) === `${Math.min(m.a, m.b)}:${Math.max(m.a, m.b)}`));
    if (open.length)
      coverage.push({
        item: `Node ${label}: strut-to-node faces of ${open.map((m) => m.key).join(", ")}`,
        group: "node",
        status: mine.length ? "missing-input" : "not-checked",
        detail: mine.length ? "No face width given for these struts; their interfaces aren't checked." : "No face of this node is checked (a smeared node may need none, C5.8.2.2; any other node does).",
      });
  });
  // Finite geometry: each strut's width at its ends and its fit within the concrete, each singular
  // node's zone within the concrete and clear of its neighbors, and the bars' fit across the section.
  let geometryOk: boolean | null = null;
  if (zones) {
    geometryOk = true;
    const widthAt = (n: number, k: number, c: number) => {
      const z = zones[n];
      const u = unitFrom(n, k);
      if (SINGULAR.includes(z.kind)) return autoFaces(n, c).get(memberResults[k].key)?.width ?? null;
      return Math.abs(u[1]) < SIN10 && z.hyC > 0 ? z.hyC : null; // a chord strut takes the compression block's height at a smeared node
    };
    let fitting = 0;
    let total = 0;
    memberResults.forEach((m, k) => {
      if (!(m.compression > 0)) return;
      const c = m.compressionCase!;
      const wa = widthAt(m.a, k, c);
      const wb = widthAt(m.b, k, c);
      if (wa === null && wb === null) {
        coverage.push({ item: `Strut ${m.key}`, group: "strut", status: "not-required", detail: `Carries ${m.compression.toFixed(0)} kip (case ${c + 1}) between two smeared nodes. A strut is checked at its node faces (5.8.2.5), and smeared nodes need no check (C5.8.2.2); nothing bounds its width, so the compression spreads.` });
        return;
      }
      const [A, B] = [wa ?? wb!, wb ?? wa!];
      const sa = SINGULAR.includes(zones[m.a].kind);
      const sb = SINGULAR.includes(zones[m.b].kind);
      const pa = exitPoint(nodes[m.a], unitFrom(m.a, k), sa ? zones[m.a] : null);
      const pb = exitPoint(nodes[m.b], unitFrom(m.b, k), sb ? zones[m.b] : null);
      // Prismatic from each singular end; toward a smeared node the strut may fan out, so only the half nearer a singular end is held to its width.
      const fit = bandFits(pa, pb, A, B, outline, 1, sa || (!sa && !sb) ? 0 : 0.5, sb || (!sa && !sb) ? 1 : 0.5);
      total++;
      if (fit.ok) fitting++;
      else geometryOk = false;
      coverage.push({ item: `Strut ${m.key}`, group: "strut", status: fit.ok ? "pass" : "fail", detail: `${f1(A)} in wide at ${labels[m.a]} and ${f1(B)} in at ${labels[m.b]} (case ${c + 1}, ${m.compression.toFixed(0)} kip): ${fit.ok ? "fits within the concrete" : "runs outside the concrete; widen the bearing or the member, or revise the model"}. Its strength is checked at the node faces (AASHTO 5.8.2.5).` });
    });
    if (total) checks.push({ id: "fit-struts", name: `Struts within the concrete (${fitting} of ${total})`, demand: total - fitting, capacity: 0, unit: "outside", ok: fitting === total, ref: "AASHTO 5.8.2.2, Figure 5.8.2.2-1" });
    const singular = zones.map((z, n) => ({ z, n })).filter(({ z, n }) => SINGULAR.includes(z.kind) && checkedNodes.has(n));
    let zonesOk = true;
    for (const { z, n } of singular) {
      const [x, y] = nodes[n];
      const corners: Pt[] = [[x - z.wx / 2, y - z.hy / 2], [x + z.wx / 2, y - z.hy / 2], [x + z.wx / 2, y + z.hy / 2], [x - z.wx / 2, y + z.hy / 2]];
      const inside = corners.every((p) => insideWithin(p, outline, 0.5));
      // A hammerhead column's two nodes bear on adjacent parts of its stress diagram: contiguous by construction.
      const sameColumn = (o: { z: Zone; n: number }) => z.kind === "column" && o.z.kind === "column" && Math.abs(nodes[n][0] - nodes[o.n][0]) < T!.columnWidth * 12;
      const clash = singular.filter((o) => o.n !== n && !sameColumn(o)).filter((o) => {
        const { ox, oy } = zoneOverlap(nodes[n], z, nodes[o.n], o.z);
        return ox > Math.max(1, 0.1 * Math.min(z.wx, o.z.wx)) && oy > 0.5;
      });
      const ok = inside && !clash.length;
      if (!ok) zonesOk = false;
      coverage.push({ item: `Nodal zone ${labels[n]}`, group: "geometry", status: ok ? "pass" : "fail", detail: `${f1(z.wx)} by ${f1(z.hy)} in. ${z.basis}. ${!inside ? "It reaches outside the concrete." : clash.length ? `It overlaps ${clash.map((o) => labels[o.n]).join(", ")}'s zone: the nodes are too close for their forces; spread them or revise the model.` : "Within the concrete and clear of the other nodes."}` });
    }
    if (singular.length) checks.push({ id: "fit-nodes", name: "Nodal zones within the concrete and clear of each other", demand: zonesOk ? 0 : 1, capacity: 0, unit: "", ok: zonesOk, ref: "AASHTO 5.8.2.5.2" });
    if (!zonesOk) geometryOk = false;
    // The bars across the section (5.10.3.1): the layers they need, and whether their centroid sits where the model puts the tie.
    for (const [which, g, cover] of [["Top", T!.topBars, T!.topCover], ["Bottom", T!.bottomBars, T!.bottomCover]] as const) {
      if (!ties.some((t) => t.barSize === g.size && t.bars === g.count && t.demand > 0)) continue;
      const fit = barsFit(T!.capWidth, T!.sideCover, T!.stirrups.size, g.count, g.size);
      const ok = fit.centroid <= cover + 0.5 && fit.clearSpacing >= fit.minClear - 1e-9;
      if (!ok) geometryOk = false;
      checks.push({ id: `fit-${which.toLowerCase()}`, name: `${which} bars' centroid from the face: ${g.count} #${g.size} in ${fit.layers} layer${fit.layers > 1 ? "s" : ""}`, demand: fit.centroid, capacity: cover, unit: "in", ok, ref: "AASHTO 5.10.3.1", note: ok ? undefined : `The bars sit deeper than the ${f1(cover)} in the model assumes: move the chord's line or use fewer, larger bars.` });
      coverage.push({ item: `${which} bars' fit`, group: "geometry", status: ok ? "pass" : "fail", detail: `${g.count} #${g.size} at ${fit.perLayer} per layer, ${fit.layers} layer${fit.layers > 1 ? "s" : ""}, ${f1(fit.clearSpacing)} in clear (at least ${f1(fit.minClear)} in): centroid ${f1(fit.centroid)} in from the face against ${f1(cover)} in in the model.` });
    }
    coverage.push({ item: "Congestion where bar systems cross", group: "geometry", status: "not-implemented", detail: "Where the top bars, column bars and stirrups cross at the column isn't checked." });
  } else {
    for (const m of memberResults.filter((x) => x.compression > 0))
      coverage.push({ item: `Strut ${m.key}`, group: "strut", status: "not-implemented", detail: `Carries ${m.compression.toFixed(0)} kip (case ${m.compressionCase! + 1}). Its width and fit are worked out only for a model built from a standard cap.` });
    coverage.push({ item: "Finite nodal zones", group: "geometry", status: "not-implemented", detail: "Worked out only for a model built from a standard cap: nodes here are points." });
    coverage.push({ item: "Reinforcement fit and congestion", group: "geometry", status: "not-implemented", detail: "Worked out only for a model built from a standard cap." });
  }
  if (capLoads) {
    const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
    if (capLoads.wind) coverage.push({ item: "Wind on the superstructure", group: "service", status: "pass", detail: `From the girder designs: ${f2(capLoads.wind.line3)} klf at ${capLoads.wind.V} mph (Strength III), ${f2(capLoads.wind.line5)} klf at 80 mph (Strength V), ${f2(capLoads.wind.line1)} klf at 70 mph (Service I), each way (AASHTO 3.8.1.2, 3.8.1.3, 3.8.2); carried through the model's cases and service screens.` });
    else coverage.push({ item: "Wind on the superstructure", group: "service", status: "missing-input", detail: "Strength III and V and Service I's wind: give the site's wind in the girder designs (Loads to the substructure), refresh, and turn the wind on under Loads from girder designs." });
    coverage.push({ item: "Braking and other loads along the bridge", group: "geometry", status: "not-implemented", detail: `${capLoads.braking ? `Braking BR = ${f1(capLoads.braking)} kip along the bridge, 6 ft above the roadway (all lanes one way with m, AASHTO 3.6.4), from the girder designs. ` : ""}It acts across the cap's plane (bending about its weak axis and torsion): outside this in-plane model, so check the cap for it separately.` });
  }
  coverage.push(i.grid.provided ? { item: "Crack-control grid", group: "grid", status: grid ? "pass" : "fail", detail: "AASHTO 5.8.2.6" } : { item: "Crack-control grid", group: "grid", status: "missing-input", detail: "Not given; nodes are checked with ν = 0.45." });

  // An inverted-T's ledges (5.8.4.3), at each girder's bearing: its factored reaction (and its service
  // reaction, from the girder designs) on its own ledge, the spacing to the next bearing on that ledge, and
  // its distance to the ledge's end.
  const ledges: (LedgeCheck & { bearing: string })[] = [];
  if (T?.kind === "inverted-t" && T.ledge) {
    const lg = T.ledge;
    const items = capLoads
      ? capLoads.bearingLoads.map((b) => ({ label: b.label, x: b.x, side: b.label.startsWith("Ahead") ? "ahead" : "back", Vu: b.strength, Vs: b.dc + b.dw + b.ll as number | null }))
      : T.bearings.map((b, k) => ({ label: `bearing ${k + 1}`, x: b.x, side: "back", Vu: b.P, Vs: null as number | null }));
    const input = { fc: i.fc, fy: i.fy, bw: T.capWidth, bl: lg.projection, hf: lg.depth, cover: lg.cover, bottomCover: T.bottomCover, av: lg.av, W: T.bearingLength, L: T.bearingWidth, primary: lg.primary, ties: lg.ties, hangers: lg.hangers };
    for (const it of items) {
      const same = items.filter((o) => o.side === it.side && o !== it).map((o) => Math.abs(o.x - it.x) * 12);
      const S = same.length ? Math.min(...same) : T.length * 12;
      const c = Math.min(it.x, T.length - it.x) * 12;
      // Exterior: no other bearing on this ledge between it and the ledge's nearer end.
      const toEnd = it.x < T.length / 2 ? -1 : 1;
      const exterior = !items.some((o) => o.side === it.side && o !== it && (o.x - it.x) * toEnd > 0);
      for (const ch of ledgeChecks(input, { label: it.label, Vu: it.Vu, Vs: it.Vs ?? 0, S, c, exterior })) {
        if (ch.id.startsWith("hv-") && it.Vs === null) {
          coverage.push({ item: `${ch.name}`, group: "geometry", status: "missing-input", detail: "Needs the bearing's service reaction: link the girder designs." });
          continue;
        }
        ledges.push({ ...ch, bearing: it.label });
        checks.push({ id: `ledge-${ch.id}`, name: ch.name, demand: ch.demand, capacity: ch.capacity, unit: ch.unit, ok: ch.ok, ref: ch.ref, note: ch.note });
        coverage.push({ item: ch.name, group: "geometry", status: ch.ok ? "pass" : "fail", detail: `${ch.demand.toFixed(1)} against ${ch.capacity.toFixed(1)} ${ch.unit} (${ch.ref})${ch.note ? `. ${ch.note}` : ""}` });
      }
    }
    coverage.push({ item: "Inverted-T torsion", group: "geometry", status: "not-implemented", detail: "Ledge loads on one side twist the cap: check torsion by Articles 5.7.3.6 and 5.7.2.1 (5.8.4.3.5)." });
  }

  let service: ReturnType<typeof diagonalCrackScreen> | null = null;
  const services: ServiceResult[] = [];
  const note = "A commentary screen for cracking under service loads, not a strength check.";
  if (i.service.check) {
    service = diagonalCrackScreen(i.service.V, i.service.a, i.service.d, i.b, i.fc);
    services.push({ label: "As entered", V: service.V, a: i.service.a, d: i.service.d, b: i.b, Vcr: service.Vcr, ok: service.ok, basis: "The service shear, shear span and depth as entered" });
    checks.push({ id: "diagonal", name: "Service shear under the diagonal-cracking estimate Vcr", demand: service.V, capacity: service.Vcr, unit: "kip", ok: service.ok, ref: "AASHTO Eq. C5.8.2.2-1", note });
  } else if (T && capLoads?.serviceShear.length) {
    // From the girders: Service I on each arm at its column face, the shear span to the arm's load resultant.
    const d = T.depth * 12 - T.topCover;
    for (const s of capLoads.serviceShear) {
      if (!(s.V > 0)) continue;
      const scr = diagonalCrackScreen(s.V, s.a * 12, d, T.capWidth, i.fc);
      services.push({ label: s.label, V: s.V, a: s.a * 12, d, b: T.capWidth, Vcr: scr.Vcr, ok: scr.ok, basis: `Service I on the ${s.label.toLowerCase()} at the column face (${s.lanes ? `${s.lanes} lane${s.lanes > 1 ? "s" : ""}` : "dead loads"}), the shear span to the arm's load resultant` });
      checks.push({ id: `diagonal-${s.label}`, name: `${s.label}: service shear under the diagonal-cracking estimate Vcr`, demand: s.V, capacity: scr.Vcr, unit: "kip", ok: scr.ok, ref: "AASHTO Eq. C5.8.2.2-1", note });
    }
  }
  for (const s of services) coverage.push({ item: `Diagonal-cracking screen${services.length > 1 || s.label !== "As entered" ? `, ${s.label.toLowerCase()}` : ""}`, group: "service", status: s.ok ? "pass" : "fail", detail: `Service shear ${s.V.toFixed(0)} kip against Vcr ${s.Vcr.toFixed(0)} kip, a = ${f1(s.a)} in, d = ${f1(s.d)} in (AASHTO C5.8.2.2)` });
  if (!services.length) coverage.push({ item: "Diagonal-cracking screen", group: "service", status: "missing-input", detail: "Needs the service shear, shear span and depth." });

  return {
    ok: checks.every((c) => c.ok),
    checks,
    warnings,
    nodes,
    outline,
    labels,
    members: memberResults,
    forces: solved.forces,
    reactions: solved.reactions,
    supports,
    angles,
    ties,
    faces,
    grid,
    service,
    services,
    ledges,
    zones: zones ? zones.map((z, n) => ({ node: labels[n], ...z })) : null,
    stability: solved.stability,
    objective: solved.objective,
    cases,
    capLoads,
    appliedLoads,
    reversedCases: reversed, // left out: a hammerhead model laid out for the other direction takes them
    perCase,
    coverage,
    supportReport: supports.map(([node, axis], r) => ({
      node: labels[node],
      direction: axis === 0 ? ("x" as const) : ("y" as const),
      upwardOnly: upward.includes(r),
      reactions: solved.reactions.map((row) => row[r]),
      target: boundary ? boundary.targets.map((row) => row[r]) : null,
    })),
    boundary: { kind: boundary ? ("linear-stress" as const) : ("solver" as const), deviation: solved.deviation },
    status: {
      equilibrium: perCase.every((p) => p.equilibrium.ok),
      mechanisms: solved.stability.mechanisms,
      crossings: cross.length,
      angles: perCase.every((p) => p.angleOk),
      finiteGeometry: geometryOk === null ? ("not-implemented" as const) : geometryOk ? ("pass" as const) : ("fail" as const),
    },
  };
}

export type StmResult = Awaited<ReturnType<typeof designStm>>;
