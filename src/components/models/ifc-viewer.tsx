"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Maximize, Trash2 } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { toast } from "sonner";
import { deleteIfcModel } from "@/app/actions/models3d";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { cn } from "@/lib/utils";

// Shows an IFC file in the browser with web-ifc (geometry) and three.js (rendering): no
// upload or translation step, so a model can be viewed the moment an AI app changes it.

const WASM_URL = new URL("web-ifc/web-ifc.wasm", import.meta.url).toString();

export type ViewerElement = { globalId: string; id: string; type: string; name: string | null; mark: string | null; sheet: string | null; notes: string | null; material: string | null };
type Summary = {
  elements: number;
  totalVolumeM3: number;
  units: string;
  byType: { type: string; count: number; volumeM3: number }[];
  byMaterial: { material: string; count: number; volumeM3: number }[];
  extents: { size: number[] } | null;
  warnings: string[];
};

const label = (type: string) => type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function IfcViewer({
  projectId,
  model,
  elements,
  summary,
}: {
  projectId: string;
  model: { id: string; name: string; description: string | null; revision: number; updated: string };
  elements: ViewerElement[];
  summary: Summary;
}) {
  const router = useRouter();
  const stage = useRef<HTMLDivElement>(null);
  const api = useRef<{ fit: () => void; setHidden: (types: Set<string>) => void } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<ViewerElement | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const byGuid = useMemo(() => new Map(elements.map((e) => [e.globalId, e])), [elements]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eef2f6");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const root = new THREE.Group();
    scene.add(root);
    const meshes = new Map<number, THREE.Mesh[]>(); // by IFC express id
    const infoOf = new Map<number, ViewerElement>(); // express id -> element details
    let highlighted: THREE.Mesh[] = [];

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const fit = () => {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3()).length();
      const center = box.getCenter(new THREE.Vector3());
      // Far enough that the bounding sphere fits the narrower of the two view angles.
      const vFov = (camera.fov * Math.PI) / 180;
      const fov = Math.min(vFov, 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect));
      const distance = (size / 2 / Math.sin(fov / 2)) * 1.05;
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(0.6, 0.45, 0.8).normalize().multiplyScalar(distance));
      camera.near = size / 1000;
      camera.far = size * 20;
      camera.updateProjectionMatrix();
      controls.update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    // Click (not drag) to select an element.
    let down: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    let pick: (e: PointerEvent) => void = () => {};
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) pick(e);
      down = null;
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    (async () => {
      try {
        const WebIFC = await import("web-ifc");
        const ifc = new WebIFC.IfcAPI();
        await ifc.Init((path) => (path.endsWith(".wasm") ? WASM_URL : path), true);
        const res = await fetch(`/api/ifc-models/${model.id}/ifc`, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load the model");
        const id = ifc.OpenModel(new Uint8Array(await res.arrayBuffer()), { COORDINATE_TO_ORIGIN: true });
        ifc.StreamAllMeshes(id, (flat) => {
          const placed = flat.geometries;
          for (let i = 0; i < placed.size(); i++) {
            const pg = placed.get(i);
            const geom = ifc.GetGeometry(id, pg.geometryExpressID);
            const data = ifc.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
            const index = ifc.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
            const g = new THREE.BufferGeometry();
            const buffer = new THREE.InterleavedBuffer(data, 6); // x y z, nx ny nz
            g.setAttribute("position", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
            g.setAttribute("normal", new THREE.InterleavedBufferAttribute(buffer, 3, 3));
            g.setIndex(new THREE.BufferAttribute(index, 1));
            const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(pg.color.x, pg.color.y, pg.color.z), transparent: pg.color.w < 1, opacity: pg.color.w });
            const mesh = new THREE.Mesh(g, mat);
            mesh.applyMatrix4(new THREE.Matrix4().fromArray(pg.flatTransformation));
            mesh.userData.expressID = flat.expressID;
            root.add(mesh);
            meshes.set(flat.expressID, [...(meshes.get(flat.expressID) ?? []), mesh]);
            geom.delete();
          }
        });
        // Map geometry back to elements now: the IFC is closed once loaded.
        for (const expressID of meshes.keys()) {
          const guid = ifc.GetLine(id, expressID)?.GlobalId?.value as string | undefined;
          const info = guid ? byGuid.get(guid) : undefined;
          if (info) infoOf.set(expressID, info);
        }
        pick = (e) => {
          const r = renderer.domElement.getBoundingClientRect();
          raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
          const hit = raycaster.intersectObjects(root.children.filter((m) => m.visible), false)[0];
          for (const m of highlighted) (m.material as THREE.MeshLambertMaterial).emissive.setHex(0x000000);
          highlighted = [];
          if (!hit) return setSelected(null);
          const expressID = hit.object.userData.expressID as number;
          highlighted = meshes.get(expressID) ?? [];
          for (const m of highlighted) (m.material as THREE.MeshLambertMaterial).emissive.setHex(0x1d4ed8);
          setSelected(infoOf.get(expressID) ?? null);
        };
        api.current = {
          fit,
          setHidden: (types) => {
            for (const [expressID, list] of meshes) for (const m of list) m.visible = !types.has(infoOf.get(expressID)?.type ?? "");
          },
        };
        ifc.CloseModel(id);
        if (disposed) return;
        fit();
        setState("ready");
      } catch (err) {
        console.error(err);
        if (!disposed) setState("error");
      }
    })();

    return () => {
      disposed = true;
      observer.disconnect();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [model.id, model.revision, byGuid]);

  useEffect(() => api.current?.setHidden(hidden), [hidden]);

  const size = summary.extents?.size.map((n) => n.toLocaleString("en-US", { maximumFractionDigits: 1 })).join(" × ");

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100svh-3.5rem)] lg:flex-none lg:flex-row lg:overflow-hidden">
      <div className="relative min-h-[60svh] flex-1 lg:min-h-0">
        <div ref={stage} className="absolute inset-0" />
        {state === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading model…
          </div>
        )}
        {state === "error" && <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive">Could not show this model.</div>}
        <div className="absolute top-3 right-3 flex gap-1">
          <Button variant="outline" size="icon-sm" className="bg-card" onClick={() => api.current?.fit()} aria-label="Fit model">
            <Maximize />
          </Button>
        </div>
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-card/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
          Drag to orbit · right-drag to pan · scroll to zoom · click an element for details
        </p>
      </div>

      <aside className="shrink-0 space-y-5 border-t bg-card p-4 text-sm lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <div className="space-y-1">
          <h1 className="text-base font-semibold">{model.name}</h1>
          <p className="text-xs text-muted-foreground">
            Revision {model.revision} · updated {model.updated} · built from drawings by an AI app
          </p>
          {model.description && <p className="text-xs whitespace-pre-line text-muted-foreground">{model.description}</p>}
          <div className="flex gap-2 pt-1">
            <LinkButton href={`/api/ifc-models/${model.id}/ifc?download=1`} size="sm" prefetch={false}>
              <Download /> Download IFC
            </LinkButton>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={async () => {
                if (!window.confirm(`Delete "${model.name}" and its revisions?`)) return;
                try {
                  await deleteIfcModel(model.id);
                  router.push(`/projects/${projectId}/models`);
                } catch {
                  toast.error("Could not delete the model");
                }
              }}
            >
              <Trash2 /> Delete
            </Button>
          </div>
        </div>

        {selected && (
          <section className="space-y-1 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <p className="font-medium">{selected.name || selected.mark || selected.id}</p>
            <p className="text-xs text-muted-foreground">
              {label(selected.type)} · id {selected.id}
              {selected.mark && ` · mark ${selected.mark}`}
              {selected.material && ` · ${selected.material}`}
              {selected.sheet && ` · from ${selected.sheet}`}
            </p>
            {selected.notes && <p className="text-xs">Assumed: {selected.notes}</p>}
          </section>
        )}

        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Elements ({summary.elements})</h2>
          <ul className="space-y-0.5">
            {summary.byType.map((t) => (
              <li key={t.type}>
                <label className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={!hidden.has(t.type)}
                    onChange={(e) =>
                      setHidden((h) => {
                        const next = new Set(h);
                        if (e.target.checked) next.delete(t.type);
                        else next.add(t.type);
                        return next;
                      })
                    }
                  />
                  <span className="flex-1">{label(t.type)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t.count} · {t.volumeM3.toLocaleString("en-US", { maximumFractionDigits: 1 })} m³
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Materials</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
            {summary.byMaterial.map((m) => (
              <div key={m.material} className="contents">
                <dt>{m.material}</dt>
                <dd className="text-right tabular-nums">{m.volumeM3.toLocaleString("en-US", { maximumFractionDigits: 2 })} m³</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Total {summary.totalVolumeM3.toLocaleString("en-US", { maximumFractionDigits: 1 })} m³
            {size && ` · overall ${size} ${summary.units}`}
          </p>
        </section>

        {summary.warnings.length > 0 && (
          <section className="space-y-1.5">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Checks <Badge variant="warning">{summary.warnings.length}</Badge>
            </h2>
            <ul className={cn("space-y-1 text-xs text-muted-foreground")}>
              {summary.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-xs text-muted-foreground">
          Built by an AI app from the drawings: check key dimensions before relying on it. Ask the app to change it, or to undo a change from Connections.
        </p>
      </aside>
    </div>
  );
}
