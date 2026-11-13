"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, Anchor, ArrowDownUp, ArrowLeft, Box, Check, ChevronDown, ChevronRight, ClipboardCheck, Columns3, EyeOff, Grid3x3, Layers, Loader2, MoveVertical, PanelBottom, Play, Ruler, Spline, Table2, TriangleAlert, Truck, Weight } from "lucide-react";
import { toast } from "sonner";
import { renameBridge, saveBridgeDefinition, setBridgeProject } from "@/app/actions/bridge";
import { DesignErrorCard, fmt } from "@/components/design/design-kit";
import { LinkButton } from "@/components/ui/link-button";
import { analyzeBridge, type BridgeAnalysis, type Selection } from "@/lib/bridge/bridge";
import type { BridgeDefinition } from "@/lib/bridge/definition";
import type { Member } from "@/lib/bridge/generate";
import { movingLoadSteps, type LiveLoad } from "@/lib/bridge/moving";
import { cn } from "@/lib/utils";
import { BridgeForm, FORM_TITLES, type FormKey } from "./bridge-forms";
import { ChecksPanel, MemberPanel, ReactionsPanel } from "./bridge-results";
import { BridgeView, type BridgeViewHandle, type Overlay, type ViewName } from "./bridge-view";

// The Bridge workspace, full screen, laid out as midas Civil is: a ribbon of tabs in the order
// the work goes (structure, boundary, load, analysis, results, view), the model's tree on the
// left, the 3D model as the canvas with results drawn on it, the selected item's properties on
// the right, the result tables below, and a status bar. The model is re-analyzed as its inputs
// change; the moving load analysis follows a moment later.

type Tab = "structure" | "boundary" | "load" | "analysis" | "results" | "view";
type Show = "none" | "deformed" | "My" | "Vz" | "N";
type Table = "member" | "reactions" | "checks";
type Save = "saved" | "saving" | "unsaved" | "error";

const SHOW: Record<Exclude<Show, "none" | "deformed">, { label: string; unit: string; color: number }> = {
  My: { label: "Moment", unit: "kip·ft", color: 0x1b76bb },
  Vz: { label: "Shear", unit: "kip", color: 0xb45309 },
  N: { label: "Axial force", unit: "kip", color: 0x475569 },
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col border-r px-2 last:border-r-0">
      <div className="flex flex-1 items-start gap-1 pt-1">{children}</div>
      <div className="pb-0.5 text-center text-[10px] text-muted-foreground">{title}</div>
    </div>
  );
}
function Big({ icon: Icon, label, title, onClick, active, disabled }: { icon: React.ComponentType<{ className?: string }>; label: string; title?: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button type="button" title={title ?? label} onClick={onClick} disabled={disabled} className={cn("flex w-16 flex-col items-center gap-0.5 rounded px-1 py-1 text-center text-[11px] leading-tight hover:bg-accent disabled:opacity-40", active && "bg-accent text-primary")}>
      <Icon className="size-6 shrink-0" />
      <span className="line-clamp-2">{label}</span>
    </button>
  );
}

const selectionOf = (key: string): Selection => {
  if (key === "live") return { kind: "live" };
  const [kind, ...rest] = key.split(":");
  return { kind: kind === "case" ? "case" : "combination", name: rest.join(":") };
};

