"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { IFCSPACE } from "web-ifc";
import { ELEMENT_DATA_CONFIG, NO_UNITS, SPATIAL_CATEGORIES, categoryName, readElement, readUnits, type ElementDetails, type ModelUnits } from "@/lib/ifc/element-properties";

// Draws a model with That Open Engine: web-ifc reads the IFC once, the fragments worker draws
// it off the main thread, and the converted model is saved so later views skip the IFC. The
// scene renders only when something changes (camera, highlight, a tile arriving).

export type TreeNode = { key: string; localId: number | null; category: string; name: string; children: TreeNode[] };
export type Orientation = "front" | "back" | "left" | "right" | "top" | "bottom";

export type ModelCanvasHandle = {
  fit: () => void;
  orient: (direction: Orientation) => void;
  rotate: (degrees: number) => void;
  /** Hides exactly these elements (everything else shown). */
  setHidden: (localIds: number[]) => void;
  /** Selects an element as if clicked, optionally flying to it. */
  select: (localId: number | null, zoom?: boolean) => void;
  clearMeasure: () => void;
};

type Props = {
  modelId: string;
  revision: number;
  /** The model's IFC. */
  ifcUrl: string;
  /** Its saved conversion for the viewer, when there is one (skips reading the IFC). */
  viewUrl: string | null;
  /** Where to save the conversion after reading the IFC (see /api/ifc-models/[id]/view), or null to not save it. */
  saveUrl: string | null;
  tool: "select" | "measure";
  onLoaded: (tree: TreeNode[]) => void;
  onProgress: (percent: number) => void;
  onError: (message: string) => void;
  onSelect: (localId: number | null, details: ElementDetails | null) => void;
  /** A measured distance in metres, or null when cleared. */
  onMeasure: (meters: number | null) => void;
};

type World = OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>;
type Item = Record<string, unknown>;

const SELECT = { color: new THREE.Color("#2563eb"), opacity: 1, transparent: false, renderedFaces: FRAGS.RenderedFaces.TWO };
const DRAG = 5; // pixels a pointer can move and still count as a click
const ISO = new THREE.Vector3(0.6, 0.45, 0.8).normalize();

