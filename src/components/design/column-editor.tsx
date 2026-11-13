"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { listPierCapDesigns, pierCapLink } from "@/app/actions/design";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { designColumn, type ColumnInputs, type ColumnLink } from "@/lib/design/piers/column";
import { DesignError } from "@/lib/design/walls/cip";
import { ColumnSketch } from "./column-sketch";
import { ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";
import { TakeoffPanel } from "./takeoff-panel";

// Designing a pier column: its loads from a pier cap's strut-and-tie design (or entered), the
// section, height and base, the loads along the bridge, and the optional vehicle collision on the
// left; the section and interaction diagram, the checks, and the bars and quantities on the right.

const sizes = [3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 18].map((b) => ({ value: b, label: `#${b}` }));
const groupOf = (id: string) =>
  id.startsWith("pm-") || id === "axial" ? "Axial load and bending" : id.startsWith("shear") ? "Shear" : id.startsWith("slender") ? "Slenderness" : id.startsWith("ct-") ? "Vehicle collision (Extreme Event II)" : id.startsWith("seis-") ? "Seismic Zone 1 hinge regions" : "Reinforcement";

function LoadsPanel({ inputs, onLink }: { inputs: ColumnInputs; onLink: (l: ColumnLink | null) => void }) {
  const [caps, setCaps] = useState<{ id: string; name: string; kind: string; columns: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (inputs.loads !== "stm" && inputs.link) return;
    if (caps) return;
    listPierCapDesigns()
      .then(setCaps)
      .catch(() => toast.error("Could not list the strut-and-tie designs"));
  }, [inputs.loads, inputs.link, caps]);
  const pick = async (id: string) => {
    setBusy(true);
    try {
      onLink(await pierCapLink(id));
      toast.success("The cap's load cases are in");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that design");
    } finally {
      setBusy(false);
    }
  };
  const l = inputs.link;
  return (
    <div className="space-y-1 text-xs">
      <div className="grid grid-cols-[1fr_auto] gap-1">
        <select value={l?.stmId ?? ""} onChange={(e) => (e.target.value ? void pick(e.target.value) : onLink(null))} className="h-7 rounded border border-input bg-transparent text-xs" disabled={!caps || busy} aria-label="Pier cap design">
          <option value="">{caps ? (caps.length ? "Pick a pier cap's strut-and-tie design" : "No pier cap designs yet") : "Loading…"}</option>
          {caps?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.kind === "hammerhead" ? "hammerhead" : `${d.columns}-column bent`})
            </option>
          ))}
        </select>
        <Button size="icon-sm" variant="outline" onClick={() => l && void pick(l.stmId)} disabled={!l || busy} title="Refresh from the cap's design" aria-label="Refresh">
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>
      {l && (
        <p className="text-[11px] text-muted-foreground">
          {l.kind === "hammerhead" ? "Hammerhead" : `${l.columns.length}-column bent`}, {l.cases.length} factored cases{l.wind ? " with wind" : ""}; cap {fmt(l.capLength)} ft long, {fmt(l.capDepth)} ft deep. {l.bridge ? `Bridge: ${l.bridge.names}, ${fmt(l.bridge.length)} ft, ${l.bridge.lanes} lanes.` : "No girder designs linked to the cap: nothing along the bridge from them."} Copied {new Date(l.refreshed).toLocaleDateString()}.
        </p>
      )}
    </div>
  );
}

