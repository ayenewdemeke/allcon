"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createLinkedDesign, renameDesign } from "@/app/actions/design";
import { Button } from "@/components/ui/button";
import { buildTemplate } from "@/lib/design/stm/templates";
import { Card, CardContent } from "@/components/ui/card";
import { BARS } from "@/lib/design/stm/aashto";
import { browserLpSolver } from "@/lib/design/stm/lp-browser";
import { designStm, type StmCase, type StmFace, type StmInputs, type StmNodeCheck, type StmResult, type StmTie, type TieEnd } from "@/lib/design/stm/strut-tie";
import { DesignError } from "@/lib/design/walls/cip";
import { cn } from "@/lib/utils";
import { ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, Section, Toggle } from "./design-kit";
import { StmGirderPanel } from "./stm-girder-panel";
import { StmSketch, type SketchView } from "./stm-sketch";
import { openItems, StmModelStatus } from "./stm-status";
import { StmTemplatePanel } from "./stm-template-panel";
import { CapDetailSketch } from "./cap-detail-sketch";
import { RebarScheduleTab } from "./rebar-schedule-tab";
import { StmSectionalCard } from "./stm-sectional-card";
import { capDetailOrNull, stmPayLines } from "@/lib/design/stm/package";
import { sectionalDesign } from "@/lib/design/stm/sectional";

// A strut-and-tie model: the geometry, loads, layout and details on the left; the model drawn with
// its forces and the checks on the right, worked out (the solve runs in the browser) and saved as
// you go.

type Outcome = { result: StmResult | null; error: string | null; busy: boolean };

/** A number in a table cell: typed as text, passed on once it reads as a number. */
function NumCell({ value, onChange, step = 1, className }: { value: number; onChange: (v: number) => void; step?: number; className?: string }) {
  const [text, setText] = useState(String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setText(String(value));
  }
  return (
    <input
      type="number"
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(v)) {
          setLast(v);
          onChange(v);
        }
      }}
      className={cn("h-6 w-full min-w-0 rounded border border-input bg-transparent px-1 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-primary", className)}
    />
  );
}

const TextCell = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-6 w-full min-w-0 rounded border border-input bg-transparent px-1 text-xs outline-none focus:ring-1 focus:ring-primary" />
);

const Remove = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button type="button" onClick={onClick} className="text-muted-foreground hover:text-destructive" aria-label={label}>
    <X className="size-3.5" />
  </button>
);

const Add = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline">
    <Plus className="size-3" /> {children}
  </button>
);

const Head = ({ cols }: { cols: string[] }) => (
  <thead>
    <tr className="text-left text-[11px] text-muted-foreground">
      {cols.map((c, k) => (
        <th key={k} className="pr-1 font-normal">
          {c}
        </th>
      ))}
    </tr>
  </thead>
);

const replace = <T,>(list: T[], k: number, v: T) => list.map((x, j) => (j === k ? v : x));