const ModelCanvas = forwardRef<ModelCanvasHandle, Props>(function ModelCanvas(props, ref) {
  const stage = useRef<HTMLDivElement>(null);
  // Latest props for the engine's event handlers, which are set up once.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const handle = useRef<ModelCanvasHandle | null>(null);
  useImperativeHandle(ref, () => ({
    fit: () => handle.current?.fit(),
    orient: (d) => handle.current?.orient(d),
    rotate: (deg) => handle.current?.rotate(deg),
    setHidden: (ids) => handle.current?.setHidden(ids),
    select: (id, zoom) => handle.current?.select(id, zoom),
    clearMeasure: () => handle.current?.clearMeasure(),
  }));

  const { modelId, revision, ifcUrl, viewUrl, saveUrl } = props;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let disposed = false;
    const components = new OBC.Components();
    const world = components.get(OBC.Worlds).create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>() as World;
    world.scene = new OBC.SimpleScene(components);
    world.scene.setup();
    world.scene.three.background = null;
    world.renderer = new OBC.SimpleRenderer(components, el);
    world.renderer.mode = OBC.RendererMode.MANUAL;
    world.camera = new OBC.SimpleCamera(components);
    components.init();
    const redraw = () => (world.renderer!.needsUpdate = true);

    const fragments = components.get(OBC.FragmentsManager);
    fragments.init(`${window.location.origin}/fragments/worker.mjs`);
    const controls = world.camera.controls;
    // Clipping planes follow the camera. Depth precision depends on how close the near plane
    // is, so a fixed tiny one makes thin layers (a roof membrane over insulation) flicker
    // from a distance. Outside the model's bounding sphere nothing is nearer than its surface,
    // so the near plane sits just short of it; inside, at 1% of the distance looked at.
    const bounds = new THREE.Sphere(new THREE.Vector3(), 10);
    const clip = () => {
      const camera = world.camera.three as THREE.PerspectiveCamera;
      const toCenter = camera.position.distanceTo(bounds.center);
      const near = Math.max((toCenter - bounds.radius) * 0.9, controls.distance / 100, 0.01);
      const far = toCenter + bounds.radius * 2 + 1;
      if (camera.near === near && camera.far === far) return;
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    };
    controls.addEventListener("update", () => {
      clip();
      redraw();
    });
    controls.addEventListener("rest", () => fragments.core.update(true).then(redraw));
    fragments.list.onItemSet.add(({ value }) => {
      value.useCamera(world.camera.three);
      world.scene.three.add(value.object);
      value.onViewUpdated.add(redraw);
      fragments.core.update(true).then(redraw);
    });
    const observer = new ResizeObserver(() => {
      world.renderer?.resize();
      world.camera.updateAspect();
      redraw();
    });
    observer.observe(el);

    let model: FRAGS.FragmentsModel | null = null;
    let spaces = new Set<number>();
    let selected: number | null = null;
    let units: ModelUnits | null = null;
    const overlay = new THREE.Group(); // measurement markers and lines
    overlay.renderOrder = 999;
    world.scene.three.add(overlay);
    let measureFrom: THREE.Vector3 | null = null;

    const box = () => model?.box.clone() ?? new THREE.Box3();
    const lookFrom = (direction: THREE.Vector3, target = box()) => {
      if (target.isEmpty()) return;
      const sphere = target.getBoundingSphere(new THREE.Sphere());
      const camera = world.camera.three as THREE.PerspectiveCamera;
      // Far enough that the bounding sphere fits the narrower of the two view angles.
      const vFov = (camera.fov * Math.PI) / 180;
      const fov = Math.min(vFov, 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect));
      const distance = (sphere.radius / Math.sin(fov / 2)) * 1.05;
      const eye = sphere.center.clone().add(direction.clone().normalize().multiplyScalar(distance));
      controls.setLookAt(eye.x, eye.y, eye.z, sphere.center.x, sphere.center.y, sphere.center.z, true);
    };
    const currentDirection = () => world.camera.three.position.clone().sub(controls.getTarget(new THREE.Vector3()));

    const modelUnits = async (m: FRAGS.FragmentsModel) => {
      if (units) return units;
      units = NO_UNITS;
      try {
        const ids = Object.values(await m.getItemsOfCategories([/^IFCUNITASSIGNMENT$/])).flat();
        if (ids.length) {
          const [assignment] = await m.getItemsData(ids, { attributesDefault: true, relations: { Units: { attributes: true, relations: false } } });
          units = readUnits(assignment as Item);
        }
      } catch {
        // Values are shown without units rather than not at all.
      }
      return units;
    };

    const highlight = async () => {
      if (!model) return;
      await model.resetHighlight();
      if (selected !== null) await model.highlight([selected], SELECT);
      await fragments.core.update(true);
      redraw();
    };

    const select = async (localId: number | null, zoom = false) => {
      if (!model) return;
      selected = localId;
      await highlight();
      if (localId === null) return latest.current.onSelect(null, null);
      if (zoom) {
        const target = await model.getMergedBox([localId]);
        if (!target.isEmpty()) lookFrom(currentDirection(), target);
      }
      let details: ElementDetails | null = null;
      try {
        const [data] = await model.getItemsData([localId], ELEMENT_DATA_CONFIG);
        if (data) details = readElement(data as Item, await modelUnits(model));
      } catch {
        // The element stays highlighted; the panel says there's nothing to show.
      }
      if (selected === localId) latest.current.onSelect(localId, details);
    };

    const clearMeasure = () => {
      for (const o of [...overlay.children]) {
        overlay.remove(o);
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      }
      measureFrom = null;
      latest.current.onMeasure(null);
      redraw();
    };

    const marker = (at: THREE.Vector3) => {
      const size = Math.max(box().getSize(new THREE.Vector3()).length() * 0.003, 0.02);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 12), new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false }));
      mesh.position.copy(at);
      mesh.renderOrder = 999;
      overlay.add(mesh);
    };

    const measure = (point: THREE.Vector3) => {
      if (!measureFrom || overlay.children.length > 2) {
        clearMeasure();
        measureFrom = point.clone();
        marker(point);
      } else {
        marker(point);
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([measureFrom, point]),
          new THREE.LineBasicMaterial({ color: 0xef4444, depthTest: false }),
        );
        line.renderOrder = 999;
        overlay.add(line);
        latest.current.onMeasure(measureFrom.distanceTo(point));
        measureFrom = null;
      }
      redraw();
    };

    // Click (not drag) to select or measure. Rooms enclose what's inside them, so any other
    // element along the ray wins.
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = async (e: PointerEvent) => {
      const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG;
      down = null;
      if (!click || !model || e.button !== 0) return;
      const hits = (await model.raycastAll({ camera: world.camera.three, mouse: new THREE.Vector2(e.clientX, e.clientY), dom: world.renderer!.three.domElement })) ?? [];
      hits.sort((a, b) => a.distance - b.distance);
      const hit = hits.find((h) => !spaces.has(h.localId)) ?? hits[0];
      if (latest.current.tool === "measure") {
        if (hit) measure(hit.point);
        return;
      }
      select(hit ? hit.localId : null);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);

    handle.current = {
      fit: () => lookFrom(currentDirection()),
      orient: (direction) => {
        const d = {
          front: new THREE.Vector3(0, 0, 1),
          back: new THREE.Vector3(0, 0, -1),
          right: new THREE.Vector3(1, 0, 0),
          left: new THREE.Vector3(-1, 0, 0),
          top: new THREE.Vector3(0, 1, 0.001), // a hair off vertical keeps "up" defined
          bottom: new THREE.Vector3(0, -1, 0.001),
        }[direction];
        lookFrom(d);
      },
      rotate: (degrees) => {
        controls.rotate((degrees * Math.PI) / 180, 0, true);
      },
      setHidden: async (ids) => {
        if (!model) return;
        await model.resetVisible();
        if (ids.length) await model.setVisible(ids, false);
        await fragments.core.update(true);
        redraw();
      },
      select: (id, zoom) => void select(id, zoom),
      clearMeasure,
    };

    const report = (p: number) => !disposed && latest.current.onProgress(Math.round(p));
    const fetchOk = async (url: string) => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const name = `${modelId}:${revision}`;

    (async () => {
      try {
        if (viewUrl) {
          try {
            report(20);
            const buffer = await fetchOk(viewUrl);
            report(60);
            model = await fragments.core.load(buffer, { modelId: name, camera: world.camera.three });
          } catch {
            model = null; // read the IFC instead
          }
        }
        if (disposed) return;
        if (!model) {
          report(5);
          const loader = components.get(OBC.IfcLoader);
          await loader.setup({ autoSetWasm: false, wasm: { path: `${window.location.origin}/wasm/`, absolute: true } });
          const ifc = await fetchOk(ifcUrl);
          if (disposed) return;
          report(25);
          model = await loader.load(ifc, true, name, {
            processData: { progressCallback: (p) => report(25 + (p > 1 ? p / 100 : p) * 65) },
            instanceCallback: (importer) => importer.classes.elements.add(IFCSPACE), // rooms, drawn see-through
          });
          // Save the conversion so the next view of this revision skips the IFC.
          if (saveUrl) void saveViewCopy(saveUrl, model);
        }
        if (disposed) return;
        report(92);

        spaces = new Set(Object.values(await model.getItemsOfCategories([/^IFCSPACE$/])).flat());
        if (spaces.size) await model.setOpacity([...spaces], 0.15);

        if (!box().isEmpty()) box().getBoundingSphere(bounds);
        controls.maxDistance = Math.max(bounds.radius * 20, 50); // zooming out never loses the model
        lookFrom(ISO);
        controls.update(0);

        latest.current.onLoaded(await spatialTree(model));
        report(100);
      } catch (err) {
        if (disposed) return; // unmounted mid-load
        console.error(err);
        latest.current.onError(err instanceof Error ? err.message : "Could not show this model");
      }
    })();

    return () => {
      disposed = true;
      handle.current = null;
      observer.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      clearMeasure();
      components.dispose();
    };
  }, [modelId, revision, ifcUrl, viewUrl, saveUrl]);

  return <div ref={stage} className="absolute inset-0" />;
});

