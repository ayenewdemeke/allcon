import { sweepSolid, type BridgeIfc, type IfcElement, type Profile, type V3 } from "./ifc";

// A rendered 3D schematic of the bridge for the calc package's front page: the IFC model's elements as
// triangles, seen in an axonometric view from above one side, faces shaded by a light from over the
// viewer's shoulder, hidden faces dropped and the rest drawn far to near (the painter's algorithm), long
// members cut every few feet so the order holds. An SVG, so it prints sharp.

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(...a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** A profile's outline (ft, in the placement's x–y). */
function outlineOf(p: Exclude<Profile, { kind: "mesh" }>): [number, number][] {
  if (p.kind === "rect") return [[-p.x / 2, -p.y / 2], [p.x / 2, -p.y / 2], [p.x / 2, p.y / 2], [-p.x / 2, p.y / 2]];
  if (p.kind === "circle") return Array.from({ length: 14 }, (_, k) => [p.r * Math.cos((2 * Math.PI * k) / 14), p.r * Math.sin((2 * Math.PI * k) / 14)] as [number, number]);
  if (p.kind === "ishape") {
    const [b, d, w, f] = [p.width / 2, p.depth / 2, p.web / 2, p.flange];
    return [[-b, -d], [b, -d], [b, -d + f], [w, -d + f], [w, d - f], [b, d - f], [b, d], [-b, d], [-b, d - f], [-w, d - f], [-w, -d + f], [-b, -d + f]];
  }
  return p.pts;
}

/** An element as world triangles (ft). */
export function elementTriangles(e: IfcElement, step = 8): V3[][] {
  if (e.profile.kind === "mesh") {
    const { pts, tris } = e.profile;
    return tris.map((t) => t.map((i) => pts[i]) as V3[]);
  }
  const Z = unit(e.zdir);
  let X = sub(e.xdir, [Z[0] * dot(e.xdir, Z), Z[1] * dot(e.xdir, Z), Z[2] * dot(e.xdir, Z)]);
  X = unit(X);
  const Y = cross(Z, X);
  const n = Math.max(1, Math.ceil(e.depth / step));
  const frames = Array.from({ length: n + 1 }, (_, k) => {
    const z = (e.depth * k) / n;
    return { p: [e.origin[0] + Z[0] * z, e.origin[1] + Z[1] * z, e.origin[2] + Z[2] * z] as V3, u: X, v: Y };
  });
  const { pts, tris } = sweepSolid(frames, outlineOf(e.profile));
  return tris.map((t) => t.map((i) => pts[i]) as V3[]);
}

export type RenderOptions = { width?: number; height?: number; azimuth?: number; elevation?: number; title?: string };

/**
 * The bridge as an SVG picture. azimuth: the view's turn from square to the bridge (deg, + toward its
 * start); elevation: how far above the horizon it looks down from (deg).
 */
export function renderBridgeSvg(m: BridgeIfc, o: RenderOptions = {}) {
  const width = o.width ?? 720;
  const height = o.height ?? 400;
  const elements = m.elements;
  // The bridge's direction in plan: its first element to its last, from the alignment's segments.
  const segs = m.alignment.segments;
  const a0 = segs.length ? segs[0].start : [0, 0];
  const last = segs[segs.length - 1];
  const a1 = last ? [last.start[0] + last.length * Math.cos(last.dir), last.start[1] + last.length * Math.sin(last.dir)] : [1, 0];
  const along = unit([a1[0] - a0[0], a1[1] - a0[1], 0]);
  // Look from the bridge's right side, turned toward its start, down from above.
  const az = ((o.azimuth ?? 30) * Math.PI) / 180;
  const el = ((o.elevation ?? 24) * Math.PI) / 180;
  const side: V3 = [along[1], -along[0], 0]; // to the bridge's right
  const h = unit([-side[0] * Math.cos(az) + along[0] * Math.sin(az), -side[1] * Math.cos(az) + along[1] * Math.sin(az), 0]); // horizontal, into the picture
  const view = unit([h[0] * Math.cos(el), h[1] * Math.cos(el), -Math.sin(el)]);
  const right = unit(cross(view, [0, 0, 1]));
  const up = cross(right, view);
  const light = unit([-view[0] + 0.3 * right[0], -view[1] + 0.3 * right[1], -view[2] + 0.9]);

  type Face = { pts: [number, number][]; depth: number; fill: string };
  const faces: Face[] = [];
  for (const e of elements) {
    const c = e.color ?? [0.7, 0.7, 0.7];
    // The deck, its rails and the approach slabs lie on what carries them: drawn after it (their faces
    // are large, and a centroid alone would let a girder flange just below show through).
    const bias = e.cls === "IfcSlab" || e.cls === "IfcRailing" ? 6 : 0;
    for (const t of elementTriangles(e)) {
      const nrm = unit(cross(sub(t[1], t[0]), sub(t[2], t[0])));
      if (dot(nrm, view) >= 0) continue; // facing away
      const k = 0.42 + 0.58 * Math.max(0, dot(nrm, light));
      const rgb = c.map((v) => Math.round(Math.min(1, v * k) * 255));
      faces.push({ pts: t.map((p) => [dot(p, right), -dot(p, up)] as [number, number]), depth: (dot(t[0], view) + dot(t[1], view) + dot(t[2], view)) / 3 - bias, fill: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` });
    }
  }
  faces.sort((p, q) => q.depth - p.depth); // far first
  const xs = faces.flatMap((f) => f.pts.map((p) => p[0]));
  const ys = faces.flatMap((f) => f.pts.map((p) => p[1]));
  const top = o.title ? 26 : 8;
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min((width - 16) / (x1 - x0 || 1), (height - top - 8) / (y1 - y0 || 1));
  const ox = (width - (x1 - x0) * s) / 2 - x0 * s;
  const oy = top + (height - top - 8 - (y1 - y0) * s) / 2 - y0 * s;
  const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
  const polys = faces.map((f) => `<polygon points="${f.pts.map((p) => `${f1(p[0] * s + ox)},${f1(p[1] * s + oy)}`).join(" ")}" fill="${f.fill}" stroke="${f.fill}" stroke-width="0.4"/>`);
  const title = o.title ? `<text x="${width / 2}" y="16" font-size="12" font-weight="bold" text-anchor="middle" fill="#171717">${o.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>` : "";
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">${title}${polys.join("")}</svg>`;
}
