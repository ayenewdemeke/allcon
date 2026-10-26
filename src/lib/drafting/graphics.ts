import earcut from "earcut";
import { add, angleOf, arcPoints, dist, mul, normalizeAngle, perp, polar, sub, sweepOf, unit, type Graphics, type TextRun, setAnnotationGraphics } from "./geometry";
import { formatLength, trimNumber } from "./units";
import type { DimensionEntity, DimStyle, Entity, HatchEntity, LeaderEntity, MTextEntity, TextEntity, TextStyle, Units, Vec } from "./types";

// What annotation objects (text, dimensions, leaders, hatches) look like: lines, filled areas
// and text runs, worked out from the object and its style. Styles come from the open drawing.

type Styles = { units: Units; text: Map<string, TextStyle>; dim: Map<string, DimStyle>; version: number };

let styles: Styles = { units: "architectural", text: new Map(), dim: new Map(), version: 0 };

/** The open drawing's styles, used to draw its annotations. */
export function applyStyles(next: Omit<Styles, "version">) {
  styles = { ...next, version: styles.version + 1 };
}

const FALLBACK_TEXT: TextStyle = { name: "Standard", font: "Arial", widthFactor: 1 };
const textStyle = (name: string) => styles.text.get(name) ?? styles.text.values().next().value ?? FALLBACK_TEXT;
export function dimStyle(name: string): DimStyle {
  return (
    styles.dim.get(name) ??
    styles.dim.values().next().value ?? { name, textHeight: 3 / 32, arrowSize: 3 / 32, arrow: "closed", extOffset: 1 / 16, extBeyond: 1 / 8, textGap: 1 / 32, baselineSpacing: 3 / 8, scale: 1, textStyle: "Standard" }
  );
}

// --- text metrics -----------------------------------------------------------------------------

/** Capital-letter height as a share of the font size: AutoCAD's text height is the capitals'. */
const CAP_HEIGHT: Record<string, number> = { Arial: 0.716, Helvetica: 0.717, Verdana: 0.727, Tahoma: 0.727, "Times New Roman": 0.662, Georgia: 0.692, "Courier New": 0.571, "Segoe UI": 0.7 };
export const capRatio = (font: string) => CAP_HEIGHT[font] ?? 0.7;
export const TEXT_FONTS = Object.keys(CAP_HEIGHT);

