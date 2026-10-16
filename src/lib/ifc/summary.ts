import { elementCorners, elementQuantities, segments } from "./geometry";
import type { ModelSpec } from "./spec";

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
    extents: Number.isFinite(min[0])
      ? { min: min.map((v) => r(v, 2)), max: max.map((v) => r(v, 2)), size: max.map((v, i) => r(v - min[i], 2)) }
      : null,
    warnings: shown,
  };
}
