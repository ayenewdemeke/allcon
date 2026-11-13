"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownUp, ArrowLeft, Box, ClipboardList, EyeOff, GitCompareArrows, Loader2, MoveVertical, Spline, Table2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { renameBridge } from "@/app/actions/bridge";
import { DesignErrorCard, fmt } from "@/components/design/design-kit";
import { LinkButton } from "@/components/ui/link-button";
import { compareBeamForces, FORCE_NAMES, FORCE_UNITS, LENGTH_UNITS } from "@/lib/bridge/compare";
import type { ImportedInfo } from "@/lib/bridge/imported";
import type { Dof6, Model } from "@/lib/bridge/model";
import { modelSolids } from "@/lib/bridge/solids";
import { analyze, localAxes, type Analysis } from "@/lib/bridge/solver";
import { cn } from "@/lib/utils";
import { BridgeView, type BridgeViewHandle, type Overlay, type ViewName } from "./bridge-view";

// An imported analysis model (a midas MCT file) in the Bridge workspace: analyzed by allcon's
// solver as it is, its results drawn on it and tabulated, and another program's beam forces
// pasted in beside them to compare.

type Show = "none" | "deformed" | "My" | "Vz" | "N";
type Table = "forces" | "reactions" | "report" | "compare";
const SHOW = { My: { label: "Moment", unit: "kip·ft", color: 0x1b76bb }, Vz: { label: "Shear", unit: "kip", color: 0xb45309 }, N: { label: "Axial force", unit: "kip", color: 0x475569 } } as const;

function Big({ icon: Icon, label, onClick, active }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-16 flex-col items-center gap-0.5 rounded px-1 py-1 text-center text-[11px] leading-tight hover:bg-accent", active && "bg-accent text-primary")}>
      <Icon className="size-6 shrink-0" />
      <span className="line-clamp-2">{label}</span>
    </button>
  );
}
const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex flex-col border-r px-2 last:border-r-0">
    <div className="flex flex-1 items-start gap-1 pt-1">{children}</div>
    <div className="pb-0.5 text-center text-[10px] text-muted-foreground">{title}</div>
  </div>
);

