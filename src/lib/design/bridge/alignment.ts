import { DesignError } from "../walls/cip";

// A roadway's alignment, profile and roadway section as PGSuper takes them (its Alignment dialog and
// project file: AlignmentData, ProfileData, Crown), worked out as geometry.
//
// - Horizontal: from a reference point (station, northing, easting) along the back tangent's bearing;
//   circular curves by their PI station (measured along the stationing, the PI as reached along the
//   back tangent), radius and the front tangent's bearing. T = R·tan(Δ/2), Lc = R·Δ; PC = PI − T, PT = PC + Lc.
//   With entry and exit spirals (clothoids, as PGSuper's Entry and Exit Spiral lengths): θs = Ls/(2R), the
//   shifts p = Y − R(1 − cos θs) and k = X − R·sin θs, T1 = (R + p2 − (R + p1)·cos Δ)/sin Δ + k1 (T2 likewise),
//   Lc = R(Δ − θs1 − θs2); TS = PI − T1, SC = TS + Ls1, CS = SC + Lc, ST = CS + Ls2.
// - Vertical: a station, its elevation and the grade leaving it; symmetric parabolic vertical curves
//   by their PVI station, the grade leaving the PVI and the curve's length (AASHTO Green Book 3.4.6):
//   y = y_BVC + g1·x + (g2 − g1)·x² / (2L).
// - Roadway section: left and right cross slopes (ft/ft, negative falling away from the crown) and
//   the crown's offset from the alignment (+ right), the profile grade on the alignment. Superelevation
//   transitions as PGSuper's roadway section templates: sections at stations, the slopes and the crown's
//   offset straight-line between them (constant before the first and after the last).
// Bearings are azimuths in degrees clockwise from north; offsets + to the right looking up station; ft.

export type HorizontalCurve = { pi: number; radius: number; azimuth: number; spiralIn?: number; spiralOut?: number }; // PI station; R; the front tangent's azimuth; spiral lengths, ft
export type VerticalCurve = { pvi: number; grade: number; length: number }; // PVI station; the grade leaving it (%); L
export type Alignment = {
  refStation: number;
  northing: number;
  easting: number;
  azimuth: number; // the back tangent's, deg
  curves: HorizontalCurve[];
};
export type Profile = { station: number; elevation: number; grade: number; curves: VerticalCurve[] }; // grade %
export type RoadwaySection = { leftSlope: number; rightSlope: number; crownOffset: number; sections?: RoadwayTemplate[] };
export type RoadwayTemplate = { station: number; leftSlope: number; rightSlope: number; crownOffset: number };

const rad = (d: number) => (d * Math.PI) / 180;
const norm180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

type Element =
  | { kind: "tangent"; s0: number; s1: number; x0: number; y0: number; az: number } // x easting, y northing
  | { kind: "arc"; s0: number; s1: number; x0: number; y0: number; az0: number; R: number; turn: 1 | -1 }
  // A clothoid from its tangent end: entering, (x0, y0, az0) at the TS; leaving, at the ST with the front tangent's azimuth.
  | { kind: "spiral"; s0: number; s1: number; x0: number; y0: number; az0: number; R: number; Ls: number; turn: 1 | -1; out: boolean };

/** A clothoid's local coordinates l from its tangent end (curvature 0 there, 1/R at Ls): x along the tangent, y to the turning side (series to θ⁷). */
export function clothoid(l: number, R: number, Ls: number) {
  const th = (l * l) / (2 * R * Ls);
  return { x: l * (1 - th ** 2 / 10 + th ** 4 / 216 - th ** 6 / 9360), y: l * (th / 3 - th ** 3 / 42 + th ** 5 / 1320 - th ** 7 / 75600), th };
}

function spiralPoint(x0: number, y0: number, az0: number, turn: 1 | -1, R: number, Ls: number, l: number) {
  const c = clothoid(l, R, Ls);
  const a = rad(az0);
  const n = rad(az0 + 90 * turn);
  return { x: x0 + c.x * Math.sin(a) + c.y * Math.sin(n), y: y0 + c.x * Math.cos(a) + c.y * Math.cos(n), az: az0 + (turn * c.th * 180) / Math.PI };
}

