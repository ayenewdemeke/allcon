"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Dof6, Model } from "@/lib/bridge/model";
import type { Solid, SolidKind, Vec3 } from "@/lib/bridge/solids";

// The workspace's canvas: the model in 3D as analysis programs draw one. Members as shaded solids
// in their real shapes (or as lines, in wireframe), supports as pyramids, a ground grid and the
// axes; over it a result as color contours on the members, as diagrams off them, or the deflected
// shape; values, names and reactions as labels that follow the view. A click picks a member.

export type ViewName = "iso" | "top" | "front" | "side";
export type BridgeViewHandle = { view: (name: ViewName) => void };
/** Lines drawn over the model: a diagram's outline and its hatching (flat x, y, z pairs). */
export type Overlay = { outline: Float32Array; hatch: Float32Array; color: number };
/** A result as colors on the members: each element's value at its two ends, and the range. */
export type Contour = { values: Map<number, [number, number]>; min: number; max: number };
export type Label = { p: Vec3; text: string; tone?: "value" | "name" | "axis" };
export type Arrow = { p: Vec3; d: Vec3; color?: number }; // from p − d to p (the head at p)
export type Strip = { plan: [number, number][]; z: number; color: number };

const STOPS = [0x1d4ed8, 0x06b6d4, 0x22c55e, 0xeab308, 0xdc2626].map((c) => new THREE.Color(c));
/** The contour scale: blue (lowest) through green to red (highest), t from 0 to 1. */
export function contourColor(t: number): THREE.Color {
  const x = Math.min(Math.max(t, 0), 1) * (STOPS.length - 1);
  const k = Math.min(Math.floor(x), STOPS.length - 2);
  return STOPS[k].clone().lerp(STOPS[k + 1], x - k);
}
export const contourCss = (t: number) => `#${contourColor(t).getHexString()}`;

const WIRE = { girder: 0x1f2937, strip: 0xcbd5e1, diaphragm: 0x64748b, cap: 0x92400e, column: 0x92400e, link: 0xea580c };
const SOLID: Record<SolidKind, number> = { girder: 0xc9ced6, deck: 0xdfe3e8, barrier: 0xaab2bd, diaphragm: 0xb6bcc6, cap: 0xb9a78f, column: 0xb9a78f, bearing: 0x374151, member: 0xc9ced6 };
const kindOf = (sec: number) => (sec <= 3 ? "girder" : sec === 20 ? "diaphragm" : sec === 30 ? "cap" : sec === 31 ? "column" : "strip");

type State = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  render: () => void;
  framed: string;
  box: THREE.Box3;
  pickable: THREE.Object3D[];
  labels: { el: HTMLSpanElement; p: THREE.Vector3 }[];
};

export type BridgeViewProps = {
  model: Model;
  solids?: Solid[];
  mode?: "solid" | "wire";
  hidden?: SolidKind[];
  displacements?: Map<number, Dof6<number>> | null;
  overlay?: Overlay | null;
  contour?: Contour | null;
  selected?: Set<number>;
  onPick?: (elementId: number | null) => void;
  labels?: Label[];
  arrows?: Arrow[];
  strips?: Strip[];
  grid?: boolean;
  dark?: boolean;
  /** An imported model: its section numbers say nothing of what a member is, so all are drawn alike. */
  plain?: boolean;
  className?: string;
};

