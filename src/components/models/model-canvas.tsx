"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin, LoadRegionPlugin, RayRegion, TileCompressionPlugin, TileFlatteningPlugin, TilesFadePlugin } from "3d-tiles-renderer/three/plugins";
import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { IFCSPACE } from "web-ifc";
import { ELEMENT_DATA_CONFIG, NO_UNITS, SPATIAL_CATEGORIES, categoryName, readElement, readUnits, type ElementDetails, type ModelUnits } from "@/lib/ifc/element-properties";
import type { Placement } from "@/lib/maps/placement";

// Draws a model with That Open Engine: web-ifc reads the IFC once, the fragments worker draws
// it off the main thread, and the converted model is saved so later views skip the IFC. The
// scene renders only when something changes (camera, highlight, a tile arriving). The site can
// be shown under the model from Google's photorealistic 3D tiles.

export type TreeNode = { key: string; localId: number | null; category: string; name: string; children: TreeNode[] };
export type ModelCanvasHandle = {
  fit: () => void;
  /** Looks at the model from this direction (x east, y up, z south), e.g. [1, 1, 1] for a corner. */
  orient: (direction: [number, number, number]) => void;
  /** Back to the starting 3D view. */
  home: () => void;
  /** Hides exactly these elements (everything else shown). */
  setHidden: (localIds: number[]) => void;
  /** Selects an element as if clicked, optionally flying to it. */
  select: (localId: number | null, zoom?: boolean) => void;
  clearMeasure: () => void;
  /** The model's plan outline, in metres east and north of its origin along the model's own axes. */
  footprint: () => { east: number; north: number }[] | null;
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
  /** The camera's view matrix whenever it moves (for the view cube). */
  onCamera?: (viewMatrix: ArrayLike<number>) => void;
  /** The site from Google's photorealistic 3D tiles, with the model placed on it; null to hide it. */
  site?: { apiKey: string; placement: Placement } | null;
  /** The map data credits to show while the site is on. */
  onSiteCredits?: (credits: string) => void;
  /** The site couldn't be loaded (the map service refused it). */
  onSiteError?: (message: string) => void;
  /** Ground elevations above sea level (Google's), for placing a model at its own height. */
  elevationAt?: (places: { lat: number; lng: number }[]) => Promise<(number | null)[]>;
};

/** What the site layer needs from the loaded model and its engine. */
type Engine = {
  world: World;
  redraw: () => void;
  /** Where the IFC's origin ended up in the scene (the engine moves models near the origin). */
  origin: THREE.Vector3;
  /** The model's extent in the scene. */
  box: THREE.Box3;
  /** Widens the camera's range for the site, or back to just the model. */
  setSiteView: (on: boolean) => void;
};

type World = OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>;
type Item = Record<string, unknown>;