let measureCtx: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/** Text width for a text height, measured with the real font in the browser (estimated elsewhere). */
export function textWidth(text: string, height: number, font: string, widthFactor = 1) {
  const key = `${font}\n${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    if (measureCtx === undefined) measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (measureCtx) {
      measureCtx.font = `100px "${font}", sans-serif`;
      w = measureCtx.measureText(text).width / 100 / capRatio(font);
    } else w = text.length * 0.78;
    widths.set(key, w);
  }
  return w * height * widthFactor;
}

/** The corners of a text run's box (for selecting and highlighting). */
export function textBox(run: TextRun): Vec[] {
  const w = textWidth(run.text, run.height, run.font, run.widthFactor);
  const x0 = run.halign === "left" ? 0 : run.halign === "center" ? -w / 2 : -w;
  const base = run.valign === "baseline" ? 0 : run.valign === "bottom" ? run.height * 0.3 : run.valign === "middle" ? -run.height / 2 : -run.height;
  const [y0, y1] = [base - run.height * 0.3, base + run.height * 1.05];
  const c = Math.cos(run.rotation);
  const s = Math.sin(run.rotation);
  const at = (x: number, y: number) => ({ x: run.at.x + x * c - y * s, y: run.at.y + x * s + y * c });
  return [at(x0, y0), at(x0 + w, y0), at(x0 + w, y1), at(x0, y1)];
}

/** Text runs, laid out: single-line text, or multiline text wrapped to its width. */
function textRuns(e: TextEntity | MTextEntity): TextRun[] {
  const style = textStyle(e.style);
  if (e.type === "text") return [{ at: e.at, text: e.text, height: e.height, rotation: e.rotation, font: style.font, widthFactor: style.widthFactor, halign: e.halign, valign: e.valign }];
  const lines: string[] = [];
  for (const paragraph of e.text.split("\n")) {
    if (!e.width) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      if (line.trim() && textWidth(next.trimEnd(), e.height, style.font, style.widthFactor) > e.width) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  const spacing = (e.height * 5) / 3; // AutoCAD's default line spacing
  const down = { x: Math.sin(e.rotation), y: -Math.cos(e.rotation) };
  return lines.map((text, i) => ({
    at: add(e.at, mul(down, e.height + i * spacing)),
    text,
    height: e.height,
    rotation: e.rotation,
    font: style.font,
    widthFactor: style.widthFactor,
    halign: "left",
    valign: "baseline",
  }));
}

// --- dimensions ----------------------------------------------------------------------------

/** An arrowhead with its tip at `tip`, pointing along `dir`. */
function arrowhead(g: Graphics, tip: Vec, dir: Vec, size: number, kind: DimStyle["arrow"]) {
  const d = unit(dir);
  const n = perp(d);
  if (kind === "tick") {
    const slash = unit(add(d, n));
    g.lines.push([add(tip, mul(slash, -size / 2)), add(tip, mul(slash, size / 2))]);
  } else if (kind === "dot") {
    g.fills.push(arcPoints(tip, size / 4, 0, Math.PI * 2, 24).slice(0, -1));
  } else if (kind === "open") {
    const back = add(tip, mul(d, -size));
    g.lines.push([add(back, mul(n, size / 6)), tip, add(back, mul(n, -size / 6))]);
  } else {
    const back = add(tip, mul(d, -size));
    g.fills.push([tip, add(back, mul(n, size / 6)), add(back, mul(n, -size / 6))]);
  }
}

/** Text placed along a direction, turned to read left to right or bottom to top. */
function readable(angle: number) {
  const a = normalizeAngle(angle);
  return a > Math.PI / 2 + 1e-9 && a <= (3 * Math.PI) / 2 + 1e-9 ? a - Math.PI : a;
}

export function dimMeasurement(e: DimensionEntity): number {
  switch (e.kind) {
    case "linear": {
      const u = { x: Math.cos(e.angle), y: Math.sin(e.angle) };
      return Math.abs((e.p2.x - e.p1.x) * u.x + (e.p2.y - e.p1.y) * u.y);
    }
    case "aligned":
      return dist(e.p1, e.p2);
    case "angular":
      return angularSweep(e);
    case "radius":
      return dist(e.center, e.p1);
    case "diameter":
      return dist(e.center, e.p1) * 2;
  }
}

/** The angle an angular dimension spans: between its two sides, on the side its arc is on. */
function angularSweep(e: DimensionEntity) {
  const a1 = angleOf(e.center, e.p1);
  const a2 = angleOf(e.center, e.p2);
  const at = angleOf(e.center, e.loc);
  const s = sweepOf(a1, a2);
  return normalizeAngle(at - a1) <= s ? s : Math.PI * 2 - s;
}

export function dimText(e: DimensionEntity): string {
  const m = dimMeasurement(e);
  const value =
    e.kind === "angular"
      ? `${trimNumber((m * 180) / Math.PI, 0)}°`
      : `${e.kind === "radius" ? "R" : e.kind === "diameter" ? "Ø" : ""}${formatLength(m, styles.units)}`;
  return e.text ? e.text.replace("<>", value) : value;
}

function dimension(e: DimensionEntity): Graphics {
  const st = dimStyle(e.style);
  const s = st.scale;
  const [arrow, th, exo, exe, gap] = [st.arrowSize * s, st.textHeight * s, st.extOffset * s, st.extBeyond * s, st.textGap * s];
  const font = textStyle(st.textStyle);
  const g: Graphics = { lines: [], fills: [], texts: [] };
  const text = dimText(e);
  const label = (at: Vec, angle: number, valign: TextRun["valign"] = "bottom", halign: TextRun["halign"] = "center") =>
    g.texts.push({ at, text, height: th, rotation: angle, font: font.font, widthFactor: font.widthFactor, halign, valign });

  if (e.kind === "linear" || e.kind === "aligned") {
    const angle = e.kind === "aligned" ? angleOf(e.p1, e.p2) : e.angle;
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const n = perp(u);
    const offset = (p: Vec) => (e.loc.x - p.x) * n.x + (e.loc.y - p.y) * n.y;
    const d1 = add(e.p1, mul(n, offset(e.p1)));
    const d2 = add(e.p2, mul(n, offset(e.p2)));
    for (const [p, d] of [
      [e.p1, d1],
      [e.p2, d2],
    ] as const) {
      const toward = unit(sub(d, p));
      if (dist(p, d) > exo) g.lines.push([add(p, mul(toward, exo)), add(d, mul(toward, exe))]);
    }
    const along = unit(sub(d2, d1));
    const length = dist(d1, d2);
    const textW = textWidth(text, th, font.font, font.widthFactor);
    const inside = length >= 2 * arrow + (st.arrow === "tick" ? 0 : arrow);
    g.lines.push([d1, d2]);
    if (inside) {
      arrowhead(g, d1, mul(along, -1), arrow, st.arrow);
      arrowhead(g, d2, along, arrow, st.arrow);
    } else {
      // Too tight: arrows outside, pointing in, with the dimension line carried past them.
      g.lines.push([d1, add(d1, mul(along, -arrow * 2))], [d2, add(d2, mul(along, arrow * 2))]);
      arrowhead(g, d1, along, arrow, st.arrow);
      arrowhead(g, d2, mul(along, -1), arrow, st.arrow);
    }
    const rot = readable(angleOf(d1, d2));
    const up = { x: -Math.sin(rot), y: Math.cos(rot) };
    const middle = add(add(d1, mul(sub(d2, d1), 0.5)), mul(up, gap));
    label(textW + gap * 2 > length && !inside ? add(middle, mul(up, th * 0.2)) : middle, rot);
    return g;
  }

  if (e.kind === "angular") {
    const r = dist(e.center, e.loc);
    const a1 = angleOf(e.center, e.p1);
    const a2 = angleOf(e.center, e.p2);
    const at = angleOf(e.center, e.loc);
    const s12 = sweepOf(a1, a2);
    const [start, sweep] = normalizeAngle(at - a1) <= s12 ? [a1, s12] : [a2, Math.PI * 2 - s12];
    g.lines.push(arcPoints(e.center, r, start, sweep, 96));
    // Extension lines from the sides out to the arc, where the arc is beyond them.
    for (const [p, a] of [
      [e.p1, a1],
      [e.p2, a2],
    ] as const) {
      if (dist(e.center, p) < r - exo) g.lines.push([polar(e.center, a, dist(e.center, p) + exo), polar(e.center, a, r + exe)]);
    }
    const startPt = polar(e.center, start, r);
    const endPt = polar(e.center, start + sweep, r);
    arrowhead(g, startPt, { x: Math.sin(start), y: -Math.cos(start) }, arrow, st.arrow);
    arrowhead(g, endPt, { x: -Math.sin(start + sweep), y: Math.cos(start + sweep) }, arrow, st.arrow);
    const midA = start + sweep / 2;
    const tangent = readable(midA - Math.PI / 2);
    label(polar(e.center, midA, r + gap), tangent);
    return g;
  }

  // Radius and diameter: a line through the centre towards the text, arrows on the circle.
  const r = dist(e.center, e.p1);
  const dir = unit(sub(e.loc, e.center));
  const onCircle = add(e.center, mul(dir, r));
  const outside = dist(e.center, e.loc) > r;
  if (e.kind === "radius") {
    g.lines.push([outside ? onCircle : e.center, e.loc]);
    if (outside) arrowhead(g, onCircle, mul(dir, -1), arrow, st.arrow);
    else {
      g.lines.push([e.center, onCircle]);
      arrowhead(g, onCircle, dir, arrow, st.arrow);
    }
  } else {
    const opposite = sub(e.center, mul(dir, r));
    g.lines.push([opposite, outside ? e.loc : onCircle]);
    arrowhead(g, onCircle, outside ? mul(dir, -1) : dir, arrow, st.arrow);
    arrowhead(g, opposite, mul(dir, -1), arrow, st.arrow);
  }
  // A short landing, then horizontal text, as AutoCAD draws radial dimensions.
  const right = dir.x >= 0;
  const landing = add(e.loc, { x: right ? arrow : -arrow, y: 0 });
  g.lines.push([e.loc, landing]);
  label(add(landing, { x: right ? gap : -gap, y: 0 }), 0, "middle", right ? "left" : "right");
  return g;
}

function leader(e: LeaderEntity): Graphics {
  const st = dimStyle(e.dimStyle);
  const arrow = st.arrowSize * st.scale;
  const font = textStyle(e.style);
  const g: Graphics = { lines: [], fills: [], texts: [] };
  if (e.points.length < 2) return g;
  g.lines.push(e.points);
  const [tip, next] = e.points;
  arrowhead(g, tip, sub(tip, next), arrow, st.arrow === "tick" ? "closed" : st.arrow);
  const end = e.points[e.points.length - 1];
  const prev = e.points[e.points.length - 2];
  const right = end.x >= prev.x;
  const landingEnd = add(end, { x: right ? arrow * 2 : -arrow * 2, y: 0 });
  g.lines.push([end, landingEnd]);
  const lines = e.text.split("\n");
  const spacing = (e.height * 5) / 3;
  const top = landingEnd.y + ((lines.length - 1) * spacing) / 2;
  lines.forEach((text, i) =>
    g.texts.push({ at: { x: landingEnd.x + (right ? arrow / 2 : -arrow / 2), y: top - i * spacing }, text, height: e.height, rotation: 0, font: font.font, widthFactor: font.widthFactor, halign: right ? "left" : "right", valign: "middle" }),
  );
  return g;
}

// --- hatches --------------------------------------------------------------------------------

/** Pattern line families as in AutoCAD's acad.pat (inches): angle (degrees), origin, offset along and across, dashes. */
type Family = { angle: number; origin: [number, number]; delta: [number, number]; dashes: number[] };
export const HATCH_PATTERNS: Record<string, { description: string; families: Family[] }> = {
  SOLID: { description: "Solid fill", families: [] },
  ANSI31: { description: "ANSI Iron, Brick, Stone masonry", families: [{ angle: 45, origin: [0, 0], delta: [0, 0.125], dashes: [] }] },
  ANSI32: {
    description: "ANSI Steel",
    families: [
      { angle: 45, origin: [0, 0], delta: [0, 0.375], dashes: [] },
      { angle: 45, origin: [0.176776695, 0], delta: [0, 0.375], dashes: [] },
    ],
  },
  ANSI33: {
    description: "ANSI Bronze, Brass, Copper",
    families: [
      { angle: 45, origin: [0, 0], delta: [0, 0.25], dashes: [] },
      { angle: 45, origin: [0.176776695, 0], delta: [0, 0.25], dashes: [0.125, -0.0625] },
    ],
  },
  ANSI37: {
    description: "ANSI Lead, Zinc, Magnesium, Sound/Heat/Elec Insulation",
    families: [
      { angle: 45, origin: [0, 0], delta: [0, 0.125], dashes: [] },
      { angle: 135, origin: [0, 0], delta: [0, 0.125], dashes: [] },
    ],
  },
  LINE: { description: "Parallel horizontal lines", families: [{ angle: 0, origin: [0, 0], delta: [0, 0.125], dashes: [] }] },
  NET: {
    description: "Horizontal / vertical grid",
    families: [
      { angle: 0, origin: [0, 0], delta: [0, 0.125], dashes: [] },
      { angle: 90, origin: [0, 0], delta: [0, 0.125], dashes: [] },
    ],
  },
  DASH: { description: "Dashed lines", families: [{ angle: 0, origin: [0, 0], delta: [0.125, 0.125], dashes: [0.125, -0.125] }] },
  DOTS: { description: "A series of dots", families: [{ angle: 0, origin: [0, 0], delta: [0.03125, 0.0625], dashes: [0, -0.0625] }] },
};

/** Where a line crosses the loops (even-odd), as parameters along it, sorted. */
function crossings(o: Vec, d: Vec, loops: Vec[][]) {
  const ts: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const e = sub(b, a);
      const den = d.x * e.y - d.y * e.x;
      if (Math.abs(den) < 1e-12) continue;
      const w = sub(a, o);
      const t = (w.x * e.y - w.y * e.x) / den;
      const u = (w.x * d.y - w.y * d.x) / den;
      if (u >= 0 && u < 1) ts.push(t);
    }
  }
  return ts.sort((x, y) => x - y);
}

const MAX_HATCH_LINES = 4000;

function hatch(e: HatchEntity): Graphics {
  const g: Graphics = { lines: [], fills: [], texts: [] };
  const loops = e.loops.filter((l) => l.length >= 3);
  if (!loops.length) return g;
  const pattern = HATCH_PATTERNS[e.pattern] ?? HATCH_PATTERNS.ANSI31;
  if (!pattern.families.length) {
    // Solid: triangulated, the first loop outside and the others as holes (even-odd).
    const [outer, ...holes] = loops;
    const flat: number[] = [];
    const holeIndex: number[] = [];
    for (const p of outer) flat.push(p.x, p.y);
    for (const h of holes) {
      holeIndex.push(flat.length / 2);
      for (const p of h) flat.push(p.x, p.y);
    }
    const tri = earcut(flat, holeIndex.length ? holeIndex : undefined);
    for (let i = 0; i < tri.length; i += 3) g.fills.push([0, 1, 2].map((k) => ({ x: flat[tri[i + k] * 2], y: flat[tri[i + k] * 2 + 1] })));
    return g;
  }
  const unitScale = (styles.units === "mm" ? 25.4 : 1) * e.scale;
  const all = loops.flat();
  for (const fam of pattern.families) {
    const angle = (fam.angle * Math.PI) / 180 + e.angle;
    const d = { x: Math.cos(angle), y: Math.sin(angle) };
    const n = perp(d);
    const spacing = Math.abs(fam.delta[1]) * unitScale;
    if (spacing < 1e-9) continue;
    const shift = fam.delta[0] * unitScale;
    const origin = { x: fam.origin[0] * unitScale, y: fam.origin[1] * unitScale };
    const across = all.map((p) => (p.x - origin.x) * n.x + (p.y - origin.y) * n.y);
    const lo = Math.ceil(Math.min(...across) / spacing);
    const hi = Math.floor(Math.max(...across) / spacing);
    if (hi - lo > MAX_HATCH_LINES) return { lines: [], fills: [], texts: [] }; // too dense to draw (AutoCAD refuses these)
    const dashes = fam.dashes.map((x) => x * unitScale);
    const period = dashes.reduce((sum, x) => sum + Math.abs(x), 0);
    for (let k = lo; k <= hi; k++) {
      const o = add(add(origin, mul(n, k * spacing)), mul(d, k * shift));
      const ts = crossings(o, d, loops);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const [t0, t1] = [ts[i], ts[i + 1]];
        if (!dashes.length) {
          g.lines.push([add(o, mul(d, t0)), add(o, mul(d, t1))]);
          continue;
        }
        // Dashes run from the pattern origin, so neighbouring areas line up.
        let t = Math.floor(t0 / period) * period;
        while (t < t1) {
          for (const dash of dashes) {
            const len = Math.abs(dash);
            const [a, b] = [Math.max(t, t0), Math.min(t + (dash === 0 ? 0 : len), t1)];
            if (dash >= 0 && b >= a && a <= t1) g.lines.push(dash === 0 ? [add(o, mul(d, a)), add(o, mul(d, a + spacing * 0.02))] : [add(o, mul(d, a)), add(o, mul(d, b))]);
            t += len;
            if (t >= t1) break;
          }
        }
      }
    }
  }
  return g;
}

// --- all annotations --------------------------------------------------------------------

const cache = new WeakMap<Entity, { version: number; g: Graphics }>();

function annotationGraphics(e: Entity): Graphics {
  const hit = cache.get(e);
  if (hit && hit.version === styles.version) return hit.g;
  let g: Graphics;
  switch (e.type) {
    case "text":
    case "mtext":
      g = { lines: [], fills: [], texts: textRuns(e) };
      break;
    case "attdef": {
      // Outside a block an attribute definition shows its tag.
      const style = textStyle(e.style);
      g = { lines: [], fills: [], texts: [{ at: e.at, text: e.tag, height: e.height, rotation: e.rotation, font: style.font, widthFactor: style.widthFactor, halign: e.halign, valign: e.valign }] };
      break;
    }
    case "dimension":
      g = dimension(e);
      break;
    case "leader":
      g = leader(e);
      break;
    case "hatch":
      g = hatch(e);
      break;
    default:
      g = { lines: [], fills: [], texts: [] };
  }
  cache.set(e, { version: styles.version, g });
  return g;
}

setAnnotationGraphics(annotationGraphics, textBox);
