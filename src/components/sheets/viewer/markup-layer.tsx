"use client";

import { useRef } from "react";
import type { SavedMarkup } from "@/app/actions/sheets";
import { formatMeasure, measureMarkup, type Point, type UnitSystem } from "@/lib/takeoff";
import type { View } from "./view";

export type DraftKind = SavedMarkup["kind"] | "calibrate";
export type Draft = { kind: DraftKind; points: Point[] };

const EDIT2D_KINDS = new Set(["length", "area"]);

type Props = {
  markups: SavedMarkup[];
  selectedId: string | null;
  draft: Draft | null;
  cursor: Point | null;
  view: View;
  metersPerPoint: number | null;
  unitSystem: UnitSystem;
  selectable: boolean;
  onSelect: (id: string) => void;
  /** Live position while an overlay markup is dragged, and the final one on release. */
  onMove: (id: string, points: Point[]) => void;
  onMoveEnd: (id: string, points: Point[]) => void;
};

const DRAG_SLOP = 3; // px before a press becomes a drag

const toScreen = (p: Point, v: View): Point => [v.tx + p[0] * v.zoom, v.ty + p[1] * v.zoom];
const pathOf = (pts: Point[], close = false) =>
  pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") + (close ? " Z" : "");

function centroid(pts: Point[]): Point {
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

/** Revision cloud: scalloped arcs along the rectangle's edges. */
function cloudPath(a: Point, b: Point, bump: number) {
  const [x1, x2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y1, y2] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const corners: Point[] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  let d = `M${x1} ${y1}`;
  for (let i = 0; i < 4; i++) {
    const [p, q] = [corners[i], corners[(i + 1) % 4]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(1, Math.round(len / bump));
    const r = len / n / 2;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      d += ` A${r} ${r} 0 0 1 ${p[0] + (q[0] - p[0]) * t} ${p[1] + (q[1] - p[1]) * t}`;
    }
  }
  return d;
}

function Label({ at, text, color }: { at: Point; text: string; color: string }) {
  const w = text.length * 6.6 + 12;
  return (
    <g transform={`translate(${at[0]} ${at[1]})`} className="pointer-events-none">
      <rect x={-w / 2} y={-11} width={w} height={20} rx={4} fill="white" stroke={color} strokeWidth={1} opacity={0.95} />
      <text textAnchor="middle" y={3} fontSize={11} fontWeight={600} fill={color} className="font-sans tabular-nums">
        {text}
      </text>
    </g>
  );
}

function valueText(m: Pick<SavedMarkup, "kind" | "points" | "depth">, mpp: number | null, units: UnitSystem) {
  const measured = measureMarkup(m, mpp);
  if (!measured) return m.kind === "length" || m.kind === "area" ? "Set scale" : null;
  return formatMeasure(measured.value, measured.kind, units);
}

function Shape({
  m,
  view,
  selected,
  mpp,
  units,
  labelOnly = false,
}: {
  m: Pick<SavedMarkup, "kind" | "points" | "color" | "depth" | "text" | "label">;
  view: View;
  selected: boolean;
  mpp: number | null;
  units: UnitSystem;
  /** The shape itself is drawn by Edit2D; only its value label is drawn here. */
  labelOnly?: boolean;
}) {
  const pts = m.points.map((p) => toScreen(p, view));
  const stroke = m.color;
  const width = selected ? 3 : 2;
  const halo = selected ? <path d={pathOf(pts, m.kind === "area")} stroke="#fff" strokeWidth={7} fill="none" opacity={0.9} /> : null;

  switch (m.kind) {
    case "length": {
      const mid = pts[Math.floor((pts.length - 1) / 2)];
      const next = pts[Math.min(pts.length - 1, Math.floor((pts.length - 1) / 2) + 1)];
      const text = valueText(m, mpp, units);
      const label = text && pts.length > 1 && <Label at={[(mid[0] + next[0]) / 2, (mid[1] + next[1]) / 2 - 14]} text={text} color={stroke} />;
      if (labelOnly) return <g>{label}</g>;
      return (
        <g>
          {halo}
          <path d={pathOf(pts)} stroke={stroke} strokeWidth={width} fill="none" strokeLinejoin="round" />
          {pts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="white" stroke={stroke} strokeWidth={1.5} />
          ))}
          {label}
        </g>
      );
    }
    case "area": {
      const text = valueText(m, mpp, units);
      const label = text && pts.length > 2 && <Label at={centroid(pts)} text={text} color={stroke} />;
      if (labelOnly) return <g>{label}</g>;
      return (
        <g>
          {halo}
          <path d={pathOf(pts, true)} stroke={stroke} strokeWidth={width} fill={stroke} fillOpacity={0.15} strokeLinejoin="round" />
          {label}
        </g>
      );
    }
    case "count":
      return (
        <g>
          {pts.map((p, i) => (
            <g key={i}>
              {selected && <circle cx={p[0]} cy={p[1]} r={11} fill="none" stroke="#fff" strokeWidth={4} />}
              <circle cx={p[0]} cy={p[1]} r={9} fill={stroke} stroke="white" strokeWidth={1.5} />
              <text x={p[0]} y={p[1] + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="white" className="pointer-events-none font-sans">
                {i + 1}
              </text>
            </g>
          ))}
        </g>
      );
    case "arrow": {
      if (pts.length < 2) return null;
      const [a, b] = pts;
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = (s: number) => [b[0] - 12 * Math.cos(angle + s), b[1] - 12 * Math.sin(angle + s)];
      const [h1, h2] = [head(0.45), head(-0.45)];
      return (
        <g>
          <path d={pathOf([a, b])} stroke={selected ? "#fff" : "none"} strokeWidth={7} />
          <path d={pathOf([a, b])} stroke={stroke} strokeWidth={width} />
          <path d={`M${h1[0]} ${h1[1]} L${b[0]} ${b[1]} L${h2[0]} ${h2[1]} Z`} fill={stroke} stroke={stroke} strokeWidth={1} />
        </g>
      );
    }
    case "cloud": {
      if (pts.length < 2) return null;
      const d = cloudPath(pts[0], pts[1], Math.max(10, 12 * view.zoom));
      return (
        <g>
          {selected && <path d={d} stroke="#fff" strokeWidth={7} fill="none" />}
          <path d={d} stroke={stroke} strokeWidth={width} fill="none" />
        </g>
      );
    }
    case "note": {
      const text = m.text || m.label || "Note";
      const lines = text.split("\n").slice(0, 6);
      const w = Math.min(260, Math.max(...lines.map((l) => l.length)) * 6.6 + 16);
      const h = lines.length * 15 + 10;
      const [x, y] = pts[0];
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill="#fffbe6" stroke={selected ? stroke : "#e5c96a"} strokeWidth={selected ? 2 : 1} />
          {lines.map((line, i) => (
            <text key={i} x={x + 8} y={y + 17 + i * 15} fontSize={12} fill="#3f3f46" className="pointer-events-none font-sans">
              {line}
            </text>
          ))}
        </g>
      );
    }
  }
}

