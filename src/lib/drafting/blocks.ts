import { applyXf, isFullEllipse, setBlockParts, transform, type Xform } from "./geometry";
import { newId } from "./ids";
import { LW_BYBLOCK, type AttdefEntity, type Block, type Entity, type InsertEntity, type TextEntity, type Vec } from "./types";

// Blocks, as AutoCAD's: a definition (objects about a base point) and references that place it,
// moved, scaled and rotated. A reference draws, picks and snaps as its block's objects put in
// place. Objects on layer 0 take the reference's layer, ByBlock colours and lineweights its own,
// and attribute definitions show the reference's values.

let table = new Map<string, Block>();
let version = 0;

/** The open drawing's blocks, used to draw its references. */
export function applyBlocks(blocks: Map<string, Block>) {
  table = blocks;
  version++;
}

export const blockDef = (name: string) => table.get(name);

/** The attributes a reference of this block asks for, in drawing order. */
export const attributeDefs = (block: Block | undefined) =>
  (block?.entities ?? []).filter((e): e is AttdefEntity => e.type === "attdef");

const TAU = Math.PI * 2;

/** Where a reference puts its block's objects: p → at + R(rotation)·S(scale)·(p − base). */
export function insertXform(e: Pick<InsertEntity, "at" | "scale" | "rotation">, base: Vec): Xform {
  const c = Math.cos(e.rotation);
  const s = Math.sin(e.rotation);
  const [a, b, cc, d] = [c * e.scale.x, -s * e.scale.y, s * e.scale.x, c * e.scale.y];
  return { a, b, c: cc, d, tx: e.at.x - (a * base.x + b * base.y), ty: e.at.y - (cc * base.x + d * base.y) };
}

const compose = (p: Xform, q: Xform): Xform => ({
  a: p.a * q.a + p.b * q.c,
  b: p.a * q.b + p.b * q.d,
  c: p.c * q.a + p.d * q.c,
  d: p.c * q.b + p.d * q.d,
  tx: p.a * q.tx + p.b * q.ty + p.tx,
  ty: p.c * q.tx + p.d * q.ty + p.ty,
});

const linear = (x: Xform, v: Vec): Vec => ({ x: x.a * v.x + x.b * v.y, y: x.c * v.x + x.d * v.y });
const length = (v: Vec) => Math.hypot(v.x, v.y);
const angle = (v: Vec) => Math.atan2(v.y, v.x);

/** Whether a transform keeps shapes (rotation, uniform scale, mirror): circles stay circles. */
function similar(x: Xform) {
  const k1 = x.a * x.a + x.c * x.c;
  const k2 = x.b * x.b + x.d * x.d;
  return Math.abs(k1 - k2) <= 1e-9 * Math.max(k1, k2) && Math.abs(x.a * x.b + x.c * x.d) <= 1e-9 * Math.max(k1, k2);
}

/** An ellipse (centre, axis vectors u and v, parameters) under any affine transform. */
function affineEllipse<T extends Entity>(base: T, center: Vec, u: Vec, v: Vec, start: number, end: number, full: boolean, x: Xform): Entity {
  const U = linear(x, u);
  const V = linear(x, v);
  // The new axes are where the transformed ellipse is longest and shortest.
  let t0 = 0.5 * Math.atan2(2 * (U.x * V.x + U.y * V.y), U.x * U.x + U.y * U.y - (V.x * V.x + V.y * V.y));
  const at = (t: number) => ({ x: U.x * Math.cos(t) + V.x * Math.sin(t), y: U.y * Math.cos(t) + V.y * Math.sin(t) });
  if (length(at(t0 + Math.PI / 2)) > length(at(t0))) t0 += Math.PI / 2;
  const major = at(t0);
  const minor = at(t0 + Math.PI / 2);
  const ratio = Math.min(length(minor) / Math.max(length(major), 1e-12), 1);
  const ccw = major.x * minor.y - major.y * minor.x > 0;
  const range = full ? { start: 0, end: TAU } : ccw ? { start: start - t0, end: end - t0 } : { start: t0 - end, end: t0 - start };
  return { ...base, type: "ellipse", center: applyXf(x, center), major, ratio, ...range } as Entity;
}