export function BridgeWorkspace({ bridge, projects }: { bridge: { id: string; name: string; projectId: string | null; definition: BridgeDefinition }; projects: { id: string; name: string }[] }) {
  const [def, setDefState] = useState(bridge.definition);
  const [name, setName] = useState(bridge.name);
  const [projectId, setProjectId] = useState(bridge.projectId);
  const [save, setSave] = useState<Save>("saved");
  const [tab, setTab] = useState<Tab>("structure");
  const [form, setForm] = useState<FormKey | null>("layout");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [selKey, setSelKey] = useState("combination:Strength I");
  const [show, setShow] = useState<Show>("My");
  const [table, setTable] = useState<Table | null>(null);
  const view = useRef<BridgeViewHandle>(null);
  const setDef = (update: (d: BridgeDefinition) => BridgeDefinition) => setDefState(update);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave("unsaved");
    const timer = setTimeout(() => {
      setSave("saving");
      saveBridgeDefinition(bridge.id, def)
        .then(() => setSave("saved"))
        .catch(() => setSave("error"));
    }, 700);
    return () => clearTimeout(timer);
  }, [def, bridge.id]);

  // The static analysis follows the inputs a beat behind, so typing stays quick.
  const current = useDeferredValue(def);
  const outcome = useMemo((): { analysis: BridgeAnalysis | null; error: string | null } => {
    try {
      return { analysis: analyzeBridge(current), error: null };
    } catch (e) {
      return { analysis: null, error: e instanceof Error ? e.message : "The bridge could not be analyzed." };
    }
  }, [current]);
  const a = outcome.analysis;

  // The moving load analysis: started once the inputs rest, run in slices so the page keeps responding.
  const [moving, setMoving] = useState<{ for: BridgeAnalysis | null; live: LiveLoad | null; progress: number; error: string | null }>({ for: null, live: null, progress: 0, error: null });
  const [rerun, setRerun] = useState(0);
  useEffect(() => {
    if (!a) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const start = () => {
      const steps = movingLoadSteps(a.generated, a.stage(2));
      setMoving({ for: a, live: null, progress: 0.01, error: null });
      const slice = () => {
        if (cancelled) return;
        try {
          const until = performance.now() + 30;
          for (;;) {
            const r = steps.next();
            if (r.done) return setMoving({ for: a, live: r.value, progress: 1, error: null });
            if (performance.now() > until) {
              setMoving((m) => (m.for === a ? { ...m, progress: r.value } : m));
              break;
            }
          }
          timer = setTimeout(slice, 0);
        } catch (e) {
          setMoving({ for: a, live: null, progress: 0, error: e instanceof Error ? e.message : "The moving load analysis failed." });
        }
      };
      slice();
    };
    timer = setTimeout(start, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [a, rerun]);
  const live = moving.for === a ? moving.live : null;

  const sel = useMemo(() => selectionOf(selKey), [selKey]);
  const members = useMemo(() => a?.generated.members ?? [], [a]);
  const member = members.find((m) => m.id === memberId) ?? null;
  const selected = useMemo(() => new Set(member?.elements ?? []), [member]);
  const displacements = useMemo(() => (a && show === "deformed" && sel.kind !== "live" ? a.displacements(sel) : null), [a, sel, show]);

  // The diagram on the model: each member's line of values off its axis (moments on the tension
  // side, so sagging hangs below), hatched back to the member; an envelope's two lines with live load.
  const diagram = useMemo((): { overlay: Overlay; max: { v: number; where: string }; min: { v: number; where: string } } | null => {
    if (!a || show === "none" || show === "deformed") return null;
    const total = a.generated.stations[a.generated.stations.length - 1];
    const rows = members.map((m) => ({ m, st: a.member(m, sel, 2, live) }));
    let peak = 0;
    let max = { v: -Infinity, where: "" };
    let min = { v: Infinity, where: "" };
    for (const { m, st } of rows)
      for (const s of st) {
        const hi = s.max ? s.max[show] : s.forces[show];
        const lo = s.min ? s.min[show] : s.forces[show];
        peak = Math.max(peak, Math.abs(hi), Math.abs(lo));
        if (hi > max.v) max = { v: hi, where: `${m.name}, ${fmt(s.x, 1)} ft` };
        if (lo < min.v) min = { v: lo, where: `${m.name}, ${fmt(s.x, 1)} ft` };
      }
    if (!(peak > 1e-9)) return null;
    const height = Math.min(40, Math.max(6, total * 0.08));
    const f = height / peak;
    const outline: number[] = [];
    const hatch: number[] = [];
    for (const { m, st } of rows) {
      const sign = show === "My" ? -1 : 1;
      const dir = m.kind === "column" ? [sign, 0, 0] : [0, 0, sign];
      const point = (k: number, v: number) => [st[k].p[0] + dir[0] * v * f, st[k].p[1] + dir[1] * v * f, st[k].p[2] + dir[2] * v * f];
      const series = st[0]?.max ? [st.map((s) => s.max![show]), st.map((s) => s.min![show])] : [st.map((s) => s.forces[show])];
      for (const values of series)
        for (let k = 0; k < st.length; k++) {
          if (k > 0 && st[k].x > st[k - 1].x) outline.push(...point(k - 1, values[k - 1]), ...point(k, values[k]));
          if (k % 2 === 0) hatch.push(...st[k].p, ...point(k, values[k]));
        }
    }
    return { overlay: { outline: new Float32Array(outline), hatch: new Float32Array(hatch), color: SHOW[show].color }, max, min };
  }, [a, members, sel, show, live]);

  const pickMember = (id: string | null) => {
    setMemberId(id);
    if (id) {
      setForm(null);
      setTable((t) => t ?? "member");
    }
  };
  const openForm = (f: FormKey) => {
    setForm(f);
    setMemberId(null);
  };
  const lanes = live?.arrangements[0].length ?? 0;
  const selectionLabel = sel.kind === "live" ? "LL+IM (HL-93)" : sel.name;

  const selectionPicker = a && (
    <select value={selKey} onChange={(e) => setSelKey(e.target.value)} className="h-7 w-56 rounded border bg-background px-1 text-[11px]" aria-label="Load case or combination">
      <optgroup label="Combinations">
        {a.combinations.map((c) => (
          <option key={c.name} value={`combination:${c.name}`}>
            {c.name}: {c.description}
          </option>
        ))}
      </optgroup>
      <optgroup label="Load cases">
        {a.cases.map((c) => (
          <option key={c.name} value={`case:${c.name}`}>
            {c.name} ({c.type})
          </option>
        ))}
        <option value="live">LL+IM (HL-93), envelope</option>
      </optgroup>
    </select>
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      {/* Ribbon */}
      <div className="border-b bg-muted/40">
        <div className="flex items-end gap-0.5 px-2 pt-1 text-xs">
          <div className="mr-2 flex items-center gap-1 self-center pb-0.5">
            <LinkButton href="/bridges" variant="ghost" size="icon-xs" aria-label="Back to bridges" title="Back to bridges">
              <ArrowLeft />
            </LinkButton>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== bridge.name && renameBridge(bridge.id, name).catch(() => toast.error("Could not rename the bridge"))}
              className="w-44 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:border-input focus:border-input"
              aria-label="Bridge name"
            />
          </div>
          {(
            [
              ["structure", "Structure"],
              ["boundary", "Boundary"],
              ["load", "Load"],
              ["analysis", "Analysis"],
              ["results", "Results"],
              ["view", "View"],
            ] as const
          ).map(([t, label]) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-t px-3 py-1", tab === t ? "bg-background font-medium text-foreground shadow-[0_-1px_0_0] shadow-border" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 self-center pb-0.5">
            {projects.length > 0 && (
              <select
                value={projectId ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setProjectId(id);
                  setBridgeProject(bridge.id, id).catch(() => toast.error("Could not file the bridge under that project"));
                }}
                className="h-6 rounded border bg-background px-1 text-[11px]"
                aria-label="Project"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <span className="flex items-center gap-1 text-muted-foreground" title={save === "saved" ? "All changes saved" : save === "error" ? "Not saved" : "Saving"}>
              {save === "saved" ? <Check className="size-3.5" /> : save === "error" ? <AlertCircle className="size-3.5 text-destructive" /> : <Loader2 className="size-3.5 animate-spin" />}
              {save === "saved" ? "Saved" : save === "error" ? "Not saved" : "Saving"}
            </span>
          </div>
        </div>
        <div className="flex h-[4.75rem] overflow-x-auto bg-background">
          {tab === "structure" && (
            <>
              <Panel title="Bridge">
                <Big icon={Ruler} label="Layout" title="Spans, skew, continuity" onClick={() => openForm("layout")} active={form === "layout"} />
                <Big icon={Layers} label="Girders and deck" onClick={() => openForm("girders")} active={form === "girders"} />
                <Big icon={Grid3x3} label="Diaphragms" onClick={() => openForm("diaphragms")} active={form === "diaphragms"} />
              </Panel>
              <Panel title="Model">
                <div className="w-64 pt-1 text-[11px] leading-snug text-muted-foreground">
                  {a ? `${a.generated.stage2.nodes.length} nodes, ${a.generated.stage2.elements.length} elements, generated from these inputs as a grillage: girders, deck strips, diaphragms, bearings and piers.` : "The model is generated from these inputs."}
                </div>
              </Panel>
            </>
          )}
          {tab === "boundary" && (
            <Panel title="Supports">
              <Big icon={Anchor} label="Bearings" title="Fixed or expansion at each support line" onClick={() => openForm("bearings")} active={form === "bearings"} />
              <Big icon={Columns3} label="Piers" title="Caps and columns" onClick={() => openForm("piers")} active={form === "piers"} />
            </Panel>
          )}
          {tab === "load" && (
            <>
              <Panel title="Static loads">
                <Big icon={Weight} label="Dead loads" title="Barriers, wearing surface" onClick={() => openForm("loads")} active={form === "loads"} />
              </Panel>
              <Panel title="Moving load">
                <Big icon={Truck} label="HL-93" title="AASHTO LRFD 3.6.1: truck or tandem with the lane load" onClick={() => setTable("checks")} />
                <div className="w-72 pt-1 text-[11px] leading-snug text-muted-foreground">
                  {live ? `${lanes} design lane${lanes === 1 ? "" : "s"} between the barriers, tried against either barrier and centered; truck or tandem with 33% dynamic allowance, plus the lane load.` : "Design lanes are laid out between the barriers once the analysis runs."}
                </div>
              </Panel>
            </>
          )}
          {tab === "analysis" && (
            <>
              <Panel title="Perform">
                <Big icon={Play} label="Run moving load" title="The static analysis runs as you type; this runs the moving load analysis again" onClick={() => setRerun((n) => n + 1)} disabled={!a} />
                <Big icon={ClipboardCheck} label="Checks" title="Equilibrium of every load case, and the section properties used" onClick={() => setTable("checks")} active={table === "checks"} />
              </Panel>
              <Panel title="Status">
                <div className="w-72 pt-1 text-[11px] leading-snug text-muted-foreground">
                  {outcome.error ? outcome.error : a?.ok ? "Static analysis: every load case in equilibrium." : "Static analysis: a load case is not in equilibrium."}{" "}
                  {moving.error ? moving.error : live ? "Moving load: done." : a ? `Moving load: ${Math.round(moving.progress * 100)}%.` : ""}
                </div>
              </Panel>
            </>
          )}
          {tab === "results" && (
            <>
              <Panel title="Load">
                <div className="flex flex-col gap-1 pt-1">
                  {selectionPicker}
                  <span className="text-[10px] text-muted-foreground">{live ? "Combinations include live load as an envelope." : "Live load joins the combinations when its analysis finishes."}</span>
                </div>
              </Panel>
              <Panel title="On the model">
                <Big icon={Spline} label="Moment" onClick={() => setShow("My")} active={show === "My"} />
                <Big icon={Activity} label="Shear" onClick={() => setShow("Vz")} active={show === "Vz"} />
                <Big icon={ArrowDownUp} label="Axial" onClick={() => setShow("N")} active={show === "N"} />
                <Big icon={MoveVertical} label="Deformed shape" title="Permanent loads, exaggerated" onClick={() => setShow("deformed")} active={show === "deformed"} />
                <Big icon={EyeOff} label="None" onClick={() => setShow("none")} active={show === "none"} />
              </Panel>
              <Panel title="Tables">
                <Big icon={Table2} label="Member" title="The selected member's diagrams and forces" onClick={() => setTable("member")} active={table === "member"} />
                <Big icon={Anchor} label="Reactions" onClick={() => setTable("reactions")} active={table === "reactions"} />
                <Big icon={PanelBottom} label="Hide" onClick={() => setTable(null)} disabled={!table} />
              </Panel>
            </>
          )}
          {tab === "view" && (
            <Panel title="View">
              {(
                [
                  ["iso", "Iso"],
                  ["top", "Top"],
                  ["front", "Front"],
                  ["side", "Side"],
                ] as [ViewName, string][]
              ).map(([v, label]) => (
                <Big key={v} icon={Box} label={label} onClick={() => view.current?.view(v)} />
              ))}
            </Panel>
          )}
        </div>
      </div>

      {/* Tree, canvas, properties */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r bg-muted/20 py-1 text-xs">
          <Tree title="Bridge">
            {(Object.keys(FORM_TITLES) as FormKey[]).map((k) => (
              <Leaf key={k} label={FORM_TITLES[k]} active={form === k} onClick={() => openForm(k)} />
            ))}
          </Tree>
          {(["girder", "cap", "column"] as const).map((kind) => {
            const list = members.filter((m) => m.kind === kind);
            return list.length ? (
              <Tree key={kind} title={`${kind === "girder" ? "Girders" : kind === "cap" ? "Pier caps" : "Pier columns"} (${list.length})`} closed={kind === "girder" && list.length > 12}>
                {list.map((m) => (
                  <Leaf key={m.id} label={m.name} active={memberId === m.id} onClick={() => pickMember(m.id)} />
                ))}
              </Tree>
            ) : null;
          })}
          {a && (
            <>
              <Tree title="Load cases">
                {a.cases.map((c) => (
                  <Leaf key={c.name} label={c.name} hint={c.type} active={selKey === `case:${c.name}`} onClick={() => setSelKey(`case:${c.name}`)} />
                ))}
                <Leaf label="LL+IM (HL-93)" hint="LL" active={selKey === "live"} onClick={() => setSelKey("live")} />
              </Tree>
              <Tree title="Combinations">
                {a.combinations.map((c) => (
                  <Leaf key={c.name} label={c.name} active={selKey === `combination:${c.name}`} onClick={() => setSelKey(`combination:${c.name}`)} />
                ))}
              </Tree>
            </>
          )}
        </aside>

        <main className="relative min-w-0 flex-1 bg-slate-50 dark:bg-slate-900">
          {a ? (
            <BridgeView ref={view} model={a.generated.stage2} displacements={displacements} overlay={diagram?.overlay ?? null} selected={selected} onPick={(id) => pickMember(id === null ? null : (a.memberOf(id)?.id ?? null))} className="absolute inset-0" />
          ) : (
            <div className="p-6">
              <DesignErrorCard message={outcome.error ?? "The bridge could not be analyzed."} />
            </div>
          )}
          {a && (
            <div className="pointer-events-none absolute top-2 left-3 space-y-0.5 text-[11px]">
              <p className="font-semibold">
                {show === "none" ? "Model" : show === "deformed" ? "Deformed shape (exaggerated)" : `${SHOW[show].label} (${SHOW[show].unit})`}
                {show !== "none" && <span className="font-normal text-muted-foreground"> · {show === "deformed" && sel.kind === "live" ? "pick a load case or combination" : selectionLabel}</span>}
              </p>
              {diagram && (
                <>
                  <p className="tabular-nums text-muted-foreground">
                    Max {fmt(diagram.max.v, 1)} · {diagram.max.where}
                  </p>
                  <p className="tabular-nums text-muted-foreground">
                    Min {fmt(diagram.min.v, 1)} · {diagram.min.where}
                  </p>
                  {show === "My" && <p className="text-muted-foreground">Drawn on the tension side: sagging below the member.</p>}
                </>
              )}
            </div>
          )}
          <p className="pointer-events-none absolute right-3 bottom-2 text-[10px] text-muted-foreground">Drag to turn · scroll to zoom · right-drag to move · click a member</p>
        </main>

        <aside className="w-72 shrink-0 overflow-y-auto border-l px-3 py-2">
          {member && a ? (
            <MemberProperties a={a} member={member} sel={sel} live={live} label={selectionLabel} onTable={() => setTable("member")} />
          ) : form ? (
            <>
              <p className="pb-1 text-xs font-semibold">{FORM_TITLES[form]}</p>
              <BridgeForm form={form} def={def} setDef={setDef} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Pick an item in the tree, or a member in the model.</p>
          )}
        </aside>
      </div>

      {/* Tables */}
      {table && a && (
        <div className="flex h-[42%] min-h-48 shrink-0 flex-col border-t">
          <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1 text-xs">
            {(
              [
                ["member", "Member forces"],
                ["reactions", "Reactions"],
                ["checks", "Checks and properties"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTable(k)} className={cn("rounded px-2 py-0.5", table === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            ))}
            <span className="ml-2 text-muted-foreground">{table !== "checks" && selectionLabel}</span>
            <button type="button" onClick={() => setTable(null)} className="ml-auto rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close the tables">
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {table === "member" && (member ? <MemberPanel a={a} member={member} sel={sel} live={live} /> : <p className="p-3 text-xs text-muted-foreground">Pick a member in the tree or in the model to see its diagrams and forces.</p>)}
            {table === "reactions" && <ReactionsPanel a={a} sel={sel} def={current} live={live} />}
            {table === "checks" && <ChecksPanel a={a} live={live} />}
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-muted/40 px-3 text-[11px] text-muted-foreground">
        <span>kip, ft · AASHTO LRFD</span>
        {a && (
          <span>
            {a.generated.stage2.nodes.length} nodes · {a.generated.stage2.elements.length} elements
          </span>
        )}
        {a && <span className={a.ok ? "" : "text-destructive"}>{a.ok ? "Static analysis: equilibrium OK" : "Static analysis: not in equilibrium"}</span>}
        {a && (
          <span className="flex items-center gap-1">
            {moving.error ? (
              <span className="text-destructive">Moving load failed</span>
            ) : live ? (
              `Moving load: ${lanes} lane${lanes === 1 ? "" : "s"}, done`
            ) : (
              <>
                <Loader2 className="size-3 animate-spin" /> Moving load {Math.round(moving.progress * 100)}%
              </>
            )}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1" title="The Bridge section is new. Its solver is tested against hand solutions, PGSuper's girder moments and reference HL-93 envelopes, but its results aren't yet for use without a check by another program or by hand.">
          <TriangleAlert className="size-3 text-amber-600" />
          Not verified: check independently
        </span>
      </div>
    </div>
  );
}

function Tree({ title, children, closed = false }: { title: string; children: React.ReactNode; closed?: boolean }) {
  const [open, setOpen] = useState(!closed);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1 px-2 py-1 text-left font-semibold hover:bg-accent">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {title}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}
function Leaf({ label, hint, active, onClick }: { label: string; hint?: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center justify-between gap-2 py-0.5 pr-2 pl-6 text-left hover:bg-accent", active && "bg-accent font-medium text-primary")}>
      <span className="truncate">{label}</span>
      {hint && <span className="shrink-0 text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

function MemberProperties({ a, member, sel, live, label, onTable }: { a: BridgeAnalysis; member: Member; sel: Selection; live: LiveLoad | null; label: string; onTable: () => void }) {
  const st = useMemo(() => a.member(member, sel, 2, live), [a, member, sel, live]);
  const model = a.generated.stage2;
  const first = model.elements.find((e) => e.id === member.elements[0]);
  const section = model.sections.find((s) => s.id === first?.sec);
  const material = model.materials.find((m) => m.id === first?.mat);
  const length = st.length ? st[st.length - 1].x : 0;
  const extreme = (c: "My" | "Vz" | "N", pick: "max" | "min") => {
    let best = { v: pick === "max" ? -Infinity : Infinity, x: 0 };
    for (const s of st) {
      const v = (pick === "max" ? s.max : s.min)?.[c] ?? s.forces[c];
      if (pick === "max" ? v > best.v : v < best.v) best = { v, x: s.x };
    }
    return `${fmt(best.v, 1)} at ${fmt(best.x, 1)} ft`;
  };
  const row = (k: string, v: string) => (
    <div className="flex justify-between gap-3 border-b border-border/40 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="pb-1 font-semibold">{member.name}</p>
        {row("Length", `${fmt(length, 2)} ft`)}
        {row("Elements", String(member.elements.length))}
        {section && row("Section", section.name)}
        {section && row("A", `${fmt(section.A * 144, 1)} in²`)}
        {section && row("I, vertical bending", `${fmt(section.Iy * 20736, 0)} in⁴`)}
        {material && row("E", `${fmt(material.E / 144, 0)} ksi`)}
      </div>
      <div>
        <p className="pb-1 font-semibold">
          Forces <span className="font-normal text-muted-foreground">· {label}</span>
        </p>
        {row("Moment, max (kip·ft)", extreme("My", "max"))}
        {row("Moment, min (kip·ft)", extreme("My", "min"))}
        {row("Shear, max (kip)", extreme("Vz", "max"))}
        {row("Shear, min (kip)", extreme("Vz", "min"))}
        {member.kind === "column" && row("Axial, min (kip)", extreme("N", "min"))}
      </div>
      <button type="button" onClick={onTable} className="rounded border px-2 py-1 hover:bg-accent">
        Diagrams and table
      </button>
    </div>
  );
}
