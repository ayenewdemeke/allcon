import { bar } from "../stm/aashto";
import type { Pt } from "../stm/geometry";
import { DesignError } from "../walls/cip";

// CDOT's standard bridge rails (Staff Bridge worksheets B-606, June 2026) as the deck carries them:
// each rail's section, its bars as the worksheet details them, its weight, and its quantities per
// foot; and for the concrete parapets their resistance by the yield line analysis of AASHTO LRFD
// A13.3.1, with the axial tension it puts into the deck overhang (A13.4.2). The rails are crash
// tested or designed by Staff Bridge: the resistance here is the deck's design force (the deck must
// develop the parapet's strength, A13.4.2), not a check of the standard. Inches, kips and feet.
//
// Coordinates: x inward from the deck edge (the rail's outside face at x = 0, its traffic face at
// the base x = width), y up from the top of the deck.

export type RailKey = "custom" | "type9-4" | "type9-3" | "type10-mash";
export type TestLevel = "TL-4" | "TL-5";
export type RailSteel = "A1035" | "A955";

/** Table A13.2-1. */
export const RAIL_FORCES: Record<TestLevel, { Ft: number; FL: number; Fv: number; Lt: number; Lv: number; He: number; H: number }> = {
  "TL-4": { Ft: 54, FL: 18, Fv: 18, Lt: 3.5, Lv: 18, He: 32, H: 32 },
  "TL-5": { Ft: 124, FL: 41, Fv: 80, Lt: 8, Lv: 40, He: 42, H: 42 },
};

export const RAIL_STEEL: Record<RailSteel, { label: string; fy: number }> = {
  A1035: { label: "ASTM A1035CS, Grade 100", fy: 100 },
  A955: { label: "Stainless, ASTM A955", fy: 75 },
};

/** A bar of the rail: its path (in, from-edge coordinates), how it repeats along the rail, and how CDOT calls it out. */
export type RailBar = { use: string; size: number; spacing: number | null; count?: number; path: Pt[]; closed?: boolean; callout: string; endZone?: { spacing: number; length: number } };

export type RailDef = {
  key: Exclude<RailKey, "custom">;
  name: string;
  sheet: string;
  payItem: string;
  kind: "parapet" | "curb-and-posts";
  height: number; // in, top of rail above the deck
  width: number; // in, at its base
  outline: Pt[]; // the concrete
  steel: { lbPerFt: number; label: string } | null; // posts and tubes (Structural Steel (Galvanized), in the 606 item)
  posts?: { x: number; spacing: number; tubes: { x0: number; x1: number; y0: number; y1: number }[] };
  bars: RailBar[];
  longitudinal: { size: number; at: Pt[] };
  perFoot: { concrete: number; rebar: number; sealer: number }; // the worksheet's table: CY, LB, SY per LF (8 in deck)
  testLevel: TestLevel; // as the worksheet designs it at its full height
  frontFace: (y: number) => number; // x of the traffic face at height y
  backFace: (y: number) => number; // x of the outside face (or a stem's back face) at height y
};

const R4 = bar(4).db;
const COVER = 1.5;