/** An object under any affine transform: exact for shapes, close for text under uneven scale. */
export function transformAffine(e: Entity, x: Xform): Entity {
  if (similar(x)) return transform(e, x);
  const map = (p: Vec) => applyXf(x, p);
  const k = Math.sqrt(Math.abs(x.a * x.d - x.b * x.c));
  switch (e.type) {
    case "line":
      return { ...e, a: map(e.a), b: map(e.b) };
    case "polyline":
      return { ...e, points: e.points.map(map), bulges: e.points.map(() => 0) };
    case "spline":
      return { ...e, fit: e.fit.map(map) };
    case "xline":
    case "ray": {
      const d = linear(x, e.dir);
      return { ...e, base: map(e.base), dir: { x: d.x / length(d), y: d.y / length(d) } };
    }
    case "circle":
      return affineEllipse(e, e.center, { x: e.radius, y: 0 }, { x: 0, y: e.radius }, 0, TAU, true, x);
    case "arc":
      return affineEllipse(e, e.center, { x: e.radius, y: 0 }, { x: 0, y: e.radius }, e.start, e.end, false, x);
    case "ellipse": {
      const v = { x: -e.major.y * e.ratio, y: e.major.x * e.ratio };
      return affineEllipse(e, e.center, e.major, v, e.start, e.end, isFullEllipse(e), x);
    }
    case "text":
    case "mtext":
    case "attdef": {
      const along = linear(x, { x: Math.cos(e.rotation), y: Math.sin(e.rotation) });
      const up = linear(x, { x: -Math.sin(e.rotation), y: Math.cos(e.rotation) });
      return { ...e, at: map(e.at), rotation: angle(along), height: e.height * length(up), ...(e.type === "mtext" ? { width: e.width * length(along) } : {}) };
    }
    case "dimension":
      return { ...e, p1: map(e.p1), p2: map(e.p2), loc: map(e.loc), center: map(e.center), angle: angle(linear(x, { x: Math.cos(e.angle), y: Math.sin(e.angle) })) };
    case "leader":
      return { ...e, points: e.points.map(map), height: e.height * k };
    case "hatch":
      return { ...e, loops: e.loops.map((l) => l.map(map)), scale: e.scale * k, angle: angle(linear(x, { x: Math.cos(e.angle), y: Math.sin(e.angle) })), seeds: undefined };
    case "insert": {
      // A nested reference: kept as a reference with the transform folded in where it can be.
      const def = table.get(e.block);
      const xf = compose(x, insertXform(e, def?.base ?? e.at));
      return { ...e, at: applyXf(xf, def?.base ?? e.at), rotation: angle({ x: xf.a, y: xf.c }), scale: { x: length({ x: xf.a, y: xf.c }), y: length({ x: xf.b, y: xf.d }) } };
    }
    case "image": {
      const along = linear(x, { x: Math.cos(e.rotation), y: Math.sin(e.rotation) });
      const up = linear(x, { x: -Math.sin(e.rotation), y: Math.cos(e.rotation) });
      return { ...e, at: map(e.at), rotation: angle(along), width: e.width * length(along), height: e.height * length(up) };
    }
  }
}

type Owner = Pick<InsertEntity, "layer" | "color" | "lineweight">;

/** An attribute definition as the text a reference shows (null: invisible). */
function attributeText(d: AttdefEntity, attribs: Record<string, string>): TextEntity | null {
  if (d.invisible) return null;
  const { tag, prompt, value, invisible, ...rest } = d;
  void prompt;
  void invisible;
  return { ...rest, type: "text", text: attribs[tag] ?? value };
}

const MAX_DEPTH = 8;

function collect(block: Block, attribs: Record<string, string>, x: Xform, owner: Owner, prefix: string, depth: number, out: Entity[]) {
  block.entities.forEach((child, i) => {
    const id = `${prefix}:${i}`;
    let e: Entity | null = child;
    if (e.type === "attdef") e = attributeText(e, attribs);
    if (!e) return;
    const layer = e.layer === "0" ? owner.layer : e.layer;
    const color = e.color === 0 ? owner.color : e.color;
    const lineweight = e.lineweight === LW_BYBLOCK ? owner.lineweight : e.lineweight;
    if (e.type === "insert") {
      const def = table.get(e.block);
      if (!def || depth >= MAX_DEPTH) return;
      collect(def, e.attribs, compose(x, insertXform(e, def.base)), { layer, color, lineweight }, id, depth + 1, out);
      return;
    }
    out.push({ ...transformAffine(e, x), id, layer, color, lineweight } as Entity);
  });
}

const cache = new WeakMap<InsertEntity, { version: number; parts: Entity[] }>();

/** A reference's objects as they're drawn: in place, with layer and colour resolved. */
export function blockParts(e: InsertEntity): Entity[] {
  const hit = cache.get(e);
  if (hit && hit.version === version) return hit.parts;
  const def = table.get(e.block);
  const parts: Entity[] = [];
  if (def) collect(def, e.attribs, insertXform(e, def.base), e, e.id, 0, parts);
  cache.set(e, { version, parts });
  return parts;
}

setBlockParts(blockParts);

/** EXPLODE: a reference becomes its block's objects in place, keeping their own layers and
 * colours (nested references stay references; attributes go back to their definitions). */
export function explodeInsert(e: InsertEntity): Entity[] {
  const def = table.get(e.block);
  if (!def) return [];
  const x = insertXform(e, def.base);
  return def.entities.map((child) => ({ ...transformAffine(child, x), id: newId() }));
}

/** The blocks a block's objects use, directly or nested (for PURGE and to refuse loops). */
export function nestedBlocks(name: string, seen = new Set<string>()): Set<string> {
  for (const e of table.get(name)?.entities ?? []) {
    if (e.type === "insert" && !seen.has(e.block)) {
      seen.add(e.block);
      nestedBlocks(e.block, seen);
    }
  }
  return seen;
}
