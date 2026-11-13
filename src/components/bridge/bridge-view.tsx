"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Dof6, Model } from "@/lib/bridge/model";

// The analysis model in 3D, the workspace's canvas: every element as a line, colored by what it
// is, the bearings and supports marked; over it the deflected shape (exaggerated) or a diagram of
// a result drawn on the members, as midas Civil draws beam diagrams. A click picks a member.

export type ViewName = "iso" | "top" | "front" | "side";
export type BridgeViewHandle = { view: (name: ViewName) => void };
/** Lines drawn over the model: a diagram's outline and its hatching (flat x, y, z pairs). */
export type Overlay = { outline: Float32Array; hatch: Float32Array; color: number };

const COLORS = { girder: 0x1f2937, strip: 0xcbd5e1, diaphragm: 0x64748b, cap: 0x92400e, column: 0x92400e, link: 0xea580c, deflected: 0x1b76bb, selected: 0xdb2777 };
const kindOf = (sec: number) => (sec <= 3 ? "girder" : sec === 20 ? "diaphragm" : sec === 30 ? "cap" : sec === 31 ? "column" : "strip");

type State = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group: THREE.Group; render: () => void; framed: string; box: THREE.Box3; pickable: THREE.LineSegments[] };

export const BridgeView = forwardRef<BridgeViewHandle, { model: Model; displacements?: Map<number, Dof6<number>> | null; overlay?: Overlay | null; selected?: Set<number>; onPick?: (elementId: number | null) => void; className?: string }>(function BridgeView(
  { model, displacements, overlay, selected, onPick, className },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
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
    const across = name === "side" ? Math.max(size.y, 1) : name === "iso" ? 1.1 * span : Math.max(size.x, 1);
    const tan = Math.tan((s.camera.fov * Math.PI) / 360);
    const distance = Math.max((0.6 * across) / (tan * Math.max(s.camera.aspect, 0.2)), (0.45 * (name === "top" ? size.y : Math.max(size.z, 0.25 * across))) / tan);
    s.controls.target.copy(c);
    s.camera.position.copy(c).addScaledVector(dir, distance);
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
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    const group = new THREE.Group();
    scene.add(group);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const s: State = { renderer, scene, camera, controls, group, render, framed: "", box: new THREE.Box3(), pickable: [] };
    state.current = s;
    // A click (not a drag) picks the member under the pointer.
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      const size = s.box.getSize(new THREE.Vector3());
      ray.params.Line = { threshold: Math.max(size.x, size.y, size.z, 1) / 150 };
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(s.pickable, false)[0];
      const ids = hit ? (hit.object.userData.ids as number[]) : null;
      pick.current?.(ids && hit.index !== undefined ? (ids[Math.floor(hit.index / 2)] ?? null) : null);
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
    for (const child of [...s.group.children]) {
      s.group.remove(child);
      const mesh = child as THREE.LineSegments | THREE.Points;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
    s.pickable = [];
    const at = new Map(model.nodes.map((n) => [n.id, n]));
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
    const byKind = new Map<string, { pairs: [number, number][]; ids: number[] }>();
    const picked: [number, number][] = [];
    for (const e of model.elements) {
      if (!at.has(e.n1) || !at.has(e.n2)) continue;
      const k = kindOf(e.sec);
      const cur = byKind.get(k) ?? byKind.set(k, { pairs: [], ids: [] }).get(k)!;
      cur.pairs.push([e.n1, e.n2]);
      cur.ids.push(e.id);
      if (selected?.has(e.id)) picked.push([e.n1, e.n2]);
    }
    const busy = !!displacements || !!overlay;
    for (const [k, { pairs, ids }] of byKind) {
      const mesh = lines(segments(pairs), COLORS[k as keyof typeof COLORS], k === "strip" ? (busy ? 0.35 : 0.8) : busy ? 0.6 : 1);
      if (k !== "strip" && k !== "diaphragm") {
        mesh.userData.ids = ids;
        s.pickable.push(mesh);
      }
    }
    lines(segments(model.links.filter((l) => at.has(l.n1) && at.has(l.n2)).map((l) => [l.n1, l.n2])), COLORS.link, busy ? 0.6 : 1);
    if (picked.length) lines(segments(picked), COLORS.selected);
    const sp: number[] = [];
    for (const sup of model.supports) {
      const n = at.get(sup.node);
      if (n) sp.push(n.x, n.y, n.z);
    }
    if (sp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
      s.group.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x16a34a, size: 7, sizeAttenuation: false })));
    }
    const box = new THREE.Box3();
    for (const n of model.nodes) box.expandByPoint(new THREE.Vector3(n.x, n.y, n.z));
    s.box = box;
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1);
    if (displacements) {
      let max = 0;
      for (const u of displacements.values()) max = Math.max(max, Math.hypot(u[0], u[1], u[2]));
      const factor = max > 0 ? (0.04 * span) / max : 0;
      const moved = (id: number): [number, number, number] => {
        const u = displacements.get(id);
        return u ? [u[0] * factor, u[1] * factor, u[2] * factor] : [0, 0, 0];
      };
      lines(segments(model.elements.filter((e) => kindOf(e.sec) !== "strip" && at.has(e.n1) && at.has(e.n2)).map((e) => [e.n1, e.n2]), moved), COLORS.deflected);
    }
    if (overlay) {
      if (overlay.hatch.length) lines(overlay.hatch, overlay.color, 0.35);
      if (overlay.outline.length) lines(overlay.outline, overlay.color);
    }
    // Frame the model when its extents change, not on every edit of a load.
    const key = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map((v) => v.toFixed(1)).join(",");
    if (key !== s.framed) {
      s.framed = key;
      look("iso");
    }
    s.render();
  }, [model, displacements, overlay, selected]);

  return <div ref={host} className={className} />;
});