export function ImportedWorkspace({ bridge, info }: { bridge: { id: string; name: string }; info: ImportedInfo }) {
  const [name, setName] = useState(bridge.name);
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caseIndex, setCaseIndex] = useState(0);
  const [show, setShow] = useState<Show>("My");
  const [table, setTable] = useState<Table | null>("report");
  const [picked, setPicked] = useState<number | null>(null);
  const [pasted, setPasted] = useState("");
  const [units, setUnits] = useState({ force: info.report.units.force, length: info.report.units.length });
  const view = useRef<BridgeViewHandle>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/bridges/${bridge.id}/model`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not open the model (${r.status})`))))
      .then((m: Model) => live && setModel(m))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [bridge.id]);
  const outcome = useMemo((): { a: Analysis | null; error: string | null } => {
    if (!model) return { a: null, error: null };
    try {
      return { a: analyze(model), error: null };
    } catch (e) {
      return { a: null, error: e instanceof Error ? e.message : "The model could not be analyzed." };
    }
  }, [model]);
  const a = outcome.a;
  const c = a?.cases[caseIndex];

  const displacements = useMemo(() => (a && c && show === "deformed" ? new Map<number, Dof6<number>>(a.model.nodes.map((n, i) => [n.id, c.displacements[i]])) : null), [a, c, show]);
  const diagram = useMemo((): { overlay: Overlay; max: { v: number; el: number }; min: { v: number; el: number } } | null => {
    if (!a || !model || show === "none" || show === "deformed") return null;
    const at = new Map(model.nodes.map((n) => [n.id, n]));
    const rows = model.elements.map((e, k) => ({ e, v: [0, 0.5, 1].map((t) => a.forcesAt(caseIndex, k, t)[show]) }));
    let peak = 0;
    let max = { v: -Infinity, el: 0 };
    let min = { v: Infinity, el: 0 };
    for (const r of rows)
      for (const v of r.v) {
        peak = Math.max(peak, Math.abs(v));
        if (v > max.v) max = { v, el: r.e.id };
        if (v < min.v) min = { v, el: r.e.id };
      }
    if (!(peak > 1e-9)) return null;
    let lo = Infinity, hi = -Infinity;
    for (const n of model.nodes) {
      lo = Math.min(lo, n.x, n.y, n.z);
      hi = Math.max(hi, n.x, n.y, n.z);
    }
    const f = (0.08 * Math.max(hi - lo, 1)) / peak;
    const outline: number[] = [];
    const hatch: number[] = [];
    for (const { e, v } of rows) {
      const A = at.get(e.n1)!;
      const B = at.get(e.n2)!;
      const z = localAxes([A.x, A.y, A.z], [B.x, B.y, B.z], e.angle).R[2];
      const sign = show === "My" ? -1 : 1;
      const p = (t: number, val: number) => [A.x + t * (B.x - A.x) + sign * z[0] * val * f, A.y + t * (B.y - A.y) + sign * z[1] * val * f, A.z + t * (B.z - A.z) + sign * z[2] * val * f];
      outline.push(...p(0, v[0]), ...p(0.5, v[1]), ...p(0.5, v[1]), ...p(1, v[2]));
      hatch.push(A.x, A.y, A.z, ...p(0, v[0]), B.x, B.y, B.z, ...p(1, v[2]));
    }
    return { overlay: { outline: new Float32Array(outline), hatch: new Float32Array(hatch), color: SHOW[show].color }, max, min };
  }, [a, model, show, caseIndex]);
  const solids = useMemo(() => (model ? modelSolids(model) : []), [model]);
  const [solid, setSolid] = useState(true);
  const comparison = useMemo(() => (a && model && pasted.trim() ? compareBeamForces(model, a, pasted, units) : null), [a, model, pasted, units]);
  const selected = useMemo(() => new Set(picked === null ? [] : [picked]), [picked]);
  const elementRows = useMemo(() => {
    if (!a || !model) return [];
    const list = picked === null ? model.elements.slice(0, 300) : model.elements.filter((e) => e.id === picked);
    return list.flatMap((e) => {
      const k = model.elements.indexOf(e);
      return (["I", "J"] as const).map((part, j) => ({ id: e.id, part, f: a.forcesAt(caseIndex, k, j) }));
    });
  }, [a, model, picked, caseIndex]);

  if (error) return <div className="p-8"><DesignErrorCard message={error} /></div>;
  if (!model)
    return (
      <div className="fixed inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Opening {bridge.name}…
      </div>
    );
  const th = "px-2 py-1 text-right font-medium";
  const td = "px-2 py-0.5 text-right";
  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <div className="border-b bg-muted/40">
        <div className="flex items-center gap-1 px-2 pt-1 pb-0.5 text-xs">
          <LinkButton href="/bridges" variant="ghost" size="icon-xs" aria-label="Back to bridges" title="Back to bridges">
            <ArrowLeft />
          </LinkButton>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== bridge.name && renameBridge(bridge.id, name).catch(() => toast.error("Could not rename the bridge"))} className="w-56 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:border-input focus:border-input" aria-label="Bridge name" />
          <span className="text-muted-foreground">Imported from {info.source}</span>
        </div>
        <div className="flex h-[4.75rem] overflow-x-auto bg-background">
          <Group title="Load case">
            <select value={caseIndex} onChange={(e) => setCaseIndex(+e.target.value)} className="mt-1 h-7 w-48 rounded border bg-background px-1 text-[11px]" aria-label="Load case">
              {model.loadCases.map((lc, k) => (
                <option key={lc.name} value={k}>
                  {lc.name} ({lc.type})
                </option>
              ))}
            </select>
          </Group>
          <Group title="On the model">
            <Big icon={Spline} label="Moment" onClick={() => setShow("My")} active={show === "My"} />
            <Big icon={Activity} label="Shear" onClick={() => setShow("Vz")} active={show === "Vz"} />
            <Big icon={ArrowDownUp} label="Axial" onClick={() => setShow("N")} active={show === "N"} />
            <Big icon={MoveVertical} label="Deformed shape" onClick={() => setShow("deformed")} active={show === "deformed"} />
            <Big icon={EyeOff} label="None" onClick={() => setShow("none")} active={show === "none"} />
          </Group>
          <Group title="Tables">
            <Big icon={Table2} label="Member forces" onClick={() => setTable("forces")} active={table === "forces"} />
            <Big icon={ClipboardList} label="Reactions" onClick={() => setTable("reactions")} active={table === "reactions"} />
            <Big icon={GitCompareArrows} label="Compare" onClick={() => setTable("compare")} active={table === "compare"} />
            <Big icon={TriangleAlert} label="Import report" onClick={() => setTable("report")} active={table === "report"} />
          </Group>
          <Group title="View">
            <Big icon={Box} label={solid ? "Wireframe" : "Solid"} onClick={() => setSolid((v) => !v)} />
            {(["iso", "top", "front", "side"] as ViewName[]).map((v) => (
              <Big key={v} icon={Box} label={v[0].toUpperCase() + v.slice(1)} onClick={() => view.current?.view(v)} />
            ))}
          </Group>
        </div>
      </div>

      <main className="relative min-h-0 flex-1 bg-slate-50 dark:bg-slate-900">
        {a ? <BridgeView ref={view} model={model} plain solids={solids} mode={solid ? "solid" : "wire"} displacements={displacements} overlay={diagram?.overlay ?? null} selected={selected} onPick={(id) => (setPicked(id), id !== null && setTable("forces"))} className="absolute inset-0" /> : <div className="p-6"><DesignErrorCard message={outcome.error ?? "The model could not be analyzed."} /></div>}
        {a && (
          <div className="pointer-events-none absolute top-2 left-3 space-y-0.5 text-[11px]">
            <p className="font-semibold">
              {show === "none" ? "Model" : show === "deformed" ? "Deformed shape (exaggerated)" : `${SHOW[show].label} (${SHOW[show].unit})`}
              <span className="font-normal text-muted-foreground"> · {model.loadCases[caseIndex]?.name}</span>
            </p>
            {diagram && (
              <p className="tabular-nums text-muted-foreground">
                Max {fmt(diagram.max.v, 1)} in element {diagram.max.el} · Min {fmt(diagram.min.v, 1)} in element {diagram.min.el}
              </p>
            )}
          </div>
        )}
      </main>

      {table && a && c && (
        <div className="flex h-[42%] min-h-48 shrink-0 flex-col border-t">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1 text-xs">
            <span className="font-medium">{table === "forces" ? "Member forces" : table === "reactions" ? "Reactions" : table === "compare" ? "Compare with another program" : "Import report"}</span>
            {table === "forces" && picked !== null && (
              <button type="button" onClick={() => setPicked(null)} className="rounded border px-1.5 hover:bg-accent">
                Element {picked} · show all
              </button>
            )}
            <button type="button" onClick={() => setTable(null)} className="ml-auto rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
            {table === "forces" && (
              <>
                <table className="w-full tabular-nums">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 pr-2 text-left font-medium">Element</th>
                      <th className="px-2 text-left font-medium">End</th>
                      {["Axial (kip)", "Shear y (kip)", "Shear z (kip)", "Torsion (kip·ft)", "Moment y (kip·ft)", "Moment z (kip·ft)"].map((h) => (
                        <th key={h} className={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {elementRows.map((r) => (
                      <tr key={`${r.id}${r.part}`} className="border-b border-border/40">
                        <td className="py-0.5 pr-2">{r.id}</td>
                        <td className="px-2">{r.part}</td>
                        {[r.f.N, r.f.Vy, r.f.Vz, r.f.T, r.f.My, r.f.Mz].map((v, k) => (
                          <td key={k} className={td}>
                            {fmt(v, 2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {picked === null && model.elements.length > 300 && <p className="pt-1 text-muted-foreground">The first 300 elements. Click a member in the model for its forces.</p>}
              </>
            )}
            {table === "reactions" && (
              <>
                <table className="w-full tabular-nums">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 pr-2 text-left font-medium">Node</th>
                      {["Fx (kip)", "Fy (kip)", "Fz (kip)", "Mx (kip·ft)", "My (kip·ft)", "Mz (kip·ft)"].map((h) => (
                        <th key={h} className={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {c.reactions.map((r) => (
                      <tr key={r.node} className="border-b border-border/40">
                        <td className="py-0.5 pr-2">{r.node}</td>
                        {r.R.map((v, k) => (
                          <td key={k} className={td}>
                            {fmt(v, 2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="pt-1 text-muted-foreground">
                  Applied {fmt(-c.equilibrium.applied[2], 2)} kip down; reactions {fmt(c.equilibrium.reactions[2], 2)} kip up.
                </p>
              </>
            )}
            {table === "report" && (
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-1">
                  <p className="font-semibold">Read from the file ({info.report.units.force}, {info.report.units.length}; kept in kip and ft)</p>
                  {Object.entries(info.report.read).map(([k, v]) => (
                    <p key={k} className="flex justify-between border-b border-border/40 py-0.5">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="tabular-nums">{v}</span>
                    </p>
                  ))}
                  {info.report.notRead.length > 0 && <p className="pt-1 text-muted-foreground">Commands in the file that aren&apos;t read: {info.report.notRead.join(", ")}.</p>}
                </div>
                <div className="space-y-1">
                  <p className="font-semibold">{info.report.warnings.length ? "To check" : "Nothing was assumed"}</p>
                  {info.report.warnings.map((w) => (
                    <p key={w} className="flex gap-1.5">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0 text-amber-600" /> {w}
                    </p>
                  ))}
                  {a.held.length > 0 && <p className="text-muted-foreground">{a.held.length} degrees of freedom with nothing attached were held (a truss node&apos;s rotations, for example).</p>}
                </div>
              </div>
            )}
            {table === "compare" && (
              <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
                <div className="space-y-2">
                  <p className="text-muted-foreground">Paste the other program&apos;s beam forces: from midas Civil, Results &gt; Result Tables &gt; Beam &gt; Force, copied with its header. Columns: element, load, part (I or J), axial, shear y, shear z, torsion, moment y, moment z.</p>
                  <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={"Elem\tLoad\tPart\tAxial\tShear-y\tShear-z\tTorsion\tMoment-y\tMoment-z"} className="h-32 w-full rounded border bg-background p-2 font-mono text-[11px]" aria-label="Pasted beam forces" />
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Its units</span>
                    <select value={units.force} onChange={(e) => setUnits((u) => ({ ...u, force: e.target.value }))} className="h-7 rounded border bg-background px-1" aria-label="Force unit">
                      {FORCE_UNITS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                    <select value={units.length} onChange={(e) => setUnits((u) => ({ ...u, length: e.target.value }))} className="h-7 rounded border bg-background px-1" aria-label="Length unit">
                      {LENGTH_UNITS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  {!comparison ? (
                    <p className="text-muted-foreground">The two sets of forces appear here side by side, in kip and ft, with their differences.</p>
                  ) : comparison.rows.length === 0 ? (
                    <p className="text-amber-700">No row matched an element and load case of this model ({comparison.unmatched} rows read). Check the load case names and the columns.</p>
                  ) : (
                    <>
                      <p className="pb-1">
                        <span className="font-semibold">{Math.round(comparison.within * 100)}% of the values agree within 2%</span> of each force&apos;s largest value ({comparison.rows.length} rows matched{comparison.unmatched ? `, ${comparison.unmatched} not in this model` : ""}). Compared by magnitude: the two
                        programs&apos; sign conventions differ.
                      </p>
                      <table className="w-full tabular-nums">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="py-1 pr-2 text-left font-medium">Largest difference</th>
                            {FORCE_NAMES.map((n) => (
                              <th key={n} className={th}>
                                {n}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-border/40">
                            <td className="py-0.5 pr-2">allcon − other (kip, kip·ft)</td>
                            {comparison.worst.map((w) => (
                              <td key={w.name} className={td}>
                                {fmt(w.diff, 2)}
                              </td>
                            ))}
                          </tr>
                          <tr className="border-b border-border/40">
                            <td className="py-0.5 pr-2">of the largest value</td>
                            {comparison.worst.map((w) => (
                              <td key={w.name} className={cn(td, w.percent > 2 ? "font-medium text-red-600" : "text-emerald-600")}>
                                {w.percent.toFixed(1)}%
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                      <table className="mt-3 w-full tabular-nums">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="py-1 pr-2 text-left font-medium">Element</th>
                            <th className="px-2 text-left font-medium">Load</th>
                            <th className="px-2 text-left font-medium">End</th>
                            <th className="px-2 text-left font-medium" />
                            {FORCE_NAMES.map((n) => (
                              <th key={n} className={th}>
                                {n}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {comparison.rows.slice(0, 200).flatMap((r, k) => [
                            <tr key={`${k}a`}>
                              <td className="pt-0.5 pr-2">{r.element}</td>
                              <td className="px-2">{r.load}</td>
                              <td className="px-2">{r.part}</td>
                              <td className="px-2 text-muted-foreground">allcon</td>
                              {r.ours.map((v, j) => (
                                <td key={j} className={td}>
                                  {fmt(Math.abs(v), 2)}
                                </td>
                              ))}
                            </tr>,
                            <tr key={`${k}b`} className="border-b border-border/40">
                              <td colSpan={3} />
                              <td className="px-2 text-muted-foreground">other</td>
                              {r.theirs.map((v, j) => (
                                <td key={j} className={td}>
                                  {fmt(Math.abs(v), 2)}
                                </td>
                              ))}
                            </tr>,
                          ])}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-muted/40 px-3 text-[11px] text-muted-foreground">
        <span>kip, ft</span>
        <span>
          {model.nodes.length} nodes · {model.elements.length} elements · {model.loadCases.length} load cases
        </span>
        {c && <span>{Math.abs(c.equilibrium.applied[2] + c.equilibrium.reactions[2]) < 1e-6 * Math.max(1, Math.abs(c.equilibrium.applied[2])) ? "Equilibrium OK" : "Not in equilibrium"}</span>}
        {info.report.warnings.length > 0 && (
          <button type="button" onClick={() => setTable("report")} className="text-amber-700 hover:underline">
            {info.report.warnings.length} import notes
          </button>
        )}
        <span className="ml-auto flex items-center gap-1" title="The Bridge section is new: check its results independently. The compare table is one way.">
          <TriangleAlert className="size-3 text-amber-600" />
          Not verified: check independently
        </span>
      </div>
    </div>
  );
}