/** The alignment's elements, from the reference station (stations before it lie on the back tangent). */
export function horizontalElements(a: Alignment) {
  const curves = [...a.curves].sort((p, q) => p.pi - q.pi);
  const els: Element[] = [];
  let s = a.refStation;
  let x = a.easting;
  let y = a.northing;
  let az = a.azimuth;
  const details: { pi: number; pc: number; pt: number; T: number; T2: number; Lc: number; delta: number; R: number; turn: 1 | -1; Ls1: number; Ls2: number; sc: number; cs: number }[] = [];
  for (const c of curves) {
    if (!(c.radius > 0)) throw new DesignError("Every horizontal curve needs a radius.");
    const delta = norm180(c.azimuth - az);
    if (Math.abs(delta) < 1e-9) {
      continue;
    }
    if (Math.abs(delta) >= 179) throw new DesignError("A horizontal curve can't turn 180°.");
    const turn: 1 | -1 = delta > 0 ? 1 : -1; // + right (clockwise)
    const d = rad(Math.abs(delta));
    const R = c.radius;
    const Ls1 = Math.max(0, c.spiralIn ?? 0);
    const Ls2 = Math.max(0, c.spiralOut ?? 0);
    const th1 = Ls1 / (2 * R);
    const th2 = Ls2 / (2 * R);
    if (th1 + th2 > d + 1e-9) throw new DesignError(`The curve at PI ${c.pi.toFixed(2)} turns less than its spirals do: shorten the spirals or use a larger radius.`);
    const shift = (Ls: number, th: number) => {
      if (!(Ls > 0)) return { p: 0, k: 0 };
      const e = clothoid(Ls, R, Ls);
      return { p: e.y - R * (1 - Math.cos(th)), k: e.x - R * Math.sin(th) };
    };
    const s1 = shift(Ls1, th1);
    const s2 = shift(Ls2, th2);
    const T = (R + s2.p - (R + s1.p) * Math.cos(d)) / Math.sin(d) + s1.k;
    const T2 = (R + s1.p - (R + s2.p) * Math.cos(d)) / Math.sin(d) + s2.k;
    const Lc = R * (d - th1 - th2);
    const pc = c.pi - T; // the TS (the PC without spirals)
    if (pc < s - 1e-6) throw new DesignError(`The curve at PI ${c.pi.toFixed(2)} begins before the previous curve ends: check the PI stations and radii.`);
    els.push({ kind: "tangent", s0: s, s1: pc, x0: x, y0: y, az });
    x += (pc - s) * Math.sin(rad(az));
    y += (pc - s) * Math.cos(rad(az));
    // The PI and the ST from the tangents.
    const xPI = x + T * Math.sin(rad(az));
    const yPI = y + T * Math.cos(rad(az));
    const xST = xPI + T2 * Math.sin(rad(c.azimuth));
    const yST = yPI + T2 * Math.cos(rad(c.azimuth));
    let sc = pc;
    let xa = x;
    let ya = y;
    let aza = az;
    if (Ls1 > 0) {
      els.push({ kind: "spiral", s0: pc, s1: pc + Ls1, x0: x, y0: y, az0: az, R, Ls: Ls1, turn, out: false });
      const e = spiralPoint(x, y, az, turn, R, Ls1, Ls1);
      sc = pc + Ls1;
      xa = e.x;
      ya = e.y;
      aza = e.az;
    }
    els.push({ kind: "arc", s0: sc, s1: sc + Lc, x0: xa, y0: ya, az0: aza, R, turn });
    const cs = sc + Lc;
    const st = cs + Ls2;
    if (Ls2 > 0) els.push({ kind: "spiral", s0: cs, s1: st, x0: xST, y0: yST, az0: c.azimuth, R, Ls: Ls2, turn, out: true });
    x = xST;
    y = yST;
    az = c.azimuth;
    s = st;
    details.push({ pi: c.pi, pc, pt: st, T, T2, Lc, delta, R, turn, Ls1, Ls2, sc, cs });
  }
  els.push({ kind: "tangent", s0: s, s1: Infinity, x0: x, y0: y, az });
  return { els, details };
}

