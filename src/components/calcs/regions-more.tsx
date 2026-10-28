"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { axes, PLOT_COLORS as COLORS, tickLabel as label } from "@/lib/calcs/axes";
import type { Result, Trace } from "@/lib/calcs/evaluate";
import type { PlotRegion, SolveRegion, TableRegion } from "@/lib/calcs/types";
import { cn } from "@/lib/utils";
import { loadMathLive, makeField, type MathfieldElement } from "./mathlive";
import { mathcadKey, StaticMath } from "./regions";

// Tables, plots and solve blocks: regions made of several pieces of math, edited in place when
// the region is clicked, as in Mathcad.

type MathLive = Awaited<ReturnType<typeof loadMathLive>>;
/** Changes to a region, made to its latest version (several fields can commit at once). */
type Change<T> = (update: (r: T) => T) => void;

/** A small math field for a piece of a region (a trace's axis, a constraint): live while the
 * region is being edited, rendered math otherwise. */
export function MathInput({
  ml,
  value,
  active,
  focus,
  placeholder,
  onCommit,
  onEnter,
  className,
}: {
  ml: MathLive | null;
  value: string;
  active: boolean;
  focus?: boolean;
  placeholder?: string;
  onCommit: (latex: string) => void;
  onEnter?: (latex: string) => void;
  className?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  const handlers = useRef({ onCommit, onEnter, focus });
  useEffect(() => {
    handlers.current = { onCommit, onEnter, focus };
  });
  // Focus moves here (Enter on the line before, or a new region).
  useEffect(() => {
    if (focus && active) requestAnimationFrame(() => field.current?.focus());
  }, [focus, active]);
  useEffect(() => {
    if (!active || !ml || !host.current) return;
    const mf: MathfieldElement = makeField(ml, value);
    let previous = "";
    let last = value;
    const commit = () => {
      if (mf.value !== last) {
        last = mf.value;
        handlers.current.onCommit(mf.value);
      }
    };
    mf.addEventListener(
      "keydown",
      (e) => {
        const prev = previous;
        previous = e.key;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commit();
          handlers.current.onEnter?.(mf.value);
        } else if (mathcadKey(mf, e.key, prev)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { capture: true },
    );
    mf.addEventListener("focusout", commit);
    host.current.appendChild(mf);
    field.current = mf;
    if (handlers.current.focus) {
      mf.focus();
      requestAnimationFrame(() => !mf.hasFocus() && mf.focus());
    }
    return () => {
      commit();
      field.current = null;
      mf.remove();
    };
    // A field per editing session; value is its starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ml]);
  if (active) return <span ref={host} className={cn("calc-field inline-block min-w-10 rounded-sm bg-white px-0.5 ring-1 ring-neutral-300", className)} />;
  return value ? <StaticMath ml={ml} latex={value} className={className} /> : <span className={cn("text-[12px] text-neutral-400", className)}>{placeholder}</span>;
}

function LineError({ result }: { result: Result | undefined }) {
  if (result?.kind !== "error" || result.incomplete) return null;
  return <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] text-white">{result.message}</span>;
}

// --- tables ------------------------------------------------------------------------------------

type TableProps = {
  ml: MathLive | null;
  region: TableRegion;
  result: Result | undefined;
  editing: boolean;
  selected: boolean;
  onChange: Change<TableRegion>;
};

/** A table: each column becomes a vector named for it, in its unit. */
export function TableRegionView(props: TableProps) {
  // Edited as a draft, started afresh each time editing starts.
  return <TableGrid key={props.editing ? "editing" : "shown"} {...props} />;
}

function TableGrid({ ml, region, result, editing, selected, onChange }: TableProps) {
  const [draft, setDraft] = useState(region);
  const save = (next: TableRegion) => {
    setDraft(next);
    onChange(() => next);
  };
  const t = editing ? draft : region;
  const cell = "border border-neutral-400 px-1 text-right text-[13px] tabular-nums";
  const input = "w-16 bg-transparent text-right outline-none focus:bg-blue-50";
  const set = (r: number, c: number, text: string) =>
    setDraft({
      ...t,
      rows: t.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? text : x)) : row)),
    });
  const error = result?.kind === "error" ? result : null;
  return (
    <div className={cn("inline-block rounded-sm p-0.5", selected && !editing && "ring-1 ring-primary", error && "ring-1 ring-red-500")}>
      <table className="border-collapse bg-white">
        <thead>
          <tr>
            {t.columns.map((col, c) => (
              <th key={c} className="border border-neutral-400 bg-neutral-50 px-1.5 py-0.5 text-[13px] font-normal">
                {editing ? (
                  <input
                    value={col.name}
                    placeholder="name"
                    onChange={(e) =>
                      setDraft({
                        ...t,
                        columns: t.columns.map((x, j) => (j === c ? { ...x, name: e.target.value.replace(/\s/g, "") } : x)),
                      })
                    }
                    onBlur={() => save(draft)}
                    className="w-16 bg-transparent text-center italic outline-none"
                  />
                ) : (
                  <StaticMath ml={ml} latex={nameLatex(col.name) || "\\placeholder{}"} />
                )}
              </th>
            ))}
            {editing && (
              <th className="border-0 pl-1">
                <button
                  type="button"
                  title="Add a column"
                  onClick={() =>
                    save({
                      ...t,
                      columns: [...t.columns, { name: "", unit: "" }],
                      rows: t.rows.map((r) => [...r, ""]),
                    })
                  }
                  className="rounded p-0.5 text-neutral-500 hover:bg-neutral-100"
                >
                  <Plus className="size-3.5" />
                </button>
              </th>
            )}
          </tr>
          <tr>
            {t.columns.map((col, c) => (
              <th key={c} className="border border-neutral-400 bg-neutral-50 px-1.5 text-[11px] font-normal text-neutral-600">
                {editing ? (
                  <input
                    value={col.unit}
                    placeholder="unit"
                    onChange={(e) =>
                      setDraft({
                        ...t,
                        columns: t.columns.map((x, j) => (j === c ? { ...x, unit: e.target.value } : x)),
                      })
                    }
                    onBlur={() => save(draft)}
                    className="w-16 bg-transparent text-center outline-none"
                  />
                ) : (
                  col.unit || " "
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((row, r) => (
            <tr key={r}>
              {t.columns.map((_, c) => (
                <td key={c} className={cell}>
                  {editing ? (
                    <input
                      value={row[c] ?? ""}
                      onChange={(e) => set(r, c, e.target.value)}
                      onBlur={() => save(draft)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && r === t.rows.length - 1) {
                          const next = {
                            ...draft,
                            rows: [...draft.rows, draft.columns.map(() => "")],
                          };
                          save(next);
                        }
                      }}
                      className={input}
                    />
                  ) : (
                    row[c] || " "
                  )}
                </td>
              ))}
              {editing && (
                <td className="border-0 pl-1">
                  <button type="button" title="Remove the row" onClick={() => save({ ...t, rows: t.rows.filter((_, i) => i !== r) })} className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                    <X className="size-3" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <button type="button" onClick={() => save({ ...t, rows: [...t.rows, t.columns.map(() => "")] })} className="mt-0.5 flex items-center gap-1 rounded px-1 text-[11px] text-neutral-500 hover:bg-neutral-100">
          <Plus className="size-3" /> Row
        </button>
      )}
      {error && <div className="mt-0.5 text-[11px] text-red-600">{error.message}</div>}
    </div>
  );
}

/** A table column's name as math: P_u → P_{u}. */
const nameLatex = (name: string) => name.replace(/_(.+)$/, "_{$1}");

// --- plots -------------------------------------------------------------------------------------

export function PlotRegionView({ ml, region, result, editing, selected, onChange }: { ml: MathLive | null; region: PlotRegion; result: Result | undefined; editing: boolean; selected: boolean; onChange: Change<PlotRegion> }) {
  const traces: Trace[] = result?.kind === "plot" ? result.traces : [];
  const { x: xt, y: yt } = axes(traces);
  const [W, H] = [region.width, region.height];
  const pad = { left: 52, right: 12, top: 10, bottom: 30 };
  const sx = (x: number) => pad.left + ((x - xt.lo) / (xt.hi - xt.lo)) * (W - pad.left - pad.right);
  const sy = (y: number) => H - pad.bottom - ((y - yt.lo) / (yt.hi - yt.lo)) * (H - pad.top - pad.bottom);
  const units = result?.kind === "plot" ? result : null;
  // The field with the focus: a new plot starts at its first y; Enter goes from y to x.
  const [focus, setFocus] = useState<string | null>(() => (region.traces[0]?.y ? null : "y0"));
  const setTrace = (i: number, patch: Partial<{ x: string; y: string }>) =>
    onChange((p) => ({
      ...p,
      traces: p.traces.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    }));
  return (
    <div className={cn("inline-flex flex-col items-start gap-1 rounded-sm p-1", selected && !editing && "ring-1 ring-primary", editing && "ring-1 ring-primary/50")}>
      <div className="flex items-center gap-1">
        {/* The y axis: its expressions, rotated as Mathcad shows them. */}
        <div className="flex w-6 flex-col items-center justify-center" style={{ height: H }}>
          <div className="flex -rotate-90 items-center gap-2 whitespace-nowrap text-[12px]">
            {region.traces.map((t, i) => (
              <span key={i} style={{ color: COLORS[i % COLORS.length] }}>
                {t.y ? <StaticMath ml={ml} latex={t.y} /> : "y"}
              </span>
            ))}
            {units?.yUnit && <span className="text-neutral-500">({units.yUnit.replace(/inch/g, "in")})</span>}
          </div>
        </div>
        <svg width={W} height={H} className="bg-white">
          {yt.values.map((v) => (
            <g key={`y${v}`}>
              <line x1={pad.left} x2={W - pad.right} y1={sy(v)} y2={sy(v)} stroke="#e5e7eb" />
              <text x={pad.left - 4} y={sy(v) + 3} textAnchor="end" fontSize="10" fill="#374151">
                {label(v, yt.step)}
              </text>
            </g>
          ))}
          {xt.values.map((v) => (
            <g key={`x${v}`}>
              <line y1={pad.top} y2={H - pad.bottom} x1={sx(v)} x2={sx(v)} stroke="#e5e7eb" />
              <text y={H - pad.bottom + 13} x={sx(v)} textAnchor="middle" fontSize="10" fill="#374151">
                {label(v, xt.step)}
              </text>
            </g>
          ))}
          {xt.lo < 0 && xt.hi > 0 && <line y1={pad.top} y2={H - pad.bottom} x1={sx(0)} x2={sx(0)} stroke="#9ca3af" />}
          {yt.lo < 0 && yt.hi > 0 && <line x1={pad.left} x2={W - pad.right} y1={sy(0)} y2={sy(0)} stroke="#9ca3af" />}
          <rect x={pad.left} y={pad.top} width={W - pad.left - pad.right} height={H - pad.top - pad.bottom} fill="none" stroke="#374151" />
          {traces.map((t, i) => (
            <polyline
              key={i}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth="1.6"
              points={t.xs
                .map((x, k) => [x, t.ys[k]])
                .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
                .map(([x, y]) => `${sx(x)},${sy(y)}`)
                .join(" ")}
            />
          ))}
          {traces.map((t, i) => (t.xs.length <= 30 ? t.xs.map((x, k) => Number.isFinite(x) && Number.isFinite(t.ys[k]) && <circle key={`${i}-${k}`} cx={sx(x)} cy={sy(t.ys[k])} r="2.2" fill={COLORS[i % COLORS.length]} />) : null))}
        </svg>
      </div>
      {/* The x axis: its expressions below (once, when the traces share one). */}
      <div className="flex w-full items-center justify-center gap-2 pl-7 text-[12px]">
        {new Set(region.traces.map((t) => t.x)).size === 1 ? (
          <span>{region.traces[0]?.x ? <StaticMath ml={ml} latex={region.traces[0].x} /> : "x"}</span>
        ) : (
          region.traces.map((t, i) => (
            <span key={i} style={{ color: COLORS[i % COLORS.length] }}>
              {t.x ? <StaticMath ml={ml} latex={t.x} /> : "x"}
            </span>
          ))
        )}
        {units?.xUnit && <span className="text-neutral-500">({units.xUnit.replace(/inch/g, "in")})</span>}
      </div>
      {traces.some((t) => t.error) && <div className="text-[11px] text-red-600">{traces.find((t) => t.error)!.error}</div>}
      {editing && (
        <div className="no-print mt-1 grid w-full gap-1 rounded border bg-neutral-50 p-1.5 text-[11px]">
          {region.traces.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              y
              <MathInput ml={ml} value={t.y} active focus={focus === `y${i}`} placeholder="y" onCommit={(y) => setTrace(i, { y })} onEnter={() => setFocus(`x${i}`)} />
              against x
              <MathInput ml={ml} value={t.x} active focus={focus === `x${i}`} placeholder="x" onCommit={(x) => setTrace(i, { x })} onEnter={() => setFocus(null)} />
              {region.traces.length > 1 && (
                <button
                  type="button"
                  title="Remove the trace"
                  onClick={() =>
                    onChange((p) => ({
                      ...p,
                      traces: p.traces.filter((_, j) => j !== i),
                    }))
                  }
                  className="text-neutral-400 hover:text-neutral-700"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onChange((p) => ({
                  ...p,
                  traces: [...p.traces, { x: p.traces[0]?.x ?? "", y: "" }],
                }));
                setFocus(`y${region.traces.length}`);
              }}
              className="flex items-center gap-1 rounded px-1 text-neutral-600 hover:bg-neutral-200"
            >
              <Plus className="size-3" /> Trace
            </button>
            <UnitField label="x unit" value={region.xUnit ?? ""} onCommit={(xUnit) => onChange((p) => ({ ...p, xUnit: xUnit || undefined }))} />
            <UnitField label="y unit" value={region.yUnit ?? ""} onCommit={(yUnit) => onChange((p) => ({ ...p, yUnit: yUnit || undefined }))} />
          </div>
        </div>
      )}
    </div>
  );
}

function UnitField({ label: text, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <label className="flex items-center gap-1">
      {text}
      <input value={v} placeholder="auto" onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v.trim())} className="h-5 w-14 rounded border bg-white px-1 font-mono outline-none" />
    </label>
  );
}

// --- solve blocks --------------------------------------------------------------------------------

export function SolveRegionView({ ml, region, result, editing, selected, onChange }: { ml: MathLive | null; region: SolveRegion; result: Result | undefined; editing: boolean; selected: boolean; onChange: Change<SolveRegion> }) {
  const r = result?.kind === "solve" ? result : null;
  // The line with the focus: a new block starts at its first guess; Enter goes to the next line.
  const [focus, setFocus] = useState<string | null>(() => (region.guesses.some((g) => g) ? null : "guesses0"));
  const next = (key: "guesses" | "constraints", i: number, line: string) => {
    const last = i === region[key].length - 1;
    // Enter on a blank last line goes on to the next section.
    if (last && !line.trim()) return setFocus(key === "guesses" ? "constraints0" : "solver");
    if (last) onChange((s) => ({ ...s, [key]: [...s[key], ""] }));
    setFocus(`${key}${i + 1}`);
  };
  const section = (title: string, key: "guesses" | "constraints") => (
    <div className="border-b border-neutral-300 px-2 py-1 last:border-b-0">
      <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">{title}</div>
      {region[key].map((line, i) =>
        !editing && !line.trim() ? null : (
          <div key={i} className="flex items-center py-0.5 text-[15px]">
            <MathInput
              ml={ml}
              value={line}
              active={editing}
              focus={editing && focus === `${key}${i}`}
              placeholder={key === "guesses" ? "x := 1" : "x + y = 3"}
              onCommit={(latex) =>
                onChange((s) => ({
                  ...s,
                  [key]: s[key].map((x, j) => (j === i ? latex : x)),
                }))
              }
              onEnter={(line) => next(key, i, line)}
            />
            <LineError result={r?.[key][i]} />
            {editing && region[key].length > 1 && (
              <button
                type="button"
                title="Remove the line"
                onClick={() =>
                  onChange((s) => ({
                    ...s,
                    [key]: s[key].filter((_, j) => j !== i),
                  }))
                }
                className="no-print ml-1 text-neutral-400 hover:text-neutral-700"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ),
      )}
      {editing && (
        <button type="button" onClick={() => onChange((s) => ({ ...s, [key]: [...s[key], ""] }))} className="no-print flex items-center gap-1 rounded px-1 text-[11px] text-neutral-500 hover:bg-neutral-100">
          <Plus className="size-3" /> Line
        </button>
      )}
    </div>
  );
  const solved = r?.solver.kind === "ok" ? r.solver.result : undefined;
  return (
    <div className={cn("inline-block min-w-56 rounded border border-neutral-400 bg-white", selected && !editing && "ring-1 ring-primary", r?.solver.kind === "error" && !r.solver.incomplete && "ring-1 ring-red-500")}>
      {section("Guess values", "guesses")}
      {section("Constraints", "constraints")}
      <div className="px-2 py-1">
        <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Solver</div>
        <div className="flex items-center gap-1 text-[15px]">
          <MathInput ml={ml} value={region.solver} active={editing} focus={editing && focus === "solver"} placeholder="x := find(x)" onCommit={(solver) => onChange((s) => ({ ...s, solver }))} />
          {solved && <StaticMath ml={ml} latex={solved} />}
          <LineError result={r?.solver} />
        </div>
      </div>
    </div>
  );
}
