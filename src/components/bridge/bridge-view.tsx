"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Dof6, Model } from "@/lib/bridge/model";

// The analysis model in 3D: every element as a line, colored by what it is, the bearings and the
// supports marked, and (when given) the deflected shape drawn over it, exaggerated.

const COLORS = { girder: 0x1f2937, strip: 0xcbd5e1, diaphragm: 0x64748b, cap: 0x92400e, column: 0x92400e, link: 0xea580c, deflected: 0x1b76bb };
const kindOf = (sec: number) => (sec <= 3 ? "girder" : sec === 20 ? "diaphragm" : sec === 30 ? "cap" : sec === 31 ? "column" : "strip");

export function BridgeView({ model, displacements, className }: { model: Model; displacements?: Map<number, Dof6<number>> | null; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group: THREE.Group; render: () => void; framed: string } | null>(null);

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
    state.current = { renderer, scene, camera, controls, group, render, framed: "" };
    resize();
    return () => {
      observer.disconnect();
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
    const at = new Map(model.nodes.map((n) => [n.id, n]));
    const segments = (pairs: [number, number][], color: number, moved?: (id: number) => [number, number, number], opacity = 1) => {
      const pts: number[] = [];
      for (const [a, b] of pairs)
        for (const id of [a, b]) {
          const n = at.get(id);
          if (!n) continue;
          const m = moved?.(id) ?? [0, 0, 0];
          pts.push(n.x + m[0], n.y + m[1], n.z + m[2]);
        }
      if (!pts.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      s.group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })));
    };
    const byKind = new Map<string, [number, number][]>();
    for (const e of model.elements) {
      const k = kindOf(e.sec);
      (byKind.get(k) ?? byKind.set(k, []).get(k)!).push([e.n1, e.n2]);
    }
    const faded = displacements ? 0.45 : 1;
    for (const [k, pairs] of byKind) segments(pairs, COLORS[k as keyof typeof COLORS], undefined, faded);
    segments(model.links.map((l) => [l.n1, l.n2]), COLORS.link, undefined, faded);
    // Supports: a point at each.
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
    // Extents, for the camera and the deflected shape's scale.
    const box = new THREE.Box3();
    for (const n of model.nodes) box.expandByPoint(new THREE.Vector3(n.x, n.y, n.z));
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
      segments(model.elements.filter((e) => kindOf(e.sec) !== "strip").map((e) => [e.n1, e.n2]), COLORS.deflected, moved);
    }
    // Frame the model when its extents change, not on every edit of a load.
    const key = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map((v) => v.toFixed(1)).join(",");
    if (key !== s.framed) {
      s.framed = key;
      const c = box.getCenter(new THREE.Vector3());
      s.controls.target.copy(c);
      s.camera.position.set(c.x - 0.45 * span, c.y - 0.75 * span, c.z + 0.4 * span);
      s.camera.near = span / 1000;
      s.camera.far = span * 100;
      s.camera.updateProjectionMatrix();
      s.controls.update();
    }
    s.render();
  }, [model, displacements]);

  return <div ref={host} className={className} />;
}