// Type 9: a concrete parapet 3'-7" high, 1'-6" at its base, the traffic face battered 6⅞" over its
// height, an 8" stem, a 9" deep head 11⅛" wide, and a flared lower back (B-606-9-4, B-606-9-3).
const T9_FRONT = (y: number) => 18 - (6.875 * y) / 43;
const T9_STEM_BACK = (y: number) => 18 - (13.4375 - ((34 - y) * 6.875) / 43);
const T9_BACK = (y: number) => (y >= 34 ? 0 : y >= 15 ? T9_STEM_BACK(y) : y <= 2 ? 0 : T9_STEM_BACK(15) * ((y - 2) / 13));
const T9_OUTLINE: Pt[] = [
  [18, 0],
  [0, 0],
  [0, 2],
  [T9_STEM_BACK(15), 15],
  [T9_STEM_BACK(33.875), 33.875],
  [0, 34],
  [0, 42.25],
  [0.75, 43],
  [18 - 6.875 - 0.75, 43],
  [T9_FRONT(42.25), 42.25],
];
const off = COVER + R4 / 2; // a #4's center from the face
const t9Bars = (size: 3 | 4): RailBar[] => {
  const o = COVER + bar(size).db / 2;
  const top = 43 - o;
  const front: Pt[] = [
    [T9_FRONT(top) - o - 4.5, top], // the top hook turned back into the head
    [T9_FRONT(top) - o, top],
    [T9_FRONT(0) - o, 0],
  ];
  const back: Pt[] = [
    [o + 4.5, top],
    [o, top],
    [o, 34 + o],
    [T9_STEM_BACK(33) + o, 33],
    [T9_STEM_BACK(15) + o, 15],
    [o, 2],
    [o, 0],
  ];
  // The lower stirrup in the flare: its base on the deck, its front leg up the traffic face, its back leg down the flare.
  const tri: Pt[] = [
    [T9_FRONT(0) - o, 0],
    [T9_FRONT(23.5) - o, 23.5],
    [T9_STEM_BACK(15) + o, 15],
    [o, 2 + o],
    [o, 0],
    [T9_FRONT(0) - o, 0],
  ];
  const head: Pt[] = [
    [o, 34 + o],
    [T9_FRONT(34 + o) - o, 34 + o],
    [T9_FRONT(top) - o, top],
    [o, top],
    [o, 34 + o],
  ];
  return size === 4
    ? [
        { use: "Rail, front face", size: 4, spacing: 18, path: front, callout: "#4 @ 1'-6\" front face", endZone: { spacing: 6, length: 96 } },
        { use: "Rail, back face", size: 4, spacing: 18, path: back, callout: "#4 @ 1'-6\" back face" },
        { use: "Rail, lower stirrups", size: 4, spacing: 12, path: tri, closed: true, callout: "#4 @ 1'-0\" (lower stirrups)" },
        { use: "Rail, head ties", size: 4, spacing: 18, path: head, closed: true, callout: "#4 @ 1'-6\" (head ties)" },
      ]
    : [
        { use: "Rail, front face", size: 3, spacing: 6, path: front, callout: "#3 @ 6\" front face" },
        { use: "Rail, back face", size: 3, spacing: 12, path: back, callout: "#3 @ 1'-0\" back face" },
        { use: "Rail, lower stirrups", size: 3, spacing: 12, path: tri, closed: true, callout: "#3 @ 1'-0\" (lower stirrups)", endZone: { spacing: 6, length: 84 } },
      ];
};
const t9Long = (size: 3 | 4): Pt[] => {
  const o = COVER + bar(size).db + bar(size).db / 2;
  const pair = (y: number, inset = o): Pt[] => [
    [T9_FRONT(y) - inset, y],
    [Math.max(T9_BACK(y), y >= 34 ? 0 : T9_STEM_BACK(Math.max(15, y))) + inset, y],
  ];
  const rows = [43 - o, 34 + o, 24, 12.5];
  const pts = rows.flatMap((y) => pair(y));
  return size === 4 ? pts : [...pts, ...pair(30)];
};

// Type 10 MASH: a concrete curb 1'-6" wide and 1'-1" high with W6x20 posts at 10'-0" (max) on
// base plates, carrying two HSS 6x6 tubes, 3'-7" to the top of rail (B-606-10MASH).
const T10_OUTLINE: Pt[] = [
  [18, 0],
  [0, 0],
  [0, 13],
  [16.75, 13],
];
const t10Bars = (): RailBar[] => {
  const o = off;
  return [
    {
      use: "Rail curb, stirrups",
      size: 4,
      spacing: 120 / 13, // 3 spaces @ 7½" either side of each post, then 10" max: 13 a 10'-0" post space
      path: [
        [o, -5],
        [o, 13 - o],
        [18 - o - (1.25 * (13 - o)) / 13, 13 - o],
        [18 - o, 0],
        [18 - o, -5],
      ],
      callout: "#4 stirrups, 3 spa @ 7½\" each side of each post, 10\" max between",
    },
  ];
};