function arcPoint(x0: number, y0: number, az0: number, R: number, turn: 1 | -1, l: number) {
  // The center is R to the side the curve turns; the chord turns half the arc's angle.
  const phi = l / R;
  const chord = 2 * R * Math.sin(phi / 2);
  const azc = az0 + turn * ((phi / 2) * 180) / Math.PI;
  return { x: x0 + chord * Math.sin(rad(azc)), y: y0 + chord * Math.cos(rad(azc)), az: az0 + (turn * phi * 180) / Math.PI };
}

/** Point (easting x, northing y) and the tangent's azimuth at a station. */
export function pointAt(a: Alignment, station: number, cache = horizontalElements(a)) {
  const els = cache.els;
  if (station < els[0].s0) {
    const e = els[0];
    const az = e.kind === "tangent" ? e.az : e.az0;
    const d = station - e.s0;
    return { x: e.x0 + d * Math.sin(rad(az)), y: e.y0 + d * Math.cos(rad(az)), az, R: Infinity };
  }
  const e = els.find((el) => station <= el.s1 + 1e-9) ?? els[els.length - 1];
  const l = station - e.s0;
  if (e.kind === "tangent") return { x: e.x0 + l * Math.sin(rad(e.az)), y: e.y0 + l * Math.cos(rad(e.az)), az: e.az, R: Infinity };
  if (e.kind === "spiral") {
    if (!e.out) return { ...spiralPoint(e.x0, e.y0, e.az0, e.turn, e.R, e.Ls, l), R: l > 0 ? (e.R * e.Ls) / l : Infinity };
    // Leaving: back from the ST, turning the other way.
    const u = e.s1 - station;
    const p = spiralPoint(e.x0, e.y0, e.az0 + 180, -e.turn as 1 | -1, e.R, e.Ls, u);
    return { x: p.x, y: p.y, az: p.az - 180, R: u > 0 ? (e.R * e.Ls) / u : Infinity };
  }
  const p = arcPoint(e.x0, e.y0, e.az0, e.R, e.turn, l);
  return { ...p, R: e.R };
}

/** The point at a station and an offset (+ right, normal to the alignment). */
export function offsetPoint(a: Alignment, station: number, offset: number, cache = horizontalElements(a)) {
  const p = pointAt(a, station, cache);
  const n = rad(p.az + 90);
  return { x: p.x + offset * Math.sin(n), y: p.y + offset * Math.cos(n), az: p.az };
}

/** A point's station and offset (+ right): the nearest point on the alignment, by a search then Newton steps. */
export function stationOffset(a: Alignment, x: number, y: number, near: number, cache = horizontalElements(a)) {
  let s = near;
  for (let k = 0; k < 30; k++) {
    const p = pointAt(a, s, cache);
    const t = { x: Math.sin(rad(p.az)), y: Math.cos(rad(p.az)) };
    const ds = (x - p.x) * t.x + (y - p.y) * t.y;
    s += ds;
    if (Math.abs(ds) < 1e-9) break;
  }
  const p = pointAt(a, s, cache);
  const nrm = { x: Math.sin(rad(p.az + 90)), y: Math.cos(rad(p.az + 90)) };
  return { station: s, offset: (x - p.x) * nrm.x + (y - p.y) * nrm.y };
}

/** The profile's grade (%) segments and vertical curves, worked out. */
export function profileGeometry(p: Profile) {
  const vcs = [...p.curves].sort((a, b) => a.pvi - b.pvi);
  let s = p.station;
  let e = p.elevation;
  let g = p.grade;
  const out: { pvi: number; elev: number; g1: number; g2: number; L: number; bvc: number; evc: number }[] = [];
  for (const c of vcs) {
    const elev = e + (g / 100) * (c.pvi - s);
    out.push({ pvi: c.pvi, elev, g1: g, g2: c.grade, L: Math.max(0, c.length), bvc: c.pvi - c.length / 2, evc: c.pvi + c.length / 2 });
    s = c.pvi;
    e = elev;
    g = c.grade;
  }
  for (let k = 1; k < out.length; k++) if (out[k].bvc < out[k - 1].evc - 1e-6) throw new DesignError("Two vertical curves overlap: check their PVI stations and lengths.");
  return out;
}