export const BridgeView = forwardRef<BridgeViewHandle, BridgeViewProps>(function BridgeView({ model, solids, mode = "solid", hidden, displacements, overlay, contour, selected, onPick, labels, arrows, strips, grid = true, dark = false, plain, className }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const state = useRef<State | null>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  const look = (name: ViewName) => {
    const s = state.current;
    if (!s || s.box.isEmpty()) return;
    const c = s.box.getCenter(new THREE.Vector3());
    const size = s.box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1);
    const dir = new THREE.Vector3(...(name === "iso" ? [-0.5, -0.8, 0.42] : name === "top" ? [0, -0.001, 1] : name === "front" ? [0, -1, 0.02] : [-1, 0, 0.02])).normalize();
    // Far enough to see the whole extent across the view, whatever its shape.
    const across = name === "side" ? Math.max(size.y, 1) : name === "iso" ? span : Math.max(size.x, 1);
    const tan = Math.tan((s.camera.fov * Math.PI) / 360);
    const distance = Math.max((0.6 * across) / (tan * Math.max(s.camera.aspect, 0.2)), (0.45 * (name === "top" ? size.y : Math.max(size.z, 0.25 * across))) / tan);
    s.controls.target.copy(c);
    // From a corner the near end looms larger: stand back a little more.
    s.camera.position.copy(c).addScaledVector(dir, name === "iso" ? 1.05 * distance : distance);
    s.camera.near = span / 1000;
    s.camera.far = span * 100;
    s.camera.updateProjectionMatrix();
    s.controls.update();
    s.render();
  };
  useImperativeHandle(ref, () => ({ view: look }));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-1, -2, 3);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(2, 1.5, 0.5);
    scene.add(fill);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    const group = new THREE.Group();
    scene.add(group);
    const s: State = { renderer, scene, camera, controls, group, render: () => undefined, framed: "", box: new THREE.Box3(), pickable: [], labels: [] };
    const v = new THREE.Vector3();
    s.render = () => {
      renderer.render(scene, camera);
      // The labels follow their points.
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      for (const l of s.labels) {
        v.copy(l.p).project(camera);
        const shown = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        l.el.style.display = shown ? "" : "none";
        if (shown) l.el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      }
    };
    controls.addEventListener("change", s.render);
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      s.render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    state.current = s;
    // A click (not a drag) picks the member under the pointer.
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      const size = s.box.getSize(new THREE.Vector3());
      ray.params.Line = { threshold: Math.max(size.x, size.y, size.z, 1) / 150 };
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      let found: number | null = null;
      for (const hit of ray.intersectObjects(s.pickable, false)) {
        const ids = hit.object.userData.ids as number[] | undefined;
        const id = ids ? (hit.index !== undefined ? ids[Math.floor(hit.index / 2)] : undefined) : (hit.object.userData.element as number | undefined);
        if (id !== undefined) {
          found = id;
          break;
        }
      }
      pick.current?.(found);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    resize();
    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      state.current = null;
    };
  }, []);

  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    s.group.clear();
    s.pickable = [];
    const at = new Map(model.nodes.map((n) => [n.id, n]));
    const box = new THREE.Box3();
    for (const n of model.nodes) box.expandByPoint(new THREE.Vector3(n.x, n.y, n.z));
    s.box = box;
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1);
    const busy = !!displacements || !!overlay;
    const edgeColor = dark ? 0x94a3b8 : 0x475569;

    const lines = (positions: ArrayLike<number>, color: number, opacity = 1) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
      s.group.add(mesh);
      return mesh;
    };
    const segments = (pairs: [number, number][], moved?: (id: number) => [number, number, number]) => {
      const pts: number[] = [];
      for (const [a, b] of pairs)
        for (const id of [a, b]) {
          const n = at.get(id)!;
          const m = moved?.(id) ?? [0, 0, 0];
          pts.push(n.x + m[0], n.y + m[1], n.z + m[2]);
        }
      return pts;
    };

    const drawSolids = mode === "solid" && !!solids?.length;
    if (drawSolids) {
      const fade = busy ? 0.28 : 1;
      const paint = (geometry: THREE.BufferGeometry, kind: SolidKind, element: number | undefined, along: ((p: THREE.Vector3) => number) | null) => {
        const picked = element !== undefined && selected?.has(element);
        const values = element !== undefined && contour ? contour.values.get(element) : undefined;
        let material: THREE.Material;
        if (values && along) {
          const pos = geometry.getAttribute("position");
          const colors = new Float32Array(pos.count * 3);
          const p = new THREE.Vector3();
          const range = contour!.max - contour!.min || 1;
          for (let i = 0; i < pos.count; i++) {
            const t = Math.min(Math.max(along(p.fromBufferAttribute(pos, i)), 0), 1);
            const c = contourColor((values[0] + t * (values[1] - values[0]) - contour!.min) / range);
            colors.set([c.r, c.g, c.b], 3 * i);
          }
          geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
          material = new THREE.MeshLambertMaterial({ vertexColors: true });
        } else {
          const glass = kind === "deck" || kind === "barrier";
          const opacity = (glass ? 0.38 : 1) * (contour ? (glass ? 0.5 : 0.45) : fade);
          material = new THREE.MeshLambertMaterial({ color: picked ? 0xdb2777 : dark && !glass ? new THREE.Color(SOLID[kind]).multiplyScalar(0.92) : SOLID[kind], transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
        }
        if (picked && values) (material as THREE.MeshLambertMaterial).emissive = new THREE.Color(0x7a1040);
        return new THREE.Mesh(geometry, material);
      };
      const place = (mesh: THREE.Mesh, edges: boolean, element?: number) => {
        s.group.add(mesh);
        if (element !== undefined) {
          mesh.userData.element = element;
          s.pickable.push(mesh);
        }
        if (edges && !busy) {
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.55 }));
          e.applyMatrix4(mesh.matrix);
          s.group.add(e);
        }
      };
      for (const solid of solids!) {
        if (hidden?.includes(solid.kind)) continue;
        if (solid.type === "slab") {
          const shape = new THREE.Shape(solid.plan.map(([x, y]) => new THREE.Vector2(x, y)));
          const geometry = new THREE.ExtrudeGeometry(shape, { depth: solid.z1 - solid.z0, bevelEnabled: false });
          const mesh = paint(geometry, solid.kind, undefined, null);
          mesh.position.z = solid.z0;
          mesh.updateMatrix();
          place(mesh, true);
          continue;
        }
        for (const seg of solid.segments) {
          const a = new THREE.Vector3(...seg.a);
          const b = new THREE.Vector3(...seg.b);
          const L = a.distanceTo(b);
          if (L < 1e-6) continue;
          const ex = b.clone().sub(a).divideScalar(L);
          let ey = new THREE.Vector3(0, 1, 0);
          if (Math.hypot(ex.x, ex.y) > 1e-6) ey = new THREE.Vector3(0, 0, 1).cross(ex).normalize();
          let ez = ex.clone().cross(ey);
          if (solid.angle) {
            const q = new THREE.Quaternion().setFromAxisAngle(ex, (solid.angle * Math.PI) / 180);
            ey = ey.applyQuaternion(q);
            ez = ez.applyQuaternion(q);
          }
          let mesh: THREE.Mesh;
          if ("radius" in solid.section) {
            const geometry = new THREE.CylinderGeometry(solid.section.radius, solid.section.radius, L, 24);
            mesh = paint(geometry, solid.kind, seg.element, (p) => p.y / L + 0.5);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ex);
            mesh.position.copy(a).addScaledVector(ex, L / 2);
          } else {
            const shape = new THREE.Shape(solid.section.outline.map(([y, z]) => new THREE.Vector2(y, z)));
            const geometry = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false, steps: 1 });
            mesh = paint(geometry, solid.kind, seg.element, (p) => p.z / L);
            mesh.matrixAutoUpdate = false;
            mesh.matrix.makeBasis(ey, ez, ex).setPosition(a);
          }
          if (mesh.matrixAutoUpdate) mesh.updateMatrix();
          mesh.matrixAutoUpdate = false;
          place(mesh, true, seg.element);
        }
      }
    } else {
      const byKind = new Map<string, { pairs: [number, number][]; ids: number[] }>();
      const picked: [number, number][] = [];
      for (const e of model.elements) {
        if (!at.has(e.n1) || !at.has(e.n2)) continue;
        const k = plain ? "girder" : kindOf(e.sec);
        const cur = byKind.get(k) ?? byKind.set(k, { pairs: [], ids: [] }).get(k)!;
        cur.pairs.push([e.n1, e.n2]);
        cur.ids.push(e.id);
        if (selected?.has(e.id)) picked.push([e.n1, e.n2]);
      }
      for (const [k, { pairs, ids }] of byKind) {
        const color = k === "girder" && dark ? 0xe2e8f0 : WIRE[k as keyof typeof WIRE];
        const mesh = lines(segments(pairs), color, k === "strip" ? (busy ? 0.35 : 0.8) : busy ? 0.6 : 1);
        if (k !== "strip" && k !== "diaphragm") {
          mesh.userData.ids = ids;
          s.pickable.push(mesh);
        }
      }
      lines(segments(model.links.filter((l) => at.has(l.n1) && at.has(l.n2)).map((l) => [l.n1, l.n2])), WIRE.link, busy ? 0.6 : 1);
      if (picked.length) lines(segments(picked), 0xdb2777);
    }

    // Supports: a pyramid under each, its point at the node.
    const h = Math.min(3, Math.max(0.8, span * 0.012));
    const cone = new THREE.ConeGeometry(h * 0.7, h, 4);
    cone.rotateX(Math.PI / 2);
    const green = new THREE.MeshLambertMaterial({ color: 0x16a34a });
    for (const sup of model.supports) {
      const n = at.get(sup.node);
      if (!n) continue;
      const m = new THREE.Mesh(cone, green);
      m.position.set(n.x, n.y, n.z - h / 2);
      s.group.add(m);
    }
    // The ground grid under the model, and the axes at its corner.
    const floor = box.min.z - h;
    if (grid) {
      const cell = span > 400 ? 50 : span > 150 ? 20 : 10;
      const extent = Math.ceil((span * 1.25) / cell) * cell;
      const helper = new THREE.GridHelper(extent, extent / cell, dark ? 0x3f4c5f : 0xcfd6de, dark ? 0x2a3546 : 0xe6eaef);
      helper.rotateX(Math.PI / 2);
      const c = box.getCenter(new THREE.Vector3());
      helper.position.set(Math.round(c.x / cell) * cell, Math.round(c.y / cell) * cell, floor);
      s.group.add(helper);
    }
    const axis = Math.max(4, span * 0.05);
    const origin = new THREE.Vector3(box.min.x - axis * 0.6, box.min.y - axis * 1.2, floor);
    const axes = new THREE.AxesHelper(axis);
    axes.position.copy(origin);
    s.group.add(axes);

    if (displacements) {
      let max = 0;
      for (const u of displacements.values()) max = Math.max(max, Math.hypot(u[0], u[1], u[2]));
      const factor = max > 0 ? (0.04 * span) / max : 0;
      const moved = (id: number): [number, number, number] => {
        const u = displacements.get(id);
        return u ? [u[0] * factor, u[1] * factor, u[2] * factor] : [0, 0, 0];
      };
      lines(segments(model.elements.filter((e) => (plain || kindOf(e.sec) !== "strip") && at.has(e.n1) && at.has(e.n2)).map((e) => [e.n1, e.n2]), moved), dark ? 0x60a5fa : 0x1b76bb);
    }
    if (overlay) {
      if (overlay.hatch.length) lines(overlay.hatch, overlay.color, 0.35);
      if (overlay.outline.length) lines(overlay.outline, overlay.color);
    }
    for (const strip of strips ?? []) {
      const shape = new THREE.Shape(strip.plan.map(([x, y]) => new THREE.Vector2(x, y)));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: strip.color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      mesh.position.z = strip.z;
      s.group.add(mesh);
    }
    for (const arrow of arrows ?? []) {
      const d = new THREE.Vector3(...arrow.d);
      const L = d.length();
      if (L < 1e-6) continue;
      const tip = new THREE.Vector3(...arrow.p);
      s.group.add(new THREE.ArrowHelper(d.clone().normalize(), tip.clone().sub(d), L, arrow.color ?? 0x16a34a, Math.min(L * 0.3, h * 1.2), Math.min(L * 0.18, h * 0.7)));
    }

    // Labels: values, names, and the axes' letters.
    const host = layer.current;
    if (host) {
      host.replaceChildren();
      const all: Label[] = [...(labels ?? []), { p: [origin.x + axis * 1.12, origin.y, origin.z], text: "X", tone: "axis" }, { p: [origin.x, origin.y + axis * 1.12, origin.z], text: "Y", tone: "axis" }, { p: [origin.x, origin.y, origin.z + axis * 1.12], text: "Z", tone: "axis" }];
      s.labels = all.map((l) => {
        const el = document.createElement("span");
        el.textContent = l.text;
        el.className =
          l.tone === "axis"
            ? "absolute left-0 top-0 text-[10px] font-semibold text-muted-foreground"
            : l.tone === "name"
              ? "absolute left-0 top-0 rounded bg-background/70 px-1 text-[10px] text-muted-foreground"
              : "absolute left-0 top-0 rounded border bg-background/90 px-1 text-[10px] font-medium tabular-nums text-foreground shadow-sm";
        host.appendChild(el);
        return { el, p: new THREE.Vector3(...l.p) };
      });
    }

    // Frame the model when its extents change, not on every edit of a load.
    const key = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map((v) => v.toFixed(1)).join(",");
    if (key !== s.framed) {
      s.framed = key;
      look("iso");
    }
    s.render();
  }, [model, solids, mode, hidden, displacements, overlay, contour, selected, labels, arrows, strips, grid, dark, plain]);

  return (
    <div className={className}>
      <div ref={host} className="absolute inset-0" />
      <div ref={layer} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
});