export const RAILS: RailDef[] = [
  {
    key: "type9-4",
    name: "Bridge Rail Type 9 (#4 option)",
    sheet: "B-606-9-4",
    payItem: "606-10900",
    kind: "parapet",
    height: 43,
    width: 18,
    outline: T9_OUTLINE,
    steel: null,
    bars: t9Bars(4),
    longitudinal: { size: 4, at: t9Long(4) },
    perFoot: { concrete: 0.12, rebar: 19.0, sealer: 0.51 },
    testLevel: "TL-5",
    frontFace: T9_FRONT,
    backFace: T9_BACK,
  },
  {
    key: "type9-3",
    name: "Bridge Rail Type 9 (#3 option)",
    sheet: "B-606-9-3",
    payItem: "606-10900",
    kind: "parapet",
    height: 43,
    width: 18,
    outline: T9_OUTLINE,
    steel: null,
    bars: t9Bars(3),
    longitudinal: { size: 3, at: t9Long(3) },
    perFoot: { concrete: 0.12, rebar: 12.4, sealer: 0.51 },
    testLevel: "TL-5",
    frontFace: T9_FRONT,
    backFace: T9_BACK,
  },
  {
    key: "type10-mash",
    name: "Bridge Rail Type 10 MASH",
    sheet: "B-606-10MASH",
    payItem: "606-11035",
    kind: "curb-and-posts",
    height: 43,
    width: 18,
    outline: T10_OUTLINE,
    steel: { lbPerFt: 49.6, label: "W6x20 posts at 10'-0\" on ¾\" base plates, two HSS 6x6 tubes" },
    posts: {
      x: 8.25,
      spacing: 120,
      tubes: [
        { x0: 12, x1: 18, y0: 34, y1: 40 },
        { x0: 12, x1: 18, y0: 19, y1: 25 },
      ],
    },
    bars: t10Bars(),
    longitudinal: {
      size: 4,
      at: [
        [off + 2, 13 - off - R4],
        [9, 13 - off - R4],
        [16 - off, 13 - off - R4],
        [off + R4, 6],
      ],
    },
    perFoot: { concrete: 0.059, rebar: 8.7, sealer: 0.28 },
    testLevel: "TL-5",
    frontFace: (y) => 18 - (1.25 * Math.min(y, 13)) / 13,
    backFace: () => 0,
  },
];

export const railDef = (key: RailKey) => RAILS.find((r) => r.key === key) ?? null;

/** The area of a polygon (in²) and its centroid's x. */
export function polygonProps(pts: Pt[]) {
  let A = 0;
  let Sx = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x0, y0] = pts[k];
    const [x1, y1] = pts[(k + 1) % pts.length];
    const c = x0 * y1 - x1 * y0;
    A += c / 2;
    Sx += ((x0 + x1) * c) / 6;
  }
  return { A: Math.abs(A), xc: Sx / A };
}

/**
 * A concrete parapet's resistance by the yield line analysis (A13.3.1): Mc, the wall's flexural
 * resistance about the longitudinal axis per foot, from the vertical bars at the traffic face at
 * each height (averaged over the height, the bars' spacing as detailed); Mw, about the vertical
 * axis, from the longitudinal bars, each with its own lever arm (the average of the two faces in
 * tension); Mb = 0 (no separate beam at the top). Then Lc and Rw within a wall segment
 * (Eqs. A13.3.1-1, -2) and at its end (Eqs. A13.3.1-3, -4), and the deck's tension T (Eq. A13.4.2-1).
 */