/** The profile's elevation and grade (ft/ft) at a station. */
export function profileAt(p: Profile, station: number, vcs = profileGeometry(p)) {
  // Before the first PVI: the starting tangent.
  let s0 = p.station;
  let e0 = p.elevation;
  let g = p.grade / 100;
  for (const v of vcs) {
    if (v.L > 0 && station >= v.bvc && station <= v.evc) {
      const x = station - v.bvc;
      const g1 = v.g1 / 100;
      const g2 = v.g2 / 100;
      const yb = v.elev - g1 * (v.L / 2);
      return { elevation: yb + g1 * x + ((g2 - g1) * x * x) / (2 * v.L), grade: g1 + ((g2 - g1) * x) / v.L };
    }
    if (station < v.pvi) break;
    s0 = v.pvi;
    e0 = v.elev;
    g = v.g2 / 100;
  }
  return { elevation: e0 + g * (station - s0), grade: g };
}

/** The roadway's elevation at an offset from the alignment: the profile grade on the alignment, the crown at its offset. */
export function deckElevation(p: Profile, road: RoadwaySection, station: number, offset: number, vcs = profileGeometry(p)) {
  const ep = profileAt(p, station, vcs).elevation;
  const r = sectionAt(road, station);
  const c = r.crownOffset;
  const ridge = c >= 0 ? ep - r.leftSlope * c : ep + r.rightSlope * c;
  return offset >= c ? ridge + r.rightSlope * (offset - c) : ridge + r.leftSlope * (c - offset);
}

/** The roadway section at a station: the templates' slopes and crown offset straight-line between them (superelevation transitions). */
export function sectionAt(r: RoadwaySection, station: number): RoadwayTemplate {
  const t = [...(r.sections ?? [])].sort((a, b) => a.station - b.station);
  if (!t.length) return { station, leftSlope: r.leftSlope, rightSlope: r.rightSlope, crownOffset: r.crownOffset };
  if (station <= t[0].station) return { ...t[0], station };
  if (station >= t[t.length - 1].station) return { ...t[t.length - 1], station };
  const k = t.findIndex((x) => x.station > station);
  const a = t[k - 1];
  const b = t[k];
  const f = (station - a.station) / (b.station - a.station);
  const lerp = (u: number, v: number) => u + (v - u) * f;
  return { station, leftSlope: lerp(a.leftSlope, b.leftSlope), rightSlope: lerp(a.rightSlope, b.rightSlope), crownOffset: lerp(a.crownOffset, b.crownOffset) };
}

/** The cross slope (ft/ft, + rising to the right) at an offset (at a station, with superelevation transitions). */
export const crossSlopeAt = (road: RoadwaySection, offset: number, station?: number) => {
  const r = station === undefined ? road : sectionAt(road, station);
  return offset >= r.crownOffset ? r.rightSlope : -r.leftSlope;
};

/** An azimuth as a surveyor's bearing: N 45°30'00" E. */
export function bearingText(az: number) {
  const a = ((az % 360) + 360) % 360;
  const [ns, ew, ang] = a <= 90 ? ["N", "E", a] : a <= 180 ? ["S", "E", 180 - a] : a <= 270 ? ["S", "W", a - 180] : ["N", "W", 360 - a];
  const d = Math.floor(ang + 1e-9);
  const mf = (ang - d) * 60;
  const m = Math.floor(mf + 1e-9);
  const sec = Math.round((mf - m) * 60);
  return `${ns} ${d}°${String(m).padStart(2, "0")}'${String(sec).padStart(2, "0")}" ${ew}`;
}

/** A station as 12+34.56. */
export const stationText = (s: number) => {
  const sign = s < 0 ? "-" : "";
  const v = Math.abs(s);
  const h = Math.floor(v / 100 + 1e-9);
  return `${sign}${h}+${(v - h * 100).toFixed(2).padStart(5, "0")}`;
};
