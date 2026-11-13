"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { renameBridge, saveBridgeDefinition, setBridgeProject } from "@/app/actions/bridge";
import { Choice, DesignErrorCard, Field, fmt, KeyValues, Section, Toggle } from "@/components/design/design-kit";
import { Card, CardContent } from "@/components/ui/card";
import { analyzeBridge, type BridgeAnalysis, type Selection } from "@/lib/bridge/bridge";
import { GIRDER_CHOICES, supportsFor, type BridgeDefinition } from "@/lib/bridge/definition";
import type { Member } from "@/lib/bridge/generate";
import { cn } from "@/lib/utils";
import { BridgeView } from "./bridge-view";
import { Diagram } from "./diagram";

// A bridge, edited: the wizard's inputs on the left (as midas Civil's girder bridge wizard takes
// them: layout, section, substructure, loads), the model and its analysis on the right, redone as
// the inputs change. Saved as you go.

type Tab = "model" | "members" | "reactions" | "checks";
type Save = "saved" | "saving" | "unsaved" | "error";

export function BridgeEditor({ bridge, projects }: { bridge: { id: string; name: string; projectId: string | null; definition: BridgeDefinition }; projects: { id: string; name: string }[] }) {
  const [def, setDef] = useState(bridge.definition);
  const [name, setName] = useState(bridge.name);
  const [projectId, setProjectId] = useState(bridge.projectId);
  const [save, setSave] = useState<Save>("saved");
  const [tab, setTab] = useState<Tab>("model");
  const [selection, setSelection] = useState("combination:Service I");
  const [memberId, setMemberId] = useState("G1-S1");
  const [deflected, setDeflected] = useState(true);
  const set = <K extends keyof BridgeDefinition>(key: K) => (v: BridgeDefinition[K]) => setDef((s) => ({ ...s, [key]: v }));
  const part = <K extends "girder" | "deck" | "diaphragms" | "piers" | "loads">(key: K) => <F extends keyof BridgeDefinition[K]>(field: F) => (v: BridgeDefinition[K][F]) => setDef((s) => ({ ...s, [key]: { ...s[key], [field]: v } }));

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

  // The analysis follows the inputs a beat behind, so typing stays quick.
  const current = useDeferredValue(def);
  const outcome = useMemo((): { analysis: BridgeAnalysis | null; error: string | null } => {
    try {
      return { analysis: analyzeBridge(current), error: null };
    } catch (e) {
      return { analysis: null, error: e instanceof Error ? e.message : "The bridge could not be analyzed." };
    }
  }, [current]);
  const a = outcome.analysis;
  const sel: Selection = useMemo(() => {
    const [kind, ...rest] = selection.split(":");
    return { kind: kind === "case" ? "case" : "combination", name: rest.join(":") };
  }, [selection]);
  const members = a?.generated.members ?? [];
  const member = members.find((m) => m.id === memberId) ?? members[0];
  const displacements = useMemo(() => (a && deflected ? a.displacements(sel) : null), [a, sel, deflected]);

  const setSpans = (spans: number[]) => setDef((s) => ({ ...s, spans, supports: supportsFor(spans.length, s.supports) }));
  const selectionPicker = a && (
    <select value={selection} onChange={(e) => setSelection(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs" aria-label="Load case or combination">
      <optgroup label="Combinations (permanent loads)">
        {a.combinations.map((c) => (
          <option key={c.name} value={`combination:${c.name}`}>
            {c.name}: {c.description}
          </option>
        ))}
      </optgroup>
      <optgroup label="Load cases">
        {a.cases.map((c) => (
          <option key={c.name} value={`case:${c.name}`}>
            {c.name} ({c.type}, {c.stage === 1 ? "girders alone" : "composite"})
          </option>
        ))}
      </optgroup>
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== bridge.name && renameBridge(bridge.id, name).catch(() => toast.error("Could not rename the bridge"))}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold outline-none hover:border-input focus:border-input"
          aria-label="Bridge name"
        />
        <span className="text-xs text-muted-foreground">Precast girder bridge · AASHTO LRFD</span>
        {projects.length > 0 && (
          <select
            value={projectId ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              setProjectId(id);
              setBridgeProject(bridge.id, id).catch(() => toast.error("Could not file the bridge under that project"));
            }}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs"
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
        <span className="flex items-center gap-1 text-xs text-muted-foreground" title={save === "saved" ? "All changes saved" : save === "error" ? "Not saved" : "Saving"}>
          {save === "saved" ? <Check className="size-3.5" /> : save === "error" ? <AlertCircle className="size-3.5 text-destructive" /> : <Loader2 className="size-3.5 animate-spin" />}
        </span>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <p>
          <span className="font-semibold">Not verified: check independently.</span> The Bridge section is new. Its solver is tested against hand solutions and its girder moments against PGSuper, but its results aren&apos;t yet for use without a check
          by another program or by hand. Live load (HL-93) comes next: the combinations here carry permanent loads only.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardContent className="py-2">
            <Section title="Layout" open>
              <Field label="Spans" value={def.spans.length} onChange={(n) => setSpans(Array.from({ length: Math.min(8, Math.max(1, Math.round(n))) }, (_, k) => def.spans[k] ?? def.spans[def.spans.length - 1]))} />
              {def.spans.map((L, k) => (
                <Field key={k} label={`Span ${k + 1}`} unit="ft" value={L} onChange={(v) => setSpans(def.spans.map((x, j) => (j === k ? v : x)))} step={5} hint="Between support centerlines" />
              ))}
              <Field label="Skew of the supports" unit="°" value={def.skew} onChange={set("skew")} step={5} />
              {def.spans.length > 1 && def.continuity === "continuous" && <p className="pb-1 text-[11px] text-muted-foreground">Continuous for the loads after the deck (barriers, wearing surface); the girders carry their weight and the deck on simple spans.</p>}
              {def.spans.length > 1 && (
                <Choice
                  label="At the piers"
                  value={def.continuity}
                  options={[
                    { value: "continuous", label: "Made continuous" },
                    { value: "simple", label: "Simple spans" },
                  ]}
                  onChange={set("continuity")}
                />
              )}
              {def.supports.map((s, k) => (
                <Choice
                  key={k}
                  label={k === 0 ? "Abutment 1 bearings" : k === def.supports.length - 1 ? "Abutment 2 bearings" : `Pier ${k} bearings`}
                  value={s.bearing}
                  options={[
                    { value: "fixed", label: "Fixed" },
                    { value: "expansion", label: "Expansion" },
                  ]}
                  onChange={(v) => set("supports")(def.supports.map((x, j) => (j === k ? { bearing: v } : x)))}
                />
              ))}
            </Section>
            <Section title="Girders and deck" open>
              <Choice label="Girder" value={def.girder.shape} options={def.girder.shape === "custom" ? [{ value: "custom", label: "Custom section" }, ...GIRDER_CHOICES] : GIRDER_CHOICES} onChange={(shape) => setDef((s) => ({ ...s, girder: { shape, fc: s.girder.fc, wc: s.girder.wc } }))} />
              <Field label="Number of girders" value={def.nGirders} onChange={(v) => set("nGirders")(Math.round(v))} />
              <Field label="Girder spacing" unit="ft" value={def.spacing} onChange={set("spacing")} step={0.25} />
              <Field label="Overhang" unit="ft" value={def.overhang} onChange={set("overhang")} step={0.25} hint="Exterior girder centerline to the deck's edge" />
              <Field label="Girder f'c" unit="ksi" value={def.girder.fc} onChange={part("girder")("fc")} step={0.5} />
              <Field label="Deck thickness, as cast" unit="in" value={def.deck.thickness} onChange={part("deck")("thickness")} step={0.25} />
              <Field label="Sacrificial thickness" unit="in" value={def.deck.sacrificial} onChange={part("deck")("sacrificial")} step={0.25} hint="A load, left out of the section" />
              <Field label="Haunch" unit="in" value={def.deck.haunch} onChange={part("deck")("haunch")} step={0.5} />
              <Field label="Deck f'c" unit="ksi" value={def.deck.fc} onChange={part("deck")("fc")} step={0.5} />
              <Field label="Elements per span" value={def.divisions} onChange={(v) => set("divisions")(Math.round(v))} hint="10: results at the tenth points" />
            </Section>
            <Section title="Diaphragms">
              <Field label="Intermediate, per span" value={def.diaphragms.perSpan} onChange={(v) => part("diaphragms")("perSpan")(Math.round(v))} />
              <Field label="Weight, per bay" unit="kip" value={def.diaphragms.weight} onChange={part("diaphragms")("weight")} step={0.5} hint="Between two girders: an interior girder carries one, an exterior girder half" />
              <Field label="Thickness" unit="ft" value={def.diaphragms.thickness} onChange={part("diaphragms")("thickness")} step={0.25} />
              <Toggle label="Diaphragms at the supports" value={def.diaphragms.atSupports} onChange={part("diaphragms")("atSupports")} />
            </Section>
            {def.spans.length > 1 && (
              <Section title="Piers">
                <Toggle label="Model the caps and columns" value={def.piers.model} onChange={part("piers")("model")} />
                {def.piers.model && (
                  <>
                    <Field label="Cap width" unit="ft" value={def.piers.capWidth} onChange={part("piers")("capWidth")} step={0.5} />
                    <Field label="Cap depth" unit="ft" value={def.piers.capDepth} onChange={part("piers")("capDepth")} step={0.5} />
                    <Field label="Columns" value={def.piers.columns} onChange={(v) => part("piers")("columns")(Math.round(v))} />
                    <Field label="Column diameter" unit="ft" value={def.piers.columnDiameter} onChange={part("piers")("columnDiameter")} step={0.5} />
                    <Field label="Column height" unit="ft" value={def.piers.columnHeight} onChange={part("piers")("columnHeight")} step={1} hint="Cap's soffit to the fixed base" />
                    <Field label="Column spacing" unit="ft" value={def.piers.columnSpacing} onChange={part("piers")("columnSpacing")} step={1} />
                    <Field label="Pier f'c" unit="ksi" value={def.piers.fc} onChange={part("piers")("fc")} step={0.5} />
                  </>
                )}
                <Field label="Bearing height" unit="in" value={def.piers.bearingHeight} onChange={part("piers")("bearingHeight")} step={0.5} />
              </Section>
            )}
            <Section title="Loads">
              <Field label="Barrier, each side" unit="klf" value={def.loads.barrierWeight} onChange={part("loads")("barrierWeight")} step={0.05} />
              <Field label="Barrier width" unit="ft" value={def.loads.barrierWidth} onChange={part("loads")("barrierWidth")} step={0.25} />
              <Field label="Future wearing surface" unit="psf" value={def.loads.wearingSurface} onChange={part("loads")("wearingSurface")} step={5} />
            </Section>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-3">
          {outcome.error && <DesignErrorCard message={outcome.error} />}
          {a && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1 rounded-lg bg-muted p-[3px]" role="tablist">
                  {(
                    [
                      ["model", "Model"],
                      ["members", "Member forces"],
                      ["reactions", "Reactions"],
                      ["checks", "Checks and properties"],
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium text-foreground/60 hover:text-foreground", tab === k && "bg-background text-foreground shadow-sm")}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2">{tab !== "checks" && selectionPicker}</div>
              </div>

              {tab === "model" && (
                <Card>
                  <CardContent className="space-y-2 py-3">
                    <BridgeView model={a.generated.stage2} displacements={displacements} className="h-[26rem] w-full overflow-hidden rounded-md bg-slate-50 dark:bg-slate-900" />
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <label className="flex items-center gap-1.5 text-foreground">
                        <input type="checkbox" checked={deflected} onChange={(e) => setDeflected(e.target.checked)} /> Deflected shape (exaggerated)
                      </label>
                      <span>
                        {a.generated.stage2.nodes.length} nodes · {a.generated.stage2.elements.length} elements · {a.generated.stage2.links.length} bearings · {a.generated.stage2.supports.length} supports
                      </span>
                      <span>Girders dark, deck strips light, piers brown, bearings orange, supports green. Drag to turn, scroll to zoom.</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {tab === "members" && member && <MemberResults a={a} member={member} members={members} sel={sel} onMember={setMemberId} />}
              {tab === "reactions" && <Reactions a={a} sel={sel} def={current} />}
              {tab === "checks" && <Checks a={a} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MemberResults({ a, member, members, sel, onMember }: { a: BridgeAnalysis; member: Member; members: Member[]; sel: Selection; onMember: (id: string) => void }) {
  const stations = useMemo(() => a.member(member, sel, 4), [a, member, sel]);
  const ends = useMemo(() => a.member(member, sel, 1), [a, member, sel]);
  const girder = member.kind === "girder";
  // Each element's two ends, the shared ones once (a jump in shear at a load shows as two rows).
  const rows = ends.filter((s, k) => k === 0 || k === ends.length - 1 || k % 2 === 1);
  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">Member</span>
          <select value={member.id} onChange={(e) => onMember(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs" aria-label="Member">
            {(["girder", "cap", "column"] as const).map((kind) => {
              const list = members.filter((m) => m.kind === kind);
              return list.length ? (
                <optgroup key={kind} label={kind === "girder" ? "Girders" : kind === "cap" ? "Pier caps" : "Pier columns"}>
                  {list.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
          <span className="text-muted-foreground">{girder ? "Along the span from its first support." : member.kind === "cap" ? "Across the bridge, from the first girder's side." : "From the base up."}</span>
        </div>
        <Diagram title="Moment" unit="kip·ft, sagging below the line" points={stations.map((s) => ({ x: s.x, v: s.forces.My }))} flip />
        <Diagram title="Shear" unit="kip" points={stations.map((s) => ({ x: s.x, v: s.forces.Vz }))} color="#b45309" />
        {member.kind === "column" ? (
          <Diagram title="Axial force" unit="kip, compression −" points={stations.map((s) => ({ x: s.x, v: s.forces.N }))} color="#475569" />
        ) : (
          <Diagram title="Deflection" unit="in, down −" points={stations.map((s) => ({ x: s.x, v: s.dz * 12 }))} color="#475569" />
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2 font-medium">x (ft)</th>
                <th className="px-2 text-right font-medium">Moment (kip·ft)</th>
                <th className="px-2 text-right font-medium">Shear (kip)</th>
                <th className="px-2 text-right font-medium">Axial (kip)</th>
                <th className="px-2 text-right font-medium">Torsion (kip·ft)</th>
                <th className="pl-2 text-right font-medium">Deflection (in)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, k) => (
                <tr key={k} className="border-b border-border/40">
                  <td className="py-0.5 pr-2">{fmt(s.x, 2)}</td>
                  <td className="px-2 text-right">{fmt(s.forces.My, 1)}</td>
                  <td className="px-2 text-right">{fmt(s.forces.Vz, 1)}</td>
                  <td className="px-2 text-right">{fmt(s.forces.N, 1)}</td>
                  <td className="px-2 text-right">{fmt(s.forces.T, 1)}</td>
                  <td className="pl-2 text-right">{(s.dz * 12).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Reactions({ a, sel, def }: { a: BridgeAnalysis; sel: Selection; def: BridgeDefinition }) {
  const bearings = useMemo(() => a.bearings(sel), [a, sel]);
  const reactions = useMemo(() => a.reactions(sel), [a, sel]);
  const lines = def.supports.map((_, k) => k + 1);
  const lineName = (k: number) => (k === 1 ? "Abutment 1" : k === lines.length ? "Abutment 2" : `Pier ${k - 1}`);
  const girders = Array.from({ length: def.nGirders }, (_, k) => k + 1);
  const bases = reactions.filter((r) => r.node >= 400000 && r.node < 500000);
  const total = reactions.reduce((s, r) => s + r.R[2], 0);
  return (
    <Card>
      <CardContent className="space-y-4 py-3 text-xs">
        <div>
          <p className="pb-1 font-semibold">Bearing reactions, vertical (kip)</p>
          <div className="overflow-x-auto">
            <table className="w-full tabular-nums">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Support</th>
                  {girders.map((g) => (
                    <th key={g} className="px-2 text-right font-medium">
                      G{g}
                    </th>
                  ))}
                  <th className="pl-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((k) => {
                  const row = bearings.filter((b) => b.support === k);
                  return (
                    <tr key={k} className="border-b border-border/40">
                      <td className="py-0.5 pr-2">{lineName(k)}</td>
                      {girders.map((g) => (
                        <td key={g} className="px-2 text-right">
                          {fmt(row.find((b) => b.girder === g)?.vertical ?? 0, 1)}
                        </td>
                      ))}
                      <td className="pl-2 text-right font-medium">{fmt(row.reduce((s, b) => s + b.vertical, 0), 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {bases.length > 0 && (
          <div>
            <p className="pb-1 font-semibold">Pier column bases</p>
            <table className="w-full tabular-nums">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Column</th>
                  <th className="px-2 text-right font-medium">Vertical (kip)</th>
                  <th className="px-2 text-right font-medium">Along the bridge (kip)</th>
                  <th className="px-2 text-right font-medium">Across (kip)</th>
                  <th className="px-2 text-right font-medium">Moment about the bridge&apos;s axis (kip·ft)</th>
                  <th className="pl-2 text-right font-medium">Moment about the cross axis (kip·ft)</th>
                </tr>
              </thead>
              <tbody>
                {bases.map((r) => {
                  const line = Math.floor((r.node - 400000) / 1000);
                  return (
                    <tr key={r.node} className="border-b border-border/40">
                      <td className="py-0.5 pr-2">
                        Pier {line}, column {(r.node % 1000) + 1}
                      </td>
                      <td className="px-2 text-right">{fmt(r.R[2], 1)}</td>
                      <td className="px-2 text-right">{fmt(r.R[0], 1)}</td>
                      <td className="px-2 text-right">{fmt(r.R[1], 1)}</td>
                      <td className="px-2 text-right">{fmt(r.R[3], 1)}</td>
                      <td className="pl-2 text-right">{fmt(r.R[4], 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground">Total vertical reaction at the supports: {fmt(total, 1)} kip.</p>
      </CardContent>
    </Card>
  );
}

function Checks({ a }: { a: BridgeAnalysis }) {
  const p = a.generated.properties;
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-2 py-3 text-xs">
          <p className={cn("font-semibold", a.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600")}>{a.ok ? "Every load case is in equilibrium: the reactions equal the load applied." : "A load case is not in equilibrium: don't use these results."}</p>
          <table className="w-full tabular-nums">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Load case</th>
                <th className="px-2 font-medium">Type</th>
                <th className="px-2 font-medium">Acts on</th>
                <th className="px-2 text-right font-medium">Applied (kip)</th>
                <th className="px-2 text-right font-medium">Reactions (kip)</th>
                <th className="pl-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {a.checks.map((c, k) => (
                <tr key={c.name} className="border-b border-border/40">
                  <td className="py-0.5 pr-2">{c.name}</td>
                  <td className="px-2">{a.cases[k].type}</td>
                  <td className="px-2">{a.cases[k].stage === 1 ? "Girders alone, simple spans" : "Composite bridge"}</td>
                  <td className="px-2 text-right">{fmt(c.applied, 2)}</td>
                  <td className="px-2 text-right">{fmt(c.reactions, 2)}</td>
                  <td className={cn("pl-2 font-medium", c.ok ? "text-emerald-600" : "text-red-600")}>{c.ok ? "OK" : "NG"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <KeyValues
        title="Section properties used"
        rows={[
          ["Girder: A, I, yb", `${fmt(p.girder.A, 1)} in², ${fmt(p.girder.I, 0)} in⁴, ${fmt(p.girder.yb, 2)} in`],
          ["Girder weight", `${fmt(p.girder.weight, 3)} klf`],
          ["Ec, girder and deck (5.4.2.4)", `${fmt(p.Ec.girder, 0)} and ${fmt(p.Ec.deck, 0)} ksi (n = ${fmt(p.n, 3)})`],
          ["Composite, interior: effective width, I, yb", `${fmt(p.composite.interior.beff, 1)} in, ${fmt(p.composite.interior.I, 0)} in⁴, ${fmt(p.composite.interior.yb, 2)} in`],
          ["Composite, exterior: effective width, I, yb", `${fmt(p.composite.exterior.beff, 1)} in, ${fmt(p.composite.exterior.I, 0)} in⁴, ${fmt(p.composite.exterior.yb, 2)} in`],
        ]}
      />
      <p className="text-xs text-muted-foreground">
        The model is a grillage of beam elements, as midas Civil&apos;s girder bridge wizard builds its &ldquo;All Frame&rdquo; model: each girder a line of elements with the composite section&apos;s properties, deck strips between them, bearings as links to the
        abutments and pier caps. The girders alone carry their weight, the deck and the diaphragms on simple spans; the composite bridge carries the barriers and the wearing surface.
      </p>
    </div>
  );
}