function CasesEditor({ cases, onChange }: { cases: ColumnInputs["cases"]; onChange: (c: ColumnInputs["cases"]) => void }) {
  const cell = "h-6 w-full rounded border border-input bg-transparent px-1 text-right text-xs tabular-nums";
  const num = (k: number, key: "P" | "MT" | "ML" | "HT" | "HL") => <input type="number" className={cell} value={cases[k][key]} onChange={(e) => onChange(cases.map((c, j) => (j === k ? { ...c, [key]: Number(e.target.value) || 0 } : c)))} aria-label={key} />;
  return (
    <div className="space-y-1 text-xs">
      <p className="text-[11px] text-muted-foreground">Factored, at the column&apos;s top: P (kip), moments across (MT) and along (ML) the bridge (kip·ft), shears HT and HL (kip). The name&apos;s limit state (&quot;Strength I&quot;…) groups the checks.</p>
      {cases.map((c, k) => (
        <div key={k} className="space-y-1 rounded border border-border/60 p-1">
          <div className="flex gap-1">
            <input className="h-6 flex-1 rounded border border-input bg-transparent px-1 text-xs" value={c.name} onChange={(e) => onChange(cases.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))} aria-label="Case name" />
            <Button size="icon-sm" variant="ghost" onClick={() => onChange(cases.filter((_, j) => j !== k))} aria-label="Remove case">
              <X />
            </Button>
          </div>
          <div className="grid grid-cols-5 gap-1 text-[10px] text-muted-foreground">
            {(["P", "MT", "ML", "HT", "HL"] as const).map((key) => (
              <label key={key}>
                {key}
                {num(k, key)}
              </label>
            ))}
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...cases, { name: "Strength I", P: 0, MT: 0, ML: 0, HT: 0, HL: 0 }])}>
        <Plus /> Add a case
      </Button>
    </div>
  );
}