/** A second design for the cases this hammerhead model leaves out: the same cap and loads, laid out for the other direction. */
function OtherDirection({ design, inputs }: { design: { id: string; name: string }; inputs: StmInputs }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const side = inputs.template!.layoutSign! > 0 ? "left" : "right";
  const create = async () => {
    setBusy(true);
    try {
      const next = buildTemplate({ ...inputs.template!, direction: side }, inputs);
      const { designId } = await createLinkedDesign(design.id, "stm-d-region", next as unknown as Record<string, unknown>);
      await renameDesign(designId, `${design.name} (turning ${side})`.slice(0, 200));
      router.push(`/design/${designId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the design");
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" className="mt-1" onClick={() => void create()} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <ArrowUpRight />} Create the design laid out for the {side}
    </Button>
  );
}

export function StmEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: StmInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof StmInputs>(key: K) => (v: StmInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const [outcome, setOutcome] = useState<Outcome>({ result: null, error: null, busy: true });
  const [view, setView] = useState<SketchView>("envelope");

  // The solve is asynchronous (HiGHS in WebAssembly): run it shortly after the last change, and
  // keep only the latest answer.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setOutcome((o) => ({ ...o, busy: true }));
      designStm(inputs, browserLpSolver)
        .then((result) => live && setOutcome({ result, error: null, busy: false }))
        .catch((err) => live && setOutcome({ result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out", busy: false }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [inputs]);
  const r = outcome.result;
  const [tab, setTab] = useState<"model" | "details" | "schedule">("model");
  // A standard cap's bars, detailed from its inputs; its regions (and sectional checks) from the solved cases.
  const detail = useMemo(() => capDetailOrNull(inputs), [inputs]);
  const payChoice = inputs.payItems ?? { concrete: "601-03040", rebar: "602-00020" };
  const earth = useMemo(() => (detail ? stmPayLines(inputs, detail) : null), [inputs, detail]);
  const sectional = useMemo(() => {
    if (!inputs.template || !r) return null;
    try {
      return sectionalDesign(inputs, r);
    } catch {
      return null;
    }
  }, [inputs, r]);
  const labels = inputs.nodes.map((n) => n.label);
  const autoGeometry = !!inputs.template && inputs.layout === "entered" && inputs.nodeGeometry !== "entered";
  const nodeOptions = labels.map((l) => ({ value: l, label: l || "?" }));
  const barOptions = Object.keys(BARS).map((b) => ({ value: Number(b), label: `#${b}` }));

  const setCase = (k: number, c: StmCase) => set("cases")(replace(inputs.cases, k, c));
  const setTie = (k: number, t: StmTie) => set("ties")(replace(inputs.ties, k, t));
  const setEnd = (k: number, e: number, end: TieEnd) => setTie(k, { ...inputs.ties[k], ends: replace(inputs.ties[k].ends, e, end) });
  const setCheck = (k: number, n: StmNodeCheck) => set("nodeChecks")(replace(inputs.nodeChecks, k, n));
  const setFace = (k: number, f: number, face: StmFace) => setCheck(k, { ...inputs.nodeChecks[k], faces: replace(inputs.nodeChecks[k].faces, f, face) });

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Strut-and-Tie Model · AASHTO LRFD 5.8.2" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(340px,430px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Start from a standard cap" open={!inputs.template}>
              <StmTemplatePanel inputs={inputs} onBuild={setInputs} onLink={set("girders")} />
            </Section>

            <Section title="Member and materials" open>
              <Choice label="Component" value={inputs.component} options={[{ value: "pier_cap", label: "Pier cap" }, { value: "abutment", label: "Abutment" }, { value: "other", label: "Other D-region" }]} onChange={set("component")} />
              <Field label="Concrete f'c (normalweight)" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="Bars fy" unit="ksi" value={inputs.fy} onChange={set("fy")} step={5} />
              <Field label="Member width (out of plane)" unit="in" value={inputs.b} onChange={set("b")} />
            </Section>

            <Section title="Concrete outline (ft)">
              <table className="w-full">
                <Head cols={["", "x", "y", ""]} />
                <tbody>
                  {inputs.outline.map((p, k) => (
                    <tr key={k}>
                      <td className="w-6 text-[11px] text-muted-foreground">{k + 1}</td>
                      <td className="pr-1">
                        <NumCell value={p[0]} step={0.1} onChange={(v) => set("outline")(replace(inputs.outline, k, [v, p[1]]))} />
                      </td>
                      <td className="pr-1">
                        <NumCell value={p[1]} step={0.1} onChange={(v) => set("outline")(replace(inputs.outline, k, [p[0], v]))} />
                      </td>
                      <td className="w-5">{inputs.outline.length > 3 && <Remove label="Remove point" onClick={() => set("outline")(inputs.outline.filter((_, j) => j !== k))} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Add onClick={() => set("outline")([...inputs.outline, inputs.outline[inputs.outline.length - 1] ?? [0, 0]])}>Point</Add>
              <p className="pt-1 text-[11px] text-muted-foreground">Corners in order around the concrete, without repeating the first.</p>
            </Section>

            <Section title="Nodes (ft)" open>
              <table className="w-full">
                <Head cols={["Label", "x", "y", ""]} />
                <tbody>
                  {inputs.nodes.map((n, k) => (
                    <tr key={k}>
                      <td className="w-14 pr-1">
                        <TextCell value={n.label} onChange={(label) => set("nodes")(replace(inputs.nodes, k, { ...n, label }))} />
                      </td>
                      <td className="pr-1">
                        <NumCell value={n.x} step={0.1} onChange={(x) => set("nodes")(replace(inputs.nodes, k, { ...n, x }))} />
                      </td>
                      <td className="pr-1">
                        <NumCell value={n.y} step={0.1} onChange={(y) => set("nodes")(replace(inputs.nodes, k, { ...n, y }))} />
                      </td>
                      <td className="w-5">
                        <Remove label="Remove node" onClick={() => set("nodes")(inputs.nodes.filter((_, j) => j !== k))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Add onClick={() => set("nodes")([...inputs.nodes, { label: `N${inputs.nodes.length + 1}`, x: 0, y: 0 }])}>Node</Add>
              <p className="pt-1 text-[11px] text-muted-foreground">Place ties on the bars&apos; centroids and struts on the compression resultants (C5.8.2.2).</p>
            </Section>

            <Section title="Supports">
              <table className="w-full">
                <Head cols={["Node", "x", "y", "Up only", ""]} />
                <tbody>
                  {inputs.supports.map((s, k) => (
                    <tr key={k}>
                      <td className="pr-1">
                        <select value={s.node} onChange={(e) => set("supports")(replace(inputs.supports, k, { ...s, node: e.target.value }))} className="h-6 w-full rounded border border-input bg-transparent text-xs">
                          {nodeOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      {(["x", "y", "upwardOnly"] as const).map((f) => (
                        <td key={f} className="text-center">
                          <input type="checkbox" checked={s[f]} onChange={(e) => set("supports")(replace(inputs.supports, k, { ...s, [f]: e.target.checked }))} />
                        </td>
                      ))}
                      <td className="w-5">
                        <Remove label="Remove support" onClick={() => set("supports")(inputs.supports.filter((_, j) => j !== k))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Add onClick={() => set("supports")([...inputs.supports, { node: labels[0] ?? "", x: false, y: true, upwardOnly: false }])}>Support</Add>
            </Section>

            <Section title="Loads from girder designs" open={!!inputs.girders?.enabled}>
              <StmGirderPanel inputs={inputs} onChange={set("girders")} result={r} />
            </Section>

            <Section title="Factored loads (kip, y up)" open={!inputs.girders?.enabled}>
              {inputs.girders?.enabled && <p className="pb-1 text-[11px] text-amber-700 dark:text-amber-400">Taken from the girder designs; these cases are kept but not used.</p>}
              {inputs.cases.map((c, k) => (
                <div key={k} className="mb-2 rounded border border-border/60 p-1.5">
                  <div className="mb-1 flex items-center gap-1">
                    <TextCell value={c.name} onChange={(name) => setCase(k, { ...c, name })} />
                    {inputs.cases.length > 1 && <Remove label="Remove case" onClick={() => set("cases")(inputs.cases.filter((_, j) => j !== k))} />}
                  </div>
                  <table className="w-full">
                    <Head cols={["Node", "Fx", "Fy", ""]} />
                    <tbody>
                      {c.loads.map((l, j) => (
                        <tr key={j}>
                          <td className="w-16 pr-1">
                            <select value={l.node} onChange={(e) => setCase(k, { ...c, loads: replace(c.loads, j, { ...l, node: e.target.value }) })} className="h-6 w-full rounded border border-input bg-transparent text-xs">
                              {nodeOptions.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="pr-1">
                            <NumCell value={l.fx} onChange={(fx) => setCase(k, { ...c, loads: replace(c.loads, j, { ...l, fx }) })} />
                          </td>
                          <td className="pr-1">
                            <NumCell value={l.fy} onChange={(fy) => setCase(k, { ...c, loads: replace(c.loads, j, { ...l, fy }) })} />
                          </td>
                          <td className="w-5">
                            <Remove label="Remove load" onClick={() => setCase(k, { ...c, loads: c.loads.filter((_, m) => m !== j) })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Add onClick={() => setCase(k, { ...c, loads: [...c.loads, { node: labels[0] ?? "", fx: 0, fy: 0 }] })}>Load</Add>
                </div>
              ))}
              <Add onClick={() => set("cases")([...inputs.cases, { name: `Case ${inputs.cases.length + 1}`, loads: [] }])}>Load case</Add>
              <p className="pt-1 text-[11px] text-muted-foreground">Include the member&apos;s own weight in the loads at the nodes.</p>
            </Section>

            <Section title="Layout" open>
              <Choice label="Struts and ties" value={inputs.layout} options={[{ value: "entered", label: "As entered" }, { value: "optimized", label: "Found by optimization" }]} onChange={set("layout")} />
              {inputs.template?.kind === "hammerhead" && (
                <Choice
                  label="Column boundary"
                  value={inputs.columnBoundary ?? "solver"}
                  options={[
                    { value: "solver", label: "Reactions from statics" },
                    { value: "linear-stress", label: "Near the column's linear stress" },
                  ]}
                  onChange={(v) => set("columnBoundary")(v)}
                />
              )}
              {inputs.template && inputs.layout === "entered" && (
                <Choice
                  label="Node faces and anchorage"
                  value={inputs.nodeGeometry ?? "auto"}
                  options={[
                    { value: "auto", label: "From the cap's geometry" },
                    { value: "entered", label: "As entered" },
                  ]}
                  onChange={(v) => set("nodeGeometry")(v)}
                />
              )}
              {inputs.layout === "entered" ? (
                <label className="block py-1 text-xs">
                  <span className="text-muted-foreground">Members (node pairs, e.g. A-B), separated by commas</span>
                  <textarea
                    value={inputs.members.join(", ")}
                    onChange={(e) =>
                      set("members")(
                        e.target.value
                          .split(/[,\n]/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                    rows={3}
                    className="mt-1 w-full rounded border border-input bg-transparent p-1 text-xs"
                  />
                </label>
              ) : (
                <>
                  <Field label="Study stress, tension" unit="ksi" value={inputs.study.tension} onChange={(v) => set("study")({ ...inputs.study, tension: v })} />
                  <Field label="Study stress, compression" unit="ksi" value={inputs.study.compression} onChange={(v) => set("study")({ ...inputs.study, compression: v })} step={0.5} />
                  <p className="pt-1 text-[11px] text-muted-foreground">Every line between nodes that stays in the concrete is a candidate; the least-volume set carrying all the cases is kept. The study stresses only weigh ties against struts.</p>
                </>
              )}
            </Section>

            <Section title="Crack-control grid (5.8.2.6)">
              <Toggle label="Orthogonal grid provided" value={inputs.grid.provided} onChange={(v) => set("grid")({ ...inputs.grid, provided: v })} />
              {inputs.grid.provided && (
                <>
                  <Field label="Vertical bars Av in each spacing" unit="in²" value={inputs.grid.Av} onChange={(v) => set("grid")({ ...inputs.grid, Av: v })} step={0.1} />
                  <Field label="Vertical spacing sv" unit="in" value={inputs.grid.sv} onChange={(v) => set("grid")({ ...inputs.grid, sv: v })} step={0.5} />
                  <Field label="Horizontal bars Ah in each spacing" unit="in²" value={inputs.grid.Ah} onChange={(v) => set("grid")({ ...inputs.grid, Ah: v })} step={0.1} />
                  <Field label="Horizontal spacing sh" unit="in" value={inputs.grid.sh} onChange={(v) => set("grid")({ ...inputs.grid, sh: v })} step={0.5} />
                  <Field label="Effective depth d" unit="in" value={inputs.grid.d} onChange={(v) => set("grid")({ ...inputs.grid, d: v })} />
                </>
              )}
            </Section>

            <Section title="Ties">
              {autoGeometry && <p className="pb-1 text-[11px] text-muted-foreground">Where the bars stop, their anchorage is worked out from the cap (bars to the cap&apos;s ends, hooked or straight as set under the standard cap). An anchorage entered here takes its place.</p>}
              {inputs.ties.map((t, k) => (
                <div key={k} className="mb-2 rounded border border-border/60 p-1.5 text-xs">
                  <div className="grid grid-cols-[1fr_4.5rem_3.5rem_1.25rem] items-center gap-1">
                    <TextCell value={t.member} placeholder="A-B" onChange={(member) => setTie(k, { ...t, member })} />
                    <select value={t.barSize} onChange={(e) => setTie(k, { ...t, barSize: Number(e.target.value) })} className="h-6 rounded border border-input bg-transparent text-xs">
                      {barOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <NumCell value={t.bars} onChange={(bars) => setTie(k, { ...t, bars: Math.max(1, Math.round(bars)) })} />
                    <Remove label="Remove tie" onClick={() => set("ties")(inputs.ties.filter((_, j) => j !== k))} />
                  </div>
                  {t.ends.map((e, j) => (
                    <div key={j} className="mt-1 grid grid-cols-[3rem_5.5rem_1fr_1fr_1fr_1.25rem] items-center gap-1 pl-2">
                      <TextCell value={e.node} onChange={(node) => setEnd(k, j, { ...e, node })} />
                      <select value={e.kind} onChange={(ev) => setEnd(k, j, { ...e, kind: ev.target.value as TieEnd["kind"] })} className="h-6 rounded border border-input bg-transparent text-xs">
                        <option value="straight">Straight</option>
                        <option value="hook">90° hook</option>
                      </select>
                      <NumCell value={e.available} onChange={(available) => setEnd(k, j, { ...e, available })} />
                      <NumCell value={e.clearCover} step={0.25} onChange={(clearCover) => setEnd(k, j, { ...e, clearCover })} />
                      <NumCell value={e.clearSpacing} step={0.25} onChange={(clearSpacing) => setEnd(k, j, { ...e, clearSpacing })} />
                      <Remove label="Remove anchorage" onClick={() => setTie(k, { ...t, ends: t.ends.filter((_, m) => m !== j) })} />
                      <span />
                      <label className="col-span-4 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <input type="checkbox" checked={e.topCast} onChange={(ev) => setEnd(k, j, { ...e, topCast: ev.target.checked })} /> Over 12 in of concrete cast below
                        <select value={e.coating} onChange={(ev) => setEnd(k, j, { ...e, coating: ev.target.value as TieEnd["coating"] })} className="ml-2 h-5 rounded border border-input bg-transparent text-[11px]">
                          <option value="uncoated">Uncoated</option>
                          <option value="epoxy">Epoxy</option>
                          <option value="galvanized">Galvanized</option>
                          <option value="dual">Dual-coated</option>
                        </select>
                      </label>
                    </div>
                  ))}
                  {t.ends.length > 0 && <p className="pl-2 text-[10px] text-muted-foreground">Anchorage: node, type, available length from the extended nodal zone, clear cover, clear spacing (in).</p>}
                  {t.ends.length < 2 && <Add onClick={() => setTie(k, { ...t, ends: [...t.ends, { node: t.member.split("-")[0] ?? "", kind: "straight", available: 0, clearCover: 2, clearSpacing: 6, topCast: false, coating: "uncoated" }] })}>Anchorage at an end</Add>}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">Each tie: member, bar size, number of bars.</p>
              <Add onClick={() => set("ties")([...inputs.ties, { member: "", barSize: 8, bars: 4, ends: [] }])}>Tie</Add>
            </Section>

            <Section title="Node faces (5.8.2.5)">
              {autoGeometry && <p className="pb-1 text-[11px] text-muted-foreground">Worked out from the cap&apos;s geometry: bearings, column, bar covers and the struts&apos; angles (Layout, Node faces and anchorage). The widths below are used only for nodes that geometry doesn&apos;t cover.</p>}
              {inputs.nodeChecks.map((n, k) => (
                <div key={k} className="mb-2 rounded border border-border/60 p-1.5 text-xs">
                  <div className="grid grid-cols-[3.5rem_1fr_1.25rem] items-center gap-1">
                    <TextCell value={n.node} onChange={(node) => setCheck(k, { ...n, node })} />
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      Thickness <NumCell value={n.thickness} onChange={(thickness) => setCheck(k, { ...n, thickness })} className="w-16" /> in
                    </label>
                    <Remove label="Remove node check" onClick={() => set("nodeChecks")(inputs.nodeChecks.filter((_, j) => j !== k))} />
                  </div>
                  {n.faces.map((f, j) => (
                    <div key={j} className="mt-1 grid grid-cols-[1fr_6rem_4rem_1.25rem] items-center gap-1 pl-2">
                      <TextCell value={f.source} placeholder="external or A-B" onChange={(source) => setFace(k, j, { ...f, source })} />
                      <select value={f.type} onChange={(e) => setFace(k, j, { ...f, type: e.target.value as StmFace["type"] })} className="h-6 rounded border border-input bg-transparent text-xs">
                        <option value="bearing">Bearing</option>
                        <option value="back">Back face</option>
                        <option value="interface">Strut interface</option>
                      </select>
                      <NumCell value={f.width} step={0.1} onChange={(width) => setFace(k, j, { ...f, width })} />
                      <Remove label="Remove face" onClick={() => setCheck(k, { ...n, faces: n.faces.filter((_, m) => m !== j) })} />
                    </div>
                  ))}
                  <Add onClick={() => setCheck(k, { ...n, faces: [...n.faces, { source: "external", type: "bearing", width: 12 }] })}>Face</Add>
                  <Toggle label="Confinement credit m = √(A2/A1) ≤ 2" value={!!n.confinement} onChange={(v) => setCheck(k, { ...n, confinement: v ? { A1: 1, A2: 1, basis: "" } : null })} />
                  {n.confinement && (
                    <div className="pl-2">
                      <Field label="A1, area under the bearing" unit="in²" value={n.confinement.A1} onChange={(A1) => setCheck(k, { ...n, confinement: { ...n.confinement!, A1 } })} />
                      <Field label="A2, notional area (5.6.5)" unit="in²" value={n.confinement.A2} onChange={(A2) => setCheck(k, { ...n, confinement: { ...n.confinement!, A2 } })} />
                      <TextCell value={n.confinement.basis} placeholder="How A2 was found" onChange={(basis) => setCheck(k, { ...n, confinement: { ...n.confinement!, basis } })} />
                    </div>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">Each face: the member whose force it carries (or &quot;external&quot; for the load and reaction at the node), its type and width (in). The node&apos;s type (CCC, CCT, CTT) follows from the ties meeting it.</p>
              <Add onClick={() => set("nodeChecks")([...inputs.nodeChecks, { node: labels[0] ?? "", thickness: inputs.b, faces: [], confinement: null }])}>Node</Add>
            </Section>

            <Section title="Service: diagonal cracking (C5.8.2.2)">
              {inputs.template && inputs.girders?.enabled && !inputs.service.check && <p className="pb-1 text-[11px] text-muted-foreground">Each arm is screened from the girders (Service I at the column face). Enter a shear here to use it instead.</p>}
              <Toggle label="Check it" value={inputs.service.check} onChange={(v) => set("service")({ ...inputs.service, check: v })} />
              {inputs.service.check && (
                <>
                  <Field label="Service shear V" unit="kip" value={inputs.service.V} onChange={(V) => set("service")({ ...inputs.service, V })} />
                  <Field label="Shear span a" unit="in" value={inputs.service.a} onChange={(a) => set("service")({ ...inputs.service, a })} />
                  <Field label="Effective depth d" unit="in" value={inputs.service.d} onChange={(d) => set("service")({ ...inputs.service, d })} />
                </>
              )}
            </Section>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {detail && (
            <div className="flex gap-1 rounded-lg bg-muted p-[3px] text-sm" role="tablist">
              {(
                [
                  ["model", "Model and checks"],
                  ["details", "Reinforcement details"],
                  ["schedule", "Bar schedule & quantities"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("flex-1 rounded-md px-2 py-1 font-medium text-foreground/60 hover:text-foreground", tab === k && "bg-background text-foreground shadow-sm")}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {detail && tab === "details" ? (
            <>
              {r && !r.ok && (
                <Card>
                  <CardContent className="py-3 text-xs text-amber-800 dark:text-amber-300">The design has failing checks: these details show the bars as given, not yet a passing design.</CardContent>
                </Card>
              )}
              <Card>
                <CardContent className="py-3">
                  <CapDetailSketch detail={detail} />
                </CardContent>
              </Card>
              {detail.notes.length > 0 && (
                <Card>
                  <CardContent className="space-y-1 py-3 text-xs text-muted-foreground">
                    {detail.notes.map((n) => (
                      <p key={n}>{n}</p>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          ) : detail && tab === "schedule" ? (
            <>
              {earth!.earth.label && (
                <div className="grid max-w-xl gap-x-4 text-xs sm:grid-cols-2">
                  <Field label={earth!.earth.label} unit="ft" value={earth!.earth.ground} step={0.5} hint="For the structure excavation and backfill (CDOT M-206-2)" onChange={(g) => set("payItems")({ ...payChoice, ground: g })} />
                </div>
              )}
              <RebarScheduleTab
                design={design}
                inputs={inputs}
                schedule={detail.schedule}
                notes={detail.notes}
                pay={{ kind: "stm-d-region", value: payChoice, lines: earth!.lines, onChange: (v) => set("payItems")({ ...payChoice, ...v, concrete: v.concrete ?? payChoice.concrete, rebar: v.rebar ?? payChoice.rebar }) }}
              />
            </>
          ) : outcome.error ? (
            <DesignErrorCard message={outcome.error} />
          ) : !r ? (
            <Card>
              <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Solving the model…
              </CardContent>
            </Card>
          ) : (
            <>
              <ChecksBanner
                checks={r.checks}
                extra={
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    {openItems(r) > 0 && <span className="text-muted-foreground">{openItems(r) === 1 ? "1 item needs" : `${openItems(r)} items need`} input (Model details)</span>}
                    {outcome.busy && <Loader2 className="size-4 animate-spin" />}
                  </span>
                }
              />
              <Card>
                <CardContent className="py-3">
                  <div className="flex items-center gap-2 pb-2 text-xs">
                    <span className="text-muted-foreground">Show</span>
                    <select value={view === "envelope" ? "envelope" : String(view.case)} onChange={(e) => setView(e.target.value === "envelope" ? "envelope" : { case: Number(e.target.value) })} className="h-7 rounded-md border border-input bg-transparent px-1">
                      <option value="envelope">Envelope of all cases</option>
                      {r.cases.map((c, k) => (
                        <option key={k} value={k}>
                          Case {k + 1}: {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <StmSketch result={r} view={view === "envelope" || view.case < r.cases.length ? view : "envelope"} />
                </CardContent>
              </Card>
              {r.warnings.length > 0 && (
                <Card>
                  <CardContent className="space-y-1 py-3 text-xs text-amber-800 dark:text-amber-300">
                    {r.warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                    {r.reversedCases.length > 0 && inputs.template?.layoutSign && <OtherDirection design={design} inputs={inputs} />}
                  </CardContent>
                </Card>
              )}
              <ChecksTable checks={r.checks} groupOf={(id) => (id === "angle" ? "Model" : id.startsWith("grid") ? "Crack-control grid" : id.startsWith("tie") ? "Ties" : id.startsWith("anchor") ? "Anchorage" : id.startsWith("node") ? "Nodes" : "Service")} />
              {sectional && <StmSectionalCard sec={sectional} on={!!inputs.sectional} onToggle={(v) => set("sectional")(v || undefined)} />}
              <Card>
                <CardContent className="overflow-x-auto py-3 text-xs">
                  <p className="pb-1 font-semibold">Member forces <span className="font-normal text-muted-foreground">(largest over the cases; governing case in brackets)</span></p>
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="font-normal">Member</th>
                        <th className="font-normal">Role</th>
                        <th className="text-right font-normal">Length ft</th>
                        <th className="text-right font-normal">Tension kip</th>
                        <th className="text-right font-normal">Compression kip</th>
                        {view !== "envelope" && view.case < r.cases.length && <th className="text-right font-normal">Case {view.case + 1} kip</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {r.members
                        .filter((m) => m.active)
                        .map((m) => (
                          <tr key={m.key} className="border-b border-border/40">
                            <td>{m.key}</td>
                            <td className={m.role === "tie" ? "text-blue-700 dark:text-blue-400" : "text-red-700 dark:text-red-400"}>{m.role}</td>
                            <td className="text-right tabular-nums">{fmt(m.length / 12)}</td>
                            <td className="text-right tabular-nums">{m.tension > 0 ? `${fmt(m.tension, 1)} (${m.tensionCase! + 1})` : "—"}</td>
                            <td className="text-right tabular-nums">{m.compression > 0 ? `${fmt(m.compression, 1)} (${m.compressionCase! + 1})` : "—"}</td>
                            {view !== "envelope" && view.case < r.cases.length && <td className="text-right tabular-nums">{fmt(r.forces[view.case][r.members.indexOf(m)], 1)}</td>}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              <StmModelStatus result={r} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