export default ModelCanvas;

/** The model's spatial structure (site, building, levels, then elements by kind), with names. */
async function spatialTree(model: FRAGS.FragmentsModel): Promise<TreeNode[]> {
  const root = await model.getSpatialStructure();
  const ids: number[] = [];
  const collect = (item: FRAGS.SpatialTreeItem) => {
    if (item.localId !== null) ids.push(item.localId);
    item.children?.forEach(collect);
  };
  collect(root);
  const names = new Map<number, string>();
  try {
    const data = await model.getItemsData(ids, { attributesDefault: false, attributes: ["Name", "LongName"] });
    data.forEach((d, i) => {
      const value = (key: string) => {
        const a = (d as Item)[key] as { value?: unknown } | undefined;
        return a?.value ? String(a.value) : null;
      };
      // Rooms: Name is the number, LongName the room name ("101 · Sales").
      const name = [...new Set([value("Name"), value("LongName")].filter(Boolean))].join(" · ") || null;
      if (name) names.set(ids[i], name);
    });
  } catch {
    // Kinds and ids still identify everything.
  }
  // The structure alternates kinds and items (IFCSITE → site #15 → IFCBUILDING → …). Spatial
  // items (site, building, levels) are listed directly; elements are grouped by kind.
  const byName = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const group = (node: FRAGS.SpatialTreeItem, parent: string, inherited = "ITEM"): TreeNode[] => {
    if (node.localId !== null) return [item(node, inherited)];
    const category = (node.category ?? inherited).toUpperCase();
    const items = (node.children ?? []).flatMap((child) => group(child, parent, category));
    if (SPATIAL_CATEGORIES.has(category)) return items;
    // Within a kind, by name ("Rung 2" before "Rung 10"), so like parts sit together.
    items.sort((x, y) => byName.compare(x.name, y.name));
    return [{ key: `${parent}/${category}`, localId: null, category, name: `${categoryName(category)} (${items.length})`, children: items }];
  };
  const item = (node: FRAGS.SpatialTreeItem, inherited: string): TreeNode => {
    const localId = node.localId!;
    const category = (node.category ?? inherited).toUpperCase();
    const key = String(localId);
    return {
      key,
      localId,
      category,
      name: names.get(localId) ?? `${categoryName(category)} #${localId}`,
      children: (node.children ?? []).flatMap((child) => group(child, key)).sort(kindsFirst),
    };
  };
  // Under a level: its rooms and kinds of element alphabetically, after any nested levels.
  const kindsFirst = (x: TreeNode, y: TreeNode) =>
    Number(x.localId === null) - Number(y.localId === null) || (x.localId === null && y.localId === null ? byName.compare(x.name, y.name) : 0);
  return group(root, "");
}

/** Saves the viewer's conversion to file storage: an upload link, the upload, then the confirmation. */
async function saveViewCopy(saveUrl: string, model: FRAGS.FragmentsModel) {
  try {
    const buffer = await model.getBuffer(false);
    const res = await fetch(saveUrl, { method: "POST" });
    if (!res.ok) return; // the model changed meanwhile, or saving isn't allowed
    const { key, upload } = (await res.json()) as { key: string; upload: { url: string; headers: Record<string, string> } };
    const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: buffer });
    if (put.ok) await fetch(`${saveUrl}&key=${encodeURIComponent(key)}`, { method: "PATCH" });
  } catch {
    // Not saved: the next view reads the IFC again.
  }
}
