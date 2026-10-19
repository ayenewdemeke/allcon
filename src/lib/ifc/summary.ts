import { elementCorners, elementQuantities, openingPlacement, polygonArea, segments } from "./geometry";
import { lodSummary } from "./lod";
import { METERS_PER_UNIT, type ModelSpec } from "./spec";

// What an AI app (and the person) needs to check a model without seeing it: counts,
// quantities, extents and problems found.

/** Problems that make a spec unusable; returns messages (empty when fine). */
export function specErrors(spec: ModelSpec): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of spec.elements) {
    if (seen.has(e.id)) errors.push(`Duplicate element id "${e.id}"`);
    seen.add(e.id);
  }
  const levelIds = new Set<string>();
  for (const l of spec.levels) {
    if (levelIds.has(l.id)) errors.push(`Duplicate level id "${l.id}"`);
    levelIds.add(l.id);
  }
  const materialIds = new Set<string>();
  for (const m of spec.materials) {
    if (materialIds.has(m.id)) errors.push(`Duplicate material id "${m.id}"`);
    materialIds.add(m.id);
  }
  for (const [label, items] of [["opening", spec.openings], ["space", spec.spaces]] as const) {
    const ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id)) errors.push(`Duplicate ${label} id "${item.id}"`);
      ids.add(item.id);
    }
  }
  return errors.slice(0, 20);
}

export function summarizeModel(spec: ModelSpec) {
  const levels = new Set(spec.levels.map((l) => l.id));
  const materials = new Map(spec.materials.map((m) => [m.id, m]));
  const warnings: string[] = [];
  const byType = new Map<string, { count: number; volumeM3: number; length: number }>();
  const byMaterial = new Map<string, { count: number; volumeM3: number }>();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const e of spec.elements) {
    if (!segments(e).length) warnings.push(`${e.id}: its path has no length, so it has no geometry`);
    if (e.level && !levels.has(e.level)) warnings.push(`${e.id}: unknown level "${e.level}"`);
    if (e.material && !materials.has(e.material)) warnings.push(`${e.id}: unknown material "${e.material}"`);
    if (!e.material) warnings.push(`${e.id}: no material`);
    const q = elementQuantities(e, spec);
    const t = byType.get(e.type) ?? { count: 0, volumeM3: 0, length: 0 };
    byType.set(e.type, { count: t.count + 1, volumeM3: t.volumeM3 + q.volumeM3, length: t.length + q.length });
    const mName = (e.material && materials.get(e.material)?.name) || "No material";
    const m = byMaterial.get(mName) ?? { count: 0, volumeM3: 0 };
    byMaterial.set(mName, { count: m.count + 1, volumeM3: m.volumeM3 + q.volumeM3 });
    for (const p of elementCorners(e)) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
    }
  }

  // Doors, windows and openings: each needs a wall to sit in.
  const elementsById = new Map(spec.elements.map((e) => [e.id, e]));
  const openingCounts = new Map<string, number>();
  for (const o of spec.openings) {
    const host = elementsById.get(o.host);
    if (!host) warnings.push(`${o.id}: unknown host wall "${o.host}"`);
    else if (!openingPlacement(host, o)) warnings.push(`${o.id}: doesn't fit in ${o.host} (beyond its length or height, or the host isn't a wall)`);
    openingCounts.set(o.kind, (openingCounts.get(o.kind) ?? 0) + 1);
  }
  // Rooms
  const m2 = METERS_PER_UNIT[spec.units] ** 2;
  const rooms = spec.spaces.map((sp) => {
    if (sp.level && !levels.has(sp.level)) warnings.push(`${sp.id}: unknown level "${sp.level}"`);
    const area = polygonArea(sp.outline);
    return { id: sp.id, number: sp.number ?? null, name: sp.name, level: sp.level ?? null, area: Number(area.toFixed(2)), areaM2: Number((area * m2).toFixed(2)) };
  });

  // Levels a few feet apart are usually ceilings or roof zones, not floors.
  const ceiling = /ceiling|soffit|bulkhead/i;
  for (const l of spec.levels)
    if (ceiling.test(l.name)) warnings.push(`Level "${l.name}" looks like a ceiling, not a floor: put ceilings on the floor level below, at their height`);
  const sorted = [...spec.levels].sort((x, y) => x.elevation - y.elevation);
  for (let i = 1; i < sorted.length; i++) {
    const gapM = (sorted[i].elevation - sorted[i - 1].elevation) * METERS_PER_UNIT[spec.units];
    if (gapM > 0 && gapM < 2 && !ceiling.test(sorted[i].name) && !ceiling.test(sorted[i - 1].name))
      warnings.push(`Levels "${sorted[i - 1].name}" and "${sorted[i].name}" are only ${Number((gapM / METERS_PER_UNIT[spec.units]).toFixed(2))} ${spec.units} apart: levels are floors; put ceilings and similar on the floor below`);
  }
  const lod = lodSummary(spec.lod ?? null, [...spec.elements, ...spec.openings, ...spec.spaces]);
  warnings.push(...lod.warnings);

  const r = (n: number, d = 3) => Number(n.toFixed(d));
  const noMaterial = warnings.filter((w) => w.endsWith("no material")).length;
  const shown = warnings.filter((w) => !w.endsWith("no material")).slice(0, 30);
  if (noMaterial) shown.push(`${noMaterial} element${noMaterial === 1 ? " has" : "s have"} no material`);
  return {
    units: spec.units,
    facility: spec.facility,
    elements: spec.elements.length,
    levels: spec.levels.length,
    byType: [...byType].map(([type, v]) => ({ type, count: v.count, volumeM3: r(v.volumeM3), length: r(v.length, 2) })),
    byMaterial: [...byMaterial].map(([material, v]) => ({ material, count: v.count, volumeM3: r(v.volumeM3) })),
    totalVolumeM3: r([...byType.values()].reduce((s, v) => s + v.volumeM3, 0)),
    openings: Object.fromEntries(openingCounts),
    rooms: rooms.slice(0, 500),
    totalRoomAreaM2: r(rooms.reduce((s, x) => s + x.areaM2, 0), 2),
    extents: Number.isFinite(min[0])
      ? { min: min.map((v) => r(v, 2)), max: max.map((v) => r(v, 2)), size: max.map((v, i) => r(v - min[i], 2)) }
      : null,
    lod: { target: lod.target, byLevel: lod.byLevel, unset: lod.unset },
    warnings: shown,
  };
}
