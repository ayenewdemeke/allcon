import type { ModelElement, ModelOpening, ModelSpec, Profile } from "./spec";
import { METERS_PER_UNIT } from "./spec";

// Geometry shared by the IFC compiler and the model summary: profile areas, sizes, and the
// local frame a profile is swept in.

export type Vec3 = [number, number, number];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Area of a plan outline, in model units². */
export function polygonArea(points: [number, number][]) {
  let a = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  });
  return Math.abs(a) / 2;
}

/** Cross-section area in model units². */
export function profileArea(p: Profile): number {
  switch (p.kind) {
    case "rect":
      return p.width * p.depth;
    case "circle":
      return Math.PI * p.radius ** 2;
    case "tube":
      return Math.PI * (p.radius ** 2 - Math.max(0, p.radius - p.wall) ** 2);
    case "i":
    case "channel":
      return 2 * p.flange_width * p.flange_thickness + Math.max(0, p.depth - 2 * p.flange_thickness) * p.web_thickness;
    case "tee":
      return p.flange_width * p.flange_thickness + Math.max(0, p.depth - p.flange_thickness) * p.web_thickness;
    case "angle":
      return p.thickness * (p.depth + p.width - p.thickness);
    case "polygon":
      return polygonArea(p.points);
  }
}

/** Width (local x) and depth (local y) of a profile's bounding box. */
export function profileSize(p: Profile): { width: number; depth: number } {
  switch (p.kind) {
    case "rect":
      return { width: p.width, depth: p.depth };
    case "circle":
    case "tube":
      return { width: 2 * p.radius, depth: 2 * p.radius };
    case "i":
    case "tee":
    case "channel":
      return { width: p.flange_width, depth: p.depth };
    case "angle":
      return { width: p.width, depth: p.depth };
    case "polygon": {
      const xs = p.points.map((q) => q[0]);
      const ys = p.points.map((q) => q[1]);
      return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) };
    }
  }
}

/** Straight segments of an element's path, skipping zero-length ones. */
export function segments(e: ModelElement): { start: Vec3; end: Vec3; length: number }[] {
  const out: { start: Vec3; end: Vec3; length: number }[] = [];
  for (let i = 1; i < e.path.length; i++) {
    const start = e.path[i - 1] as Vec3;
    const end = e.path[i] as Vec3;
    const length = norm(sub(end, start));
    if (length > 1e-9) out.push({ start, end, length });
  }
  return out;
}

/**
 * The frame a profile is swept in along a segment: z along the segment, and for horizontal or
 * sloping segments y up and x across; for vertical ones the profile lies in plan (x east,
 * y north). `rotation` turns the profile about the segment.
 */
export function sweepFrame(dir: Vec3, rotationDeg: number): { x: Vec3; y: Vec3; z: Vec3; vertical: boolean } {
  const z = unit(dir);
  const vertical = Math.abs(z[2]) > 0.999;
  let x: Vec3, y: Vec3;
  if (vertical) {
    x = [1, 0, 0];
    y = z[2] > 0 ? [0, 1, 0] : [0, -1, 0]; // the compiler extrudes vertical segments upwards
  } else {
    const up: Vec3 = [0, 0, 1];
    y = unit(sub(up, [z[0] * z[2], z[1] * z[2], z[2] * z[2]]));
    x = cross(y, z);
  }
  if (rotationDeg) {
    const r = (rotationDeg * Math.PI) / 180;
    const [c, s] = [Math.cos(r), Math.sin(r)];
    const xr: Vec3 = [x[0] * c + y[0] * s, x[1] * c + y[1] * s, x[2] * c + y[2] * s];
    const yr: Vec3 = [y[0] * c - x[0] * s, y[1] * c - x[1] * s, y[2] * c - x[2] * s];
    x = xr;
    y = yr;
  }
  return { x, y, z, vertical };
}

/** How far the profile is shifted along its local y so the path runs through its top, bottom or centre. */
export function anchorOffset(e: ModelElement, vertical: boolean): number {
  if (vertical || e.profile.kind === "polygon" || e.anchor === "center") return 0;
  const { depth } = profileSize(e.profile);
  return e.anchor === "bottom" ? depth / 2 : -depth / 2;
}

/** Volume in m³ and length in model units of one element. */
export function elementQuantities(e: ModelElement, spec: Pick<ModelSpec, "units">) {
  const length = segments(e).reduce((s, g) => s + g.length, 0);
  const m = METERS_PER_UNIT[spec.units];
  return { length, volumeM3: profileArea(e.profile) * length * m ** 3 };
}

/** Points on the outside of an element (profile corners at each end of each segment), for extents. */
export function elementCorners(e: ModelElement): Vec3[] {
  const out: Vec3[] = [];
  for (const seg of segments(e)) {
    const down = seg.end[2] < seg.start[2] && Math.abs(seg.end[2] - seg.start[2]) > 0.999 * seg.length;
    const [start, end] = down ? [seg.end, seg.start] : [seg.start, seg.end];
    const frame = sweepFrame(sub(end, start), e.rotation);
    const dy = anchorOffset(e, frame.vertical);
    let local: [number, number][];
    if (e.profile.kind === "polygon") local = e.profile.points;
    else {
      const { width, depth } = profileSize(e.profile);
      local = [[-width / 2, dy - depth / 2], [width / 2, dy - depth / 2], [width / 2, dy + depth / 2], [-width / 2, dy + depth / 2]];
    }
    for (const base of [start, end]) {
      for (const [lx, ly] of local) {
        out.push([base[0] + frame.x[0] * lx + frame.y[0] * ly, base[1] + frame.x[1] * lx + frame.y[1] * ly, base[2] + frame.x[2] * lx + frame.y[2] * ly]);
      }
    }
  }
  return out;
}

/**
 * Where an opening sits in its host wall: its centre, the wall's direction (along) and the
 * horizontal across-wall direction, and the wall's thickness. Null if the host isn't a wall
 * with a horizontal path long enough for the opening.
 */
export function openingPlacement(host: ModelElement, o: ModelOpening) {
  let remaining = o.offset + o.width / 2;
  for (const seg of segments(host)) {
    if (remaining > seg.length) {
      remaining -= seg.length;
      continue;
    }
    const frame = sweepFrame(sub(seg.end, seg.start), host.rotation);
    if (frame.vertical) return null;
    const { width: thickness, depth } = profileSize(host.profile);
    const baseOffset = anchorOffset(host, false) - depth / 2; // wall base, relative to the path
    const up = o.sill + o.height / 2 + baseOffset;
    const center: Vec3 = [0, 1, 2].map((i) => seg.start[i] + frame.z[i] * remaining + frame.y[i] * up) as Vec3;
    if (o.sill + o.height > depth + 1e-9) return null; // taller than the wall
    return { center, along: frame.z, across: frame.x, thickness };
  }
  return null;
}
