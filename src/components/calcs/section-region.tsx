"use client";

import { useEffect, useMemo, useState } from "react";
import type { Result } from "@/lib/calcs/evaluate";
import { loadShapes, searchShapes, SHAPE_TYPES, SHAPES_SOURCE } from "@/lib/calcs/library/shapes";
import type { SectionRegion } from "@/lib/calcs/types";
import { cn } from "@/lib/utils";
import type { loadMathLive } from "./mathlive";
import { StaticMath } from "./regions";

// A steel section from the AISC tables: a card listing the properties it defines (A = 14.7 in²,
// I_x = 800 in⁴...), and while it's edited, a picker to choose the shape.

type MathLive = Awaited<ReturnType<typeof loadMathLive>>;
type Change<T> = (update: (r: T) => T) => void;

export function SectionRegionView({ ml, region, result, editing, selected, onChange }: { ml: MathLive | null; region: SectionRegion; result: Result | undefined; editing: boolean; selected: boolean; onChange: Change<SectionRegion> }) {
  const section = result?.kind === "section" ? result : null;
  const error = result?.kind === "error" && !result.incomplete ? result.message : null;
  return (
    <div className={cn("relative inline-flex flex-col gap-1 rounded-sm", selected && !editing && "ring-1 ring-primary", editing && "ring-1 ring-primary/50")}>
      <div className={cn("rounded border border-neutral-300 bg-white px-2 py-1", error && "border-red-500")}>
        <div className="flex items-baseline gap-2 border-b border-neutral-200 pb-0.5">
          <span className="text-[14px] font-semibold">{section?.label ?? (region.shape || "Steel section")}</span>
          {section && <span className="text-[10px] text-neutral-500">{section.metric} · {SHAPES_SOURCE}</span>}
          {region.suffix && <span className="text-[10px] text-neutral-500">names with subscript {region.suffix}</span>}
        </div>
        {error && <div className="py-1 text-[12px] text-red-600">{error}</div>}
        {!section && !error && <div className="py-1 text-[12px] text-neutral-400">{result?.kind === "error" ? result.message : "Choose a shape"}</div>}
        {section &&
          (region.compact ? (
            <div className="max-w-[600px] py-0.5 text-[11px] text-neutral-600">Defines {section.rows.map((r) => r.name.replace(/[{}\\]/g, "").replace("lambda", "λ")).join(", ")}</div>
          ) : (
            <div className="grid grid-cols-4 gap-x-5 pt-0.5 text-[13px]">
              {section.rows.map((r) => (
                <span key={r.name} title={r.what} className="whitespace-nowrap">
                  <StaticMath ml={ml} latex={`${r.name}=${r.value}`} />
                </span>
              ))}
            </div>
          ))}
      </div>
      {editing && <ShapePicker region={region} onChange={onChange} />}
    </div>
  );
}

/** Choosing the shape: its type, a search of the designations, and a subscript for the names. */
function ShapePicker({ region, onChange }: { region: SectionRegion; onChange: Change<SectionRegion> }) {
  const [ready, setReady] = useState(false);
  const [type, setType] = useState(() => region.shape.match(/^(HSS|PIPE|HP|MC|MT|ST|WT|W|C|L|S|M)/i)?.[1].toUpperCase() ?? "W");
  const [query, setQuery] = useState(region.shape);
  const [suffix, setSuffix] = useState(region.suffix ?? "");
  useEffect(() => {
    let live = true;
    void loadShapes().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  const matches = useMemo(() => (ready ? searchShapes(query, type, 80) : []), [ready, query, type]);
  const pick = (shape: string) => {
    setQuery(shape);
    onChange((r) => ({ ...r, shape }));
  };
  return (
    <div className="no-print absolute top-full left-0 z-20 mt-1 flex w-[420px] flex-col gap-1.5 rounded border bg-neutral-50 p-1.5 text-[11px] shadow-lg">
      <div className="flex items-center gap-1.5">
        <select value={type} onChange={(e) => setType(e.target.value)} className="h-6 rounded border bg-white px-1" aria-label="Shape type">
          {SHAPE_TYPES.map(([t, label]) => (
            <option key={t} value={t}>
              {label}
            </option>
          ))}
        </select>
        <input
          autoFocus
          value={query}
          placeholder="Search, e.g. W18X50"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) pick(matches[0].label);
          }}
          className="h-6 min-w-0 flex-1 rounded border bg-white px-1.5 font-mono outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div className="max-h-36 overflow-y-auto rounded border bg-white">
        {!ready && <div className="px-2 py-1 text-neutral-500">Loading the AISC tables…</div>}
        {ready && !matches.length && <div className="px-2 py-1 text-neutral-500">No {type} shapes match</div>}
        <div className="grid grid-cols-3">
          {matches.map((s) => (
            <button key={s.label} type="button" onClick={() => pick(s.label)} className={cn("truncate px-2 py-0.5 text-left font-mono hover:bg-blue-50", s.label === region.shape && "bg-blue-100")} title={`${s.label} (${s.metric})`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1" title="Added to each name, to tell several sections apart: b gives A_b, I_{x,b}">
          Subscript
          <input value={suffix} placeholder="none" onChange={(e) => setSuffix(e.target.value.replace(/[^A-Za-z0-9]/g, ""))} onBlur={() => onChange((r) => ({ ...r, suffix: suffix || undefined }))} className="h-6 w-16 rounded border bg-white px-1 font-mono outline-none" />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={!!region.compact} onChange={(e) => onChange((r) => ({ ...r, compact: e.target.checked || undefined }))} />
          Names only
        </label>
      </div>
    </div>
  );
}