export function MarkupLayer({ markups, selectedId, draft, cursor, view, metersPerPoint, unitSystem, selectable, onSelect, onMove, onMoveEnd }: Props) {
  const draftPoints = draft ? (cursor ? [...draft.points, cursor] : draft.points) : [];
  const drag = useRef<{ id: string; x: number; y: number; points: Point[]; moved: boolean; last: Point[] } | null>(null);

  const dragTo = (clientX: number, clientY: number) => {
    const d = drag.current;
    if (!d) return;
    const dx = clientX - d.x;
    const dy = clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    d.moved = true;
    d.last = d.points.map(([x, y]) => [x + dx / view.zoom, y + dy / view.zoom] as Point);
    onMove(d.id, d.last);
  };
  return (
    // The root lets clicks through to the Viewer; only our own shapes can be clicked.
    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-hidden">
      {markups.map((m) => {
        const labelOnly = EDIT2D_KINDS.has(m.kind);
        return (
          <g
            key={m.id}
            data-markup-id={m.id}
            style={{ cursor: selectable && !labelOnly ? "move" : undefined, pointerEvents: selectable && !labelOnly ? "visiblePainted" : "none" }}
            onPointerDown={(e) => {
              if (e.button !== 0) return; // right-click opens the menu instead
              e.stopPropagation();
              onSelect(m.id);
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id: m.id, x: e.clientX, y: e.clientY, points: m.points, moved: false, last: m.points };
            }}
            onPointerMove={(e) => dragTo(e.clientX, e.clientY)}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (d?.moved) onMoveEnd(d.id, d.last);
            }}
          >
            <Shape m={m} view={view} selected={m.id === selectedId} mpp={metersPerPoint} units={unitSystem} labelOnly={labelOnly} />
          </g>
        );
      })}

      {draft && draftPoints.length > 0 && (
        <g className="pointer-events-none">
          {draft.kind === "calibrate" ? (
            <>
              <path d={pathOf(draftPoints.map((p) => toScreen(p, view)))} stroke="#f97316" strokeWidth={2} strokeDasharray="6 4" fill="none" />
              {draftPoints.map((p, i) => {
                const s = toScreen(p, view);
                return <circle key={i} cx={s[0]} cy={s[1]} r={4} fill="#f97316" />;
              })}
            </>
          ) : (
            <g opacity={0.9}>
              <Shape
                m={{ kind: draft.kind, points: draftPoints, color: "#f97316", depth: null, text: null, label: null }}
                view={view}
                selected={false}
                mpp={metersPerPoint}
                units={unitSystem}
              />
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