export function ColumnEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: ColumnInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof ColumnInputs>(key: K) => (v: ColumnInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const lg = inputs.longitudinal;
  const setLong = (patch: Partial<ColumnInputs["longitudinal"]>) => setInputs((s) => ({ ...s, longitudinal: { ...s.longitudinal, ...patch } }));
  const coll = inputs.collision;
  const setColl = (patch: Partial<ColumnInputs["collision"]>) => setInputs((s) => ({ ...s, collision: { ...s.collision, ...patch } }));

  const outcome = useMemo(() => {
    try {
      return { result: designColumn(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;
  const linked = inputs.loads === "stm" && !!inputs.link;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Pier Column · AASHTO LRFD 5.6.4" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Loads" open>
              <Choice label="Loads from" value={inputs.loads} options={[{ value: "stm", label: "A pier cap's strut-and-tie design" }, { value: "entered", label: "Entered" }]} onChange={(v) => set("loads")(v)} />
              {inputs.loads === "stm" ? (
                <LoadsPanel
                  inputs={inputs}
                  onLink={(l) =>
                    setInputs((s) => ({
                      ...s,
                      link: l,
                      loads: l ? "stm" : s.loads,
                      // A hammerhead's column is a cantilever both ways; a bent's sways across the bridge as a frame.
                      K: l && (!s.link || s.link.kind !== l.kind) ? (l.kind === "hammerhead" ? { T: 2.1, L: 2.1 } : { T: 1.2, L: 2.1 }) : s.K,
                      // A new cap: the column across the bridge as the cap was modeled on it.
                      ...(l?.columnWidth && (!s.link || s.link.stmId !== l.stmId) ? { T: Math.round(l.columnWidth * 12), ...(s.shape === "round" ? { W: Math.round(l.columnWidth * 12) } : {}) } : {}),
                    }))
                  }
                />
              ) : (
                <CasesEditor cases={inputs.cases} onChange={set("cases")} />
              )}
            </Section>
            <Section title="Column" open>
              <Choice label="Shape" value={inputs.shape} options={[{ value: "round", label: "Round" }, { value: "rectangular", label: "Rectangular" }, { value: "oblong", label: "Oblong (half-round ends)" }]} onChange={(v) => setInputs((s) => ({ ...s, shape: v, ...(v === "oblong" && s.T <= s.W ? { T: s.W * 2 } : {}), ...(v !== "round" && s.transverse === "spiral" && v === "rectangular" ? { transverse: "ties" as const } : {}) }))} />
              <Field label={inputs.shape === "round" ? "Diameter" : "Across the bridge (in the cap's plane)"} unit="in" value={inputs.T} onChange={set("T")} />
              {inputs.shape !== "round" && <Field label="Along the bridge" unit="in" value={inputs.W} onChange={set("W")} />}
              <Choice label="Bar size" value={inputs.bar} options={sizes.slice(2)} onChange={(v) => set("bar")(Number(v))} />
              {inputs.shape === "round" && <Field label="Bars" value={inputs.bars} onChange={(v) => set("bars")(Math.max(4, Math.round(v)))} />}
              {inputs.shape === "rectangular" && (
                <>
                  <Field label="Bars on each face across (corners incl.)" value={inputs.barsT} onChange={(v) => set("barsT")(Math.max(2, Math.round(v)))} />
                  <Field label="Bars on each face along (corners incl.)" value={inputs.barsL} onChange={(v) => set("barsL")(Math.max(2, Math.round(v)))} />
                </>
              )}
              {inputs.shape === "oblong" && (
                <>
                  <Field label="Bars on each straight face" value={inputs.barsT} onChange={(v) => set("barsT")(Math.max(1, Math.round(v)))} />
                  <Field label="Bars around each round end" value={inputs.barsEnd} onChange={(v) => set("barsEnd")(Math.max(0, Math.round(v)))} />
                </>
              )}
              <Field label="Clear cover to the ties or spiral" unit="in" value={inputs.cover} onChange={set("cover")} step={0.25} />
              <Choice label="Transverse" value={inputs.transverse} options={[...(inputs.shape !== "rectangular" ? [{ value: "spiral" as const, label: inputs.shape === "oblong" ? "Interlocking spirals" : "Spiral" }] : []), { value: "ties" as const, label: inputs.shape === "round" ? "Hoops" : "Ties" }]} onChange={(v) => set("transverse")(v)} />
              <Choice label="Spiral or tie bar" value={inputs.tieBar} options={sizes.slice(0, 4)} onChange={(v) => set("tieBar")(Number(v))} />
              <Field label={inputs.transverse === "spiral" ? "Pitch" : "Spacing"} unit="in" value={inputs.tieSpacing} onChange={set("tieSpacing")} step={0.5} />
              {inputs.transverse === "ties" && inputs.shape !== "round" && (
                <>
                  <Field label="Tie legs across the bridge" value={inputs.legsT} onChange={(v) => set("legsT")(Math.max(2, Math.round(v)))} hint="Legs resisting shear across; beyond 2 are cross-ties, restraining the faces along the bridge" />
                  <Field label="Tie legs along the bridge" value={inputs.legsL} onChange={(v) => set("legsL")(Math.max(2, Math.round(v)))} hint="Restraining the faces across the bridge: restrained bars no more than 24 in apart (5.10.4.3)" />
                </>
              )}
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
            </Section>
            <Section title="Height, base and slenderness" open>
              <Field label="Top of footing or shaft to the cap's soffit" unit="ft" value={inputs.height} onChange={set("height")} step={0.5} />
              <Field label="Ground above the base" unit="ft" value={inputs.ground} onChange={set("ground")} step={0.5} hint="Wind on the column above it; the excavation (M-206-2) below it" />
              {!linked && <Field label="Cap depth (the bars run into it)" unit="ft" value={inputs.capDepth} onChange={set("capDepth")} step={0.25} />}
              <Choice label="Base" value={inputs.base} options={[{ value: "footing", label: "Footing (fixed)" }, { value: "shaft", label: "Drilled shaft" }]} onChange={(v) => set("base")(v)} />
              {inputs.base === "shaft" && (
                <>
                  <Field label="Shaft diameter" unit="in" value={inputs.shaftD} onChange={set("shaftD")} />
                  <Field label="Top of shaft to its point of fixity" unit="ft" value={inputs.fixity} onChange={set("fixity")} step={0.5} />
                </>
              )}
              <Field label="K across the bridge (4.6.2.5)" value={inputs.K.T} onChange={(v) => set("K")({ ...inputs.K, T: v })} step={0.05} hint={linked && inputs.link!.kind !== "hammerhead" ? "A bent with a stiff cap, fixed bases: 1.2" : "A cantilever: 2.1"} />
              <Field label="K along the bridge" value={inputs.K.L} onChange={(v) => set("K")({ ...inputs.K, L: v })} step={0.05} hint="A cantilever: 2.1" />
            </Section>
            {linked && (
              <Section title="Along the bridge">
                <Choice label="Bearings on this pier" value={lg.bearings} options={[{ value: "fixed", label: "Fixed" }, { value: "expansion", label: "Expansion" }]} onChange={(v) => setLong({ bearings: v })} />
                {lg.bearings === "fixed" ? (
                  <>
                    <Field label="Share of the bridge's braking and wind" unit="%" value={lg.share * 100} onChange={(v) => setLong({ share: Math.max(0, Math.min(100, v)) / 100 })} hint="100% where this is the bridge's only fixed support" />
                    <Field label="Temperature change (3.12.2)" unit="°F" value={lg.dT} onChange={(v) => setLong({ dT: v })} />
                    <Field label="Pier from the point of no movement" unit="ft" value={lg.distance} onChange={(v) => setLong({ distance: v })} hint="0 where this pier is the bridge's only fixed support" />
                  </>
                ) : (
                  <Field label="Force the bearings pass along the bridge" unit="kip" value={lg.bearingForce} onChange={(v) => setLong({ bearingForce: v })} hint="Unfactored, the whole pier: an elastomeric pad's shear or a sliding bearing's friction" />
                )}
                <Field label="γTU" value={lg.gammaTU} onChange={(v) => setLong({ gammaTU: v })} step={0.05} hint="0.50 for force effects (Table 3.4.1-1)" />
              </Section>
            )}
            <Section title="Seismic Zone 1 (5.11.2)" open={inputs.seismic.hinge}>
              <Toggle label="SD1 ≥ 0.10: confine the hinge regions" value={inputs.seismic.hinge} onChange={(v) => setInputs((s) => ({ ...s, seismic: { ...s.seismic, hinge: v } }))} />
              {inputs.seismic.hinge && <Field label="Spacing in the hinge regions" unit="in" value={inputs.seismic.spacing} onChange={(v) => setInputs((s) => ({ ...s, seismic: { ...s.seismic, spacing: v } }))} step={0.5} hint="At most a quarter of the least dimension or 4 in (5.11.4.1.5)" />}
            </Section>
            <Section title="Vehicle collision (3.6.5.1)" open={coll.enabled}>
              <Toggle label="Check the 600 kip collision (Extreme Event II)" value={coll.enabled} onChange={(v) => setColl({ enabled: v })} />
              {coll.enabled && (
                <>
                  <Field label="Collision force" unit="kip" value={coll.CT} onChange={(v) => setColl({ CT: v })} />
                  <p className="text-[11px] text-muted-foreground">Checked at 2.0 and 5.0 ft above the ground, 0° and 15° to the roadway below (3.6.5.1).</p>
                  <Choice label="The roadway below runs" value={coll.traffic} options={[{ value: "T", label: "Across the bridge (in the cap's plane)" }, { value: "L", label: "Along the bridge" }]} onChange={(v) => setColl({ traffic: v })} />
                  {!linked && <Field label="Axial dead load on the column" unit="kip" value={coll.PDC} onChange={(v) => setColl({ PDC: v })} />}
                </>
              )}
            </Section>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {outcome.error ? (
            <DesignErrorCard message={outcome.error} />
          ) : (
            r && (
              <>
                <ChecksBanner checks={r.checks} />
                <Card>
                  <CardContent className="py-3">
                    <ColumnSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                <TakeoffPanel kind="pier-column" design={design} inputs={inputs} ok={r.checks.every((c) => c.advisory || c.ok)} onSettings={(t) => setInputs((s) => ({ ...s, takeoff: t }))} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <KeyValues
                    title="Slenderness"
                    rows={r.slender.map((s) => [`${s.ax === "T" ? "Across" : "Along"} the bridge: K ℓu / r`, `${fmt(s.ratio, 1)}${s.neglect ? " (< 22: neglected)" : ""}`] as [string, string]).concat([["Largest magnifier δs", `${fmt(Math.max(...r.rows.map((x) => Math.max(x.dT, x.dL))), 3)}`]])}
                  />
                  {linked && (
                    <KeyValues
                      title="Along the bridge, each column (unfactored)"
                      rows={[
                        ["Braking BR", `${fmt(r.long.BR, 1)} kip`],
                        ["Wind on the superstructure, III / V", `${fmt(r.long.WS3, 1)} / ${fmt(r.long.WS5, 1)} kip`],
                        ["Wind on the live load WL", `${fmt(r.long.WL, 1)} kip`],
                        ["Temperature TU", `${fmt(r.long.TU, 1)} kip`],
                      ]}
                    />
                  )}
                </div>
                {r.notes.length > 0 && (
                  <Card>
                    <CardContent className="space-y-1 py-3 text-xs text-muted-foreground">
                      {r.notes.map((n) => (
                        <p key={n}>{n}</p>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