const SELECT = { color: new THREE.Color("#2563eb"), opacity: 1, transparent: false, renderedFaces: FRAGS.RenderedFaces.TWO };
const DRAG = 5; // pixels a pointer can move and still count as a click
const ISO = new THREE.Vector3(0.6, 0.45, 0.8).normalize();
const DEG = Math.PI / 180;
// East-north-up axes to the scene's: x east, y up, z south.
const ENU_TO_SCENE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);

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
    home: () => handle.current?.home(),
    setHidden: (ids) => handle.current?.setHidden(ids),
    select: (id, zoom) => handle.current?.select(id, zoom),
    clearMeasure: () => handle.current?.clearMeasure(),
    footprint: () => handle.current?.footprint() ?? null,
  }));

  const { modelId, revision, ifcUrl, viewUrl, saveUrl } = props;
  const engine = useRef<Engine | null>(null);
  const [loaded, setLoaded] = useState(false);
  const apiKey = props.site?.apiKey ?? null;
  const placement = props.site?.placement ?? null;
  const placeSite = useRef<((p: Placement) => void) | null>(null);

  // The site, declared before the model's engine so it's taken down before the engine is.
  useEffect(() => {
    const e = engine.current;
    if (!loaded || !e || !apiKey) return;
    const { world, redraw, origin, box } = e;
    const camera = world.camera.three;
    const renderer = world.renderer!;
    const tiles = new TilesRenderer();
    const draco = new DRACOLoader().setDecoderPath("/draco/");
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    const flattening = new TileFlatteningPlugin();
    tiles.registerPlugin(flattening);
    // The ground is read straight down at points across the model's footprint and the land
    // around it (the streets and yards), so a low reading isn't a building or tree standing on
    // the site today. The tiles under those points always load, in detail, whatever the camera
    // sees.
    const around = Math.max(20, (box.max.x - box.min.x + box.max.z - box.min.z) / 4);
    const samples = Array.from({ length: 25 }, (_, k) => [
      box.min.x - around + ((box.max.x - box.min.x + 2 * around) * Math.floor(k / 5)) / 4,
      box.min.z - around + ((box.max.z - box.min.z + 2 * around) * (k % 5)) / 4,
    ]);
    const probes = samples.map(() => new RayRegion({ errorTarget: 4 }));
    const regions = new LoadRegionPlugin();
    probes.forEach((probe) => regions.addRegion(probe));
    tiles.registerPlugin(regions);
    tiles.group.matrixAutoUpdate = false;
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer.three);
    world.scene.three.add(tiles.group);
    e.setSiteView(true);

    // The tiles are placed so the placement's point is at its anchor on the model (the IFC
    // origin, a base point, or the model's middle), turned by its heading, with the ground at
    // the model's level 0 (raised or lowered by its elevation). Level 0 is the anchor's height
    // when the model spans it; a model drawn at real elevations (z = 5280 ft) with no base point
    // stands on its lowest point instead. The ground's height is found by looking down onto the
    // tiles as they load.
    let current: Placement | null = null;
    let at = new THREE.Vector3(); // the anchor in the scene
    let base = 0; // level 0 in the scene
    let ground = 0; // the ground's height above the ellipsoid at the placement, in metres
    let geoid: number | null | undefined; // sea level above the ellipsoid; undefined: not asked yet; null: unknown
    let steady = 0; // ground readings in a row that barely moved
    let firstReading = 0;
    let asked = 0;
    let settleUntil = Infinity; // reading the ground until a while after the first reading
    const enu = new THREE.Matrix4();
    const apply = () => {
      if (!current) return;
      const [ax, ay, az] = current.anchor ?? [NaN, NaN, 0];
      at = current.anchor
        ? new THREE.Vector3(origin.x + ax, origin.y + az, origin.z - ay)
        : new THREE.Vector3((box.min.x + box.max.x) / 2, origin.y, (box.min.z + box.max.z) / 2);
      base = at.y >= box.min.y - 0.5 && at.y <= box.max.y ? at.y : box.min.y;
      tiles.ellipsoid.getEastNorthUpFrame(current.lat * DEG, current.lon * DEG, 0, enu).invert();
      const m = new THREE.Matrix4().makeTranslation(at.x, base - current.elevation - ground, at.z);
      m.multiply(new THREE.Matrix4().makeRotationY(current.heading * DEG)).multiply(ENU_TO_SCENE).multiply(enu);
      tiles.group.matrix.copy(m);
      tiles.group.matrixWorldNeedsUpdate = true;
      // The probes, in the tiles' own (Earth-centred) frame.
      const toTiles = m.clone().invert();
      const down = new THREE.Vector3(0, -1, 0).transformDirection(toTiles);
      probes.forEach((probe, k) => {
        probe.ray.origin.set(samples[k][0], base + 20_000, samples[k][1]).applyMatrix4(toTiles);
        probe.ray.direction.copy(down);
      });
      clearSoon();
      redraw();
    };

    // The site is cleared under the model, as it would be for construction, so the buildings
    // and trees there today don't hide it: the ground within its footprint (and a couple of
    // metres around) is flattened to level 0, and whatever still stands there above it (a roof
    // spanning past the footprint) is cut away.
    const cut = Array.from({ length: 5 }, () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -1e9));
    renderer.three.localClippingEnabled = true;
    const onTileLoaded = ({ scene }: { scene: THREE.Object3D }) =>
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.material) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          material.clippingPlanes = cut;
          material.clipIntersection = true; // only what's inside all the planes: the footprint, above the ground
        }
      });
    let shape: THREE.Mesh | null = null;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const clearSite = () => {
      if (shape) {
        flattening.deleteShape(shape);
        shape.geometry.dispose();
        shape = null;
      }
      if (!current) return;
      tiles.group.updateMatrixWorld();
      const toTiles = tiles.group.matrixWorld.clone().invert();
      const y = base - current.elevation - 0.05; // just under level 0, clear of the model's floor
      const margin = 2;
      // Planes facing out of the footprint's box, which starts just above the ground.
      cut[0].set(new THREE.Vector3(1, 0, 0), -(box.max.x + margin));
      cut[1].set(new THREE.Vector3(-1, 0, 0), box.min.x - margin);
      cut[2].set(new THREE.Vector3(0, 0, 1), -(box.max.z + margin));
      cut[3].set(new THREE.Vector3(0, 0, -1), box.min.z - margin);
      cut[4].set(new THREE.Vector3(0, -1, 0), y + 0.2);
      const corners = [
        [box.min.x - margin, box.min.z - margin],
        [box.max.x + margin, box.min.z - margin],
        [box.max.x + margin, box.max.z + margin],
        [box.min.x - margin, box.max.z + margin],
      ].map(([x, z]) => new THREE.Vector3(x, y, z).applyMatrix4(toTiles));
      // Positions relative to the shape's middle: Earth-centred coordinates are too large for
      // the geometry's single precision.
      const middle = corners.reduce((sum, c) => sum.add(c), new THREE.Vector3()).divideScalar(corners.length);
      const geometry = new THREE.BufferGeometry().setFromPoints(corners.map((c) => c.clone().sub(middle)));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      shape = new THREE.Mesh(geometry);
      shape.position.copy(middle);
      shape.updateMatrixWorld();
      // Everything within the shape is flattened onto it (the typings still show an older signature).
      flattening.addShape(shape, new THREE.Vector3(0, 1, 0).transformDirection(toTiles), {} as unknown as number);
      redraw();
    };
    // Flattening re-reads the tiles under the model, so it runs at most a couple of times a second.
    const clearSoon = () => {
      clearTimer ??= setTimeout(() => {
        clearTimer = undefined;
        clearSite();
      }, 400);
    };
    placeSite.current = (p) => {
      const moved = !current || current.lat !== p.lat || current.lon !== p.lon || String(current.anchor) !== String(p.anchor);
      if (!current || current.height !== p.height) {
        geoid = undefined;
        steady = 0;
        asked = 0;
      }
      current = p;
      if (moved) settleUntil = Infinity;
      apply();
    };
    if (placement) placeSite.current(placement);

    // The ground: a low reading (one in five from the bottom) of the probes. A model with its
    // own height (survey coordinates) goes at that height instead. The tiles' heights are above
    // the ellipsoid, not sea level; the difference (the geoid) is the low reading of tile height
    // minus Google's ground elevation at the same points (the low one is bare ground, not a roof).
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const settle = () => {
      if (!current || performance.now() > settleUntil) return;
      const hits: { k: number; y: number }[] = [];
      samples.forEach(([x, z], k) => {
        raycaster.set(new THREE.Vector3(x, base + 20_000, z), down);
        raycaster.far = 40_000;
        const hit = raycaster.intersectObject(tiles.group, true)[0];
        if (hit) hits.push({ k, y: hit.point.y });
      });
      if (hits.length < 5) return;
      if (typeof geoid === "number") return;
      // Finer tiles keep arriving for a while; after that the ground stays put.
      if (settleUntil === Infinity) {
        settleUntil = performance.now() + 20_000;
        firstReading = performance.now();
      }
      const heights = hits.map((h) => h.y).sort((a, b) => a - b);
      const delta = heights[Math.floor(heights.length / 5)] - (base - current.elevation);
      steady = Math.abs(delta) < 0.5 ? steady + 1 : 0;
      // Once the readings come from detailed tiles (they've stopped moving), a model with its own
      // height asks for the ground's elevation above sea level at the same points.
      const detailed = steady >= 2 && performance.now() - firstReading > 4000;
      if (detailed && current.height !== null && geoid === undefined && asked < 5 && latest.current.elevationAt) {
        asked++;
        geoid = null;
        const placed = current;
        const offset = base - current.elevation - ground; // the ellipsoid's height in the scene
        const toTiles = tiles.group.matrix.clone().invert();
        const places = hits.map(({ k }) => {
          const cart = tiles.ellipsoid.getPositionToCartographic(new THREE.Vector3(samples[k][0], base, samples[k][1]).applyMatrix4(toTiles), {} as { lat: number; lon: number });
          return { lat: cart.lat / DEG, lng: cart.lon / DEG };
        });
        latest.current
          .elevationAt(places)
          .then((elevations) => {
            const differences = hits.flatMap(({ y }, i) => (elevations[i] === null ? [] : [y - offset - elevations[i]!])).sort((a, b) => a - b);
            if (current !== placed) return;
            const found = differences.length >= 5 ? differences[Math.floor(differences.length / 5)] : NaN;
            // Sea level is within about 110 m of the ellipsoid everywhere; otherwise the tiles
            // read were still coarse: try again later.
            if (!(Math.abs(found) < 150)) {
              geoid = undefined;
              steady = 0;
              return;
            }
            geoid = found;
            ground = placed.height! + geoid;
            settleUntil = 0; // known: no more reading the ground
            apply();
          })
          .catch(() => {});
      }
      if (Math.abs(delta) < 0.05) return;
      ground += delta;
      apply();
    };
    const credits = () => {
      const text = tiles
        .getAttributions()
        .filter((a) => a.type === "string")
        .map((a) => String(a.value))
        .join("; ");
      latest.current.onSiteCredits?.(text);
    };
    // Read the ground as tiles arrive (a few times a second at most), not only when loading
    // pauses: with the probes it can keep going for a while.
    let lastSettle = 0;
    const onTileArrived = (event: { scene: THREE.Object3D }) => {
      onTileLoaded(event);
      const now = performance.now();
      if (now - lastSettle < 300) return;
      lastSettle = now;
      settle();
    };
    const onLoadEnd = () => {
      settle();
      credits();
      redraw();
    };
    const onError = (event: { tile: unknown; error: unknown }) => {
      if (event.tile) return; // one missing tile leaves a gap; a missing root leaves no site
      latest.current.onSiteError?.(event.error instanceof Error ? event.error.message : String(event.error));
    };
    const beforeRender = () => {
      tiles.setResolutionFromRenderer(camera, renderer.three);
      tiles.update();
    };
    renderer.onBeforeUpdate.add(beforeRender);
    tiles.addEventListener("needs-update", redraw);
    tiles.addEventListener("needs-render", redraw);
    tiles.addEventListener("tiles-load-end", onLoadEnd);
    tiles.addEventListener("load-error", onError);
    tiles.addEventListener("load-model", onTileArrived);
    redraw();

    return () => {
      placeSite.current = null;
      clearTimeout(clearTimer);
      shape?.geometry.dispose();
      renderer.onBeforeUpdate.remove(beforeRender);
      tiles.removeEventListener("needs-update", redraw);
      tiles.removeEventListener("needs-render", redraw);
      tiles.removeEventListener("tiles-load-end", onLoadEnd);
      tiles.removeEventListener("load-error", onError);
      tiles.removeEventListener("load-model", onTileArrived);
      world.scene.three.remove(tiles.group);
      tiles.dispose();
      draco.dispose();
      e.setSiteView(false);
      redraw();
    };
    // Placement changes move the tiles (below) rather than reloading them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, apiKey]);

  useEffect(() => {
    if (placement) placeSite.current?.(placement);
  }, [placement]);

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
    let siteView = false;
    const clip = () => {
      const camera = world.camera.three as THREE.PerspectiveCamera;
      const toCenter = camera.position.distanceTo(bounds.center);
      // With the site shown the ground can be anywhere in front, nearer than the model.
      const near = siteView ? Math.max(controls.distance / 200, 0.05) : Math.max((toCenter - bounds.radius) * 0.9, controls.distance / 100, 0.01);
      const far = siteView ? Math.max(toCenter * 50, 50_000) : toCenter + bounds.radius * 2 + 1;
      if (camera.near === near && camera.far === far) return;
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    };
    const reportCamera = () => {
      const camera = world.camera.three;
      camera.updateMatrixWorld();
      latest.current.onCamera?.(camera.matrixWorldInverse.elements);
    };
    controls.addEventListener("update", () => {
      clip();
      reportCamera();
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
      orient: ([x, y, z]) => {
        // Straight down or up, a hair off vertical keeps "up" defined (north at the top).
        const vertical = Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6;
        lookFrom(new THREE.Vector3(x, y, vertical ? 0.001 : z));
      },
      home: () => lookFrom(ISO),
      setHidden: async (ids) => {
        if (!model) return;
        await model.resetVisible();
        if (ids.length) await model.setVisible(ids, false);
        await fragments.core.update(true);
        redraw();
      },
      select: (id, zoom) => void select(id, zoom),
      clearMeasure,
      footprint: () => {
        const b = box();
        const origin = engine.current?.origin;
        if (b.isEmpty() || !origin) return null;
        // Scene x is the model's east, scene -z its north.
        return [
          [b.min.x, b.min.z],
          [b.max.x, b.min.z],
          [b.max.x, b.max.z],
          [b.min.x, b.max.z],
        ].map(([x, z]) => ({ east: x - origin.x, north: origin.z - z }));
      },
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
        const modelRange = Math.max(bounds.radius * 20, 50); // zooming out never loses the model
        controls.maxDistance = modelRange;
        lookFrom(ISO);
        controls.update(0);
        reportCamera();

        // The IFC's origin, where the engine moved it to keep coordinates small.
        const [ox = 0, oy = 0, oz = 0] = await model.getCoordinates().catch(() => [] as number[]);
        engine.current = {
          world,
          redraw,
          origin: new THREE.Vector3(ox, oy, oz),
          box: box(),
          setSiteView: (on) => {
            siteView = on;
            controls.maxDistance = on ? 20_000 : modelRange;
            clip();
            // Step back and up to see the model among its surroundings.
            if (on) {
              const size = box().getSize(new THREE.Vector3());
              lookFrom(new THREE.Vector3(0.5, 1.6, 0.7), box().expandByScalar(Math.max(20, Math.max(size.x, size.z) * 0.35)));
            }
          },
        };
        setLoaded(true);

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
      engine.current = null;
      setLoaded(false);
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