export function parapetResistance(r: RailDef, fc: number, fy: number, tl: TestLevel) {
  if (r.kind !== "parapet") throw new DesignError("The yield line analysis is for concrete parapets.");
  const H = r.height / 12;
  const { Lt, Ft } = RAIL_FORCES[tl];
  // Vertical bars at the traffic face crossing a horizontal section at y (in²/ft).
  const frontBars = (y: number, endZone: boolean) =>
    r.bars.reduce((s, b) => {
      // A leg along the traffic face crossing the section: within 3 in of the face at that height.
      const near = b.path.some((p, k) => {
        if (k === 0) return false;
        const q = b.path[k - 1];
        if ((q[1] - y) * (p[1] - y) > 0 || p[1] === q[1]) return false;
        const x = q[0] + ((y - q[1]) * (p[0] - q[0])) / (p[1] - q[1]);
        return r.frontFace(y) - x < 3;
      });
      if (!near) return s;
      const sp = endZone && b.endZone ? b.endZone.spacing : (b.spacing ?? 12);
      return s + (bar(b.size).area * 12) / sp;
    }, 0);
  const width = (y: number) => r.frontFace(y) - (y >= 34 ? 0 : r.backFace(y));
  const McAt = (y: number, endZone = false) => {
    const As = frontBars(y, endZone);
    const d = width(y) - COVER - bar(r.longitudinal.size).db / 2;
    const a = (As * fy) / (0.85 * fc * 12);
    return Math.max(0, (As * fy * (d - a / 2)) / 12);
  };
  const avg = (endZone: boolean) => {
    const n = 86;
    let s = 0;
    for (let k = 0; k < n; k++) s += McAt(((k + 0.5) * r.height) / n, endZone);
    return s / n;
  };
  // Mw: each longitudinal bar in tension at its nearer face, its lever arm to the far face; the two faces averaged.
  const Ab = bar(r.longitudinal.size).area;
  let toFront = 0;
  let toBack = 0;
  for (const [x, y] of r.longitudinal.at) {
    const xf = r.frontFace(y);
    const xb = y >= 34 ? 0 : r.backFace(y);
    const nearFront = xf - x < x - xb;
    const d = nearFront ? x - xb : xf - x;
    const a = (Ab * fy) / (0.85 * fc * 6); // over about 6 in of the wall's height
    const m = (Ab * fy * (d - a / 2)) / 12;
    if (nearFront) toFront += m;
    else toBack += m;
  }
  const Mw = (toFront + toBack) / 2;
  const Mb = 0;
  const interior = (() => {
    const Mc = avg(false);
    const Lc = Lt / 2 + Math.sqrt((Lt / 2) ** 2 + (8 * H * (Mb + Mw)) / Mc);
    const Rw = (2 / (2 * Lc - Lt)) * (8 * Mb + 8 * Mw + (Mc * Lc ** 2) / H);
    return { Mc, Lc, Rw, T: Rw / (Lc + 2 * H) };
  })();
  const end = (() => {
    const Mc = avg(true);
    const Lc = Lt / 2 + Math.sqrt((Lt / 2) ** 2 + (H * (Mb + Mw)) / Mc);
    const Rw = (2 / (2 * Lc - Lt)) * (Mb + Mw + (Mc * Lc ** 2) / H);
    return { Mc, Lc, Rw, T: Rw / (Lc + 2 * H) };
  })();
  const McBase = Math.max(McAt(0.5, false), McAt(0.5, true));
  return { H, Lt, Ft, Mw, Mb, interior, end, McBase, McAt, T: Math.max(interior.T, end.T) };
}

export type ParapetResistance = ReturnType<typeof parapetResistance>;

/** What the deck takes from the rail: its width, weight and c.g., the vertical force's lever arm, and for a parapet its base moment and tension. */
export function railOnDeck(r: RailDef, o: { fc: number; steel: RailSteel; testLevel: TestLevel; gammaC: number }) {
  const { A, xc } = polygonProps(r.outline);
  const steelKlf = (r.steel?.lbPerFt ?? 0) / 1000;
  const concreteKlf = (A / 144) * o.gammaC;
  const weight = concreteKlf + steelKlf;
  const cg = (concreteKlf * xc + steelKlf * (r.posts?.x ?? xc)) / weight; // in from the deck edge
  const topCenter = (() => {
    const top = Math.max(...r.outline.map((p) => p[1]));
    if (r.posts) return r.posts.x;
    const xs = r.outline.filter((p) => p[1] >= top - 1).map((p) => p[0]);
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  })();
  const forces = RAIL_FORCES[o.testLevel];
  const fy = RAIL_STEEL[o.steel].fy;
  const resistance = r.kind === "parapet" ? parapetResistance(r, o.fc, fy, o.testLevel) : null;
  return {
    rail: r,
    area: A,
    weight,
    cg,
    la: (r.width - topCenter) / 12, // ft, the vertical force on the rail's top to the traffic face at its base
    Fv: forces.Fv,
    Lv: forces.Lv,
    forces,
    fy,
    resistance,
  };
}

export type RailOnDeck = ReturnType<typeof railOnDeck>;
