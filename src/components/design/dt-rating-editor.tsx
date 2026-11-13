"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, FileText, ImageIcon, Loader2, Plus, Trash2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { deleteDesignAttachments } from "@/app/actions/design";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BRR_TOLERANCE, brrInputSheet, brrTemplate, compareBrr, compareBrrDf } from "@/lib/design/rating/brr";
import { CHECK_LABEL, dtInputsFromBridgeFile, dtLayout, finalTension, rateDoubleTee, type DtInputs, type DtRating } from "@/lib/design/rating/double-tee";
import { applySia, type SiaReading } from "@/lib/design/rating/sia";
import { readSketchCallouts } from "@/lib/design/rating/sketch-callouts";
import { applyBrm, GEOMETRY_KEYS, INPUT_LABEL, missingInputs, setPath, withFileSources } from "@/lib/design/rating/sources";
import { applyStandard } from "@/lib/design/rating/dt-standard";
import { SourceLine, SrcField, SrcYesNo } from "./dt-fields";
import { DtStandardPanel } from "./dt-standard-panel";
import { readBrrFiles, readSiaFile, uploadSketch } from "./dt-files";
import { DtSectionSketch } from "./dt-section-sketch";
import { SiaDialog } from "./dt-sia-dialog";
import { SketchView } from "./dt-sketch-view";
import { DesignError } from "@/lib/design/walls/cip";
import { cn } from "@/lib/utils";
import { Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";

// Load rating of a double-tee bridge (LFR, CDOT): the bridge on the left, rated as it changes on the
// right (the prestress, every vehicle's rating and posting, each girder's, the BrR input sheet and
// the comparison with BrR's run), saved as you go.

const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "—");

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="grid grid-cols-[1fr_11rem] items-center gap-2 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 outline-none focus:ring-1 focus:ring-primary" />
    </label>
  );
}

function MiniNum({ value, onChange, label, w = "w-14" }: { value: number; onChange: (v: number) => void; label: string; w?: string }) {
  return <input type="number" aria-label={label} title={label} value={value} onChange={(e) => e.target.value !== "" && Number.isFinite(+e.target.value) && onChange(+e.target.value)} className={cn("h-7 rounded-md border border-input bg-transparent px-1 text-right tabular-nums", w)} />;
}

const postingClass =(p: string) => (p === "Posting required" ? "text-red-600 font-medium" : p.startsWith("Exempt") ? "text-amber-600" : "text-muted-foreground");

export function DtRatingEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: DtInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const deferred = useDeferredValue(inputs);
  const up = <K extends keyof DtInputs>(key: K) => (patch: Partial<DtInputs[K]>) => setInputs((s) => ({ ...s, [key]: { ...(s[key] as object), ...patch } }));
  const set = <K extends keyof DtInputs>(key: K) => (v: DtInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const bridge = up("bridge");
  const units = up("units");
  const loads = up("loads");
  const mat = up("materials");
  const opt = up("options");
  const ps = up("prestress");
  const fileRef = useRef<HTMLInputElement>(null);
  // A bridge input entered here: its value and "entered" as its source (a year built brings the BRM's materials).
  const setP = (path: string, v: unknown) =>
    setInputs((s) => {
      const o = setPath(s, path, v);
      return path === "bridge.yearBuilt" ? applyBrm(o) : o;
    });
  const confirmP = (path: string) => setInputs((s) => ({ ...s, sources: { ...s.sources, [path]: { kind: "confirmed", note: "Starting value confirmed" } } }));
  // A list of the bridge (sidewalks, utilities): changing it gives it a source.
  const setList = (path: "loads.sidewalks" | "loads.utilities", v: unknown) => setInputs((s) => setPath(s, path, v));
  // The unit layout: widths and stem spacing are separate facts (the callouts give the widths only).
  const setLayout = (k: number, field: "flangeWidth" | "stemSpacing", v: number) =>
    setInputs((s) => {
      const lay = Array.from({ length: s.units.count }, (_, j) => ({ ...(s.units.layout?.[j] ?? { flangeWidth: s.units.flangeWidth, stemSpacing: s.units.stemSpacing }), ...(j === k ? { [field]: v } : {}) }));
      const o = setPath(s, "units.layout", lay, field === "flangeWidth" ? { kind: "entered" } : (s.sources["units.layout"] ?? null));
      if (field === "stemSpacing") o.sources["units.layoutStems"] = { kind: "entered" };
      return o;
    });

  const i = inputs;
  // Nothing is rated until every input the rating needs has a source; the section is drawn once the geometry has.
  const missing = useMemo(() => missingInputs(deferred), [deferred]);
  const geometryMissing = missing.filter((k) => GEOMETRY_KEYS.has(k));
  const outcome = useMemo(() => {
    if (missing.length) return { r: null, error: null };
    try {
      return { r: rateDoubleTee(deferred), error: null };
    } catch (err) {
      return { r: null, error: err instanceof DesignError ? err.message : "These inputs can't be rated" };
    }
  }, [deferred, missing]);
  const r = outcome.r;
  const layout = useMemo(() => {
    if (geometryMissing.length) return null;
    try {
      return dtLayout(deferred);
    } catch {
      return null;
    }
  }, [deferred, geometryMissing.length]);

  const importFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      setInputs(withFileSources({ ...dtInputsFromBridgeFile(json), brrResults: inputs.brrResults, sketch: inputs.sketch }, file.name));
      toast.success(`Read ${file.name}`);
    } catch {
      toast.error("That isn't a bridge input file");
    }
  };

  // The SIA: read here (never uploaded), its values picked in a dialog.
  const siaRef = useRef<HTMLInputElement>(null);
  const [sia, setSia] = useState<{ reading: SiaReading; file: string } | null>(null);
  const [busy, setBusy] = useState<"sia" | "sketch" | null>(null);
  const readSia = async (file: File) => {
    setBusy("sia");
    try {
      setSia({ reading: await readSiaFile(file), file: file.name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that SIA");
    } finally {
      setBusy(null);
    }
  };

  // The inspection sketch: its pages stored as pictures under the design.
  const sketchRef = useRef<HTMLInputElement>(null);
  const dropFiles = (keys: string[]) => {
    // Once the inputs without them are saved (the header saves after a pause).
    if (keys.length) setTimeout(() => void deleteDesignAttachments(design.id, keys).catch(() => {}), 4000);
  };
  const attachSketch = async (file: File) => {
    setBusy("sketch");
    try {
      const sketch = await uploadSketch(design.id, file);
      const old = inputs.sketch?.pages.map((p) => p.key) ?? [];
      set("sketch")(sketch);
      dropFiles(old);
      // Its callouts, if it has text: offered like the SIA's values.
      const read = sketch.text ? readSketchCallouts(sketch.text, sketch.name, inputs) : null;
      if (read?.values.length) setSia({ reading: read, file: sketch.name });
      toast.success(`Attached ${file.name}${read?.values.length ? `: ${read.values.length} values read from its callouts` : sketch.text ? "" : " (no text, so no callouts to read)"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not attach the sketch");
    } finally {
      setBusy(null);
    }
  };
  const removeSketch = () => {
    const old = inputs.sketch?.pages.map((p) => p.key) ?? [];
    set("sketch")(null);
    dropFiles(old);
  };

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Double-Tee Load Rating" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <p className="text-xs text-muted-foreground">LFR · AASHTO Standard Specs 17th ed., MBE 6B, CDOT BRM</p>
            <div className="flex flex-wrap items-center gap-1 border-b py-2 text-xs">
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => (e.target.files?.[0] && void importFile(e.target.files[0]), (e.target.value = ""))} />
              <input ref={siaRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => (e.target.files?.[0] && void readSia(e.target.files[0]), (e.target.value = ""))} />
              <input ref={sketchRef} type="file" accept=".pdf,application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => (e.target.files?.[0] && void attachSketch(e.target.files[0]), (e.target.value = ""))} />
              <Button size="sm" variant="outline" onClick={() => siaRef.current?.click()} disabled={!!busy} title="Read the bridge's inventory items from its SIA report (PDF). The file stays on this computer.">
                {busy === "sia" ? <Loader2 className="animate-spin" /> : <FileText />} From SIA
              </Button>
              <Button size="sm" variant="outline" onClick={() => sketchRef.current?.click()} disabled={!!busy} title="Attach the inspection sketch (PDF or picture) to show beside the inputs">
                {busy === "sketch" ? <Loader2 className="animate-spin" /> : <ImageIcon />} {i.sketch ? "Replace sketch" : "Attach sketch"}
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => fileRef.current?.click()} title="Read a bridge input file (JSON) from the rating scripts">
                <Upload /> Bridge file
              </Button>
            </div>
            <Section title="Bridge" open>
              <TextField label="Structure number" value={i.bridge.id} onChange={(v) => bridge({ id: v })} />
              <TextField label="Facility carried" value={i.bridge.facility} onChange={(v) => bridge({ facility: v })} />
              <TextField label="Feature intersected" value={i.bridge.feature} onChange={(v) => bridge({ feature: v })} />
              <TextField label="Owner" value={i.bridge.owner} onChange={(v) => bridge({ owner: v })} />
              <SrcField i={i} path="bridge.yearBuilt" label="Year built" onSet={setP} onConfirm={confirmP} transform={Math.round} hint="Sets the materials of the era from the BRM's tables" />
              <TextField label="Inspection" value={i.bridge.inspection} onChange={(v) => bridge({ inspection: v })} placeholder="Report and date" />
              <TextField label="Rater" value={i.bridge.rater} onChange={(v) => bridge({ rater: v })} />
              <TextField label="Checker" value={i.bridge.checker} onChange={(v) => bridge({ checker: v })} />
              <Toggle label="Within 1 mile of an Interstate (EV posting)" value={i.bridge.nearInterstate} onChange={(v) => bridge({ nearInterstate: v })} />
            </Section>
            <Section title="Span" open>
              <SrcField i={i} path="span" label="Span (bearing to bearing)" unit="ft" step={0.25} onSet={setP} onConfirm={confirmP} />
              <SrcField i={i} path="structureLength" label="Structure (girder) length" unit="ft" step={0.25} onSet={setP} onConfirm={confirmP} />
              <SrcField i={i} path="numSpans" label="Identical simple spans" onSet={setP} onConfirm={confirmP} transform={(v) => Math.max(1, Math.round(v))} />
              <SrcField i={i} path="skew" label="Skew" unit="°" onSet={setP} onConfirm={confirmP} hint="Entered in BrR; no LFD moment reduction" />
            </Section>
            <Section title="Double-tee units" open>
              <SrcField i={i} path="units.count" label="Number of units" onSet={setP} onConfirm={confirmP} transform={(v) => Math.max(2, Math.round(v))} />
              <Toggle
                label="Units differ (widths, stem spacing)"
                value={!!i.units.layout}
                onChange={(v) =>
                  setInputs((s) => {
                    const o = setPath(s, "units.layout", v ? Array.from({ length: s.units.count }, () => ({ flangeWidth: s.units.flangeWidth, stemSpacing: s.units.stemSpacing })) : null, null);
                    delete o.sources["units.layoutStems"];
                    return o;
                  })
                }
              />
              {i.units.layout ? (
                <>
                  <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-1 pt-1 text-[11px] text-muted-foreground">
                    <span>Unit</span>
                    <span>Flange width, in</span>
                    <span>Stem spacing, in</span>
                  </div>
                  {Array.from({ length: i.units.count }, (_, k) => i.units.layout![k] ?? { flangeWidth: i.units.flangeWidth, stemSpacing: i.units.stemSpacing }).map((x, k) => (
                    <div key={k} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-1 py-0.5 text-xs">
                      <span className="text-muted-foreground">G{k + 1}</span>
                      <MiniNum label={`G${k + 1} flange width`} w={cn("w-full", !i.sources["units.layout"] && "border-amber-400")} value={x.flangeWidth} onChange={(v) => setLayout(k, "flangeWidth", v)} />
                      <MiniNum label={`G${k + 1} stem spacing`} w={cn("w-full", !i.sources["units.layoutStems"] && "border-amber-400")} value={x.stemSpacing} onChange={(v) => setLayout(k, "stemSpacing", v)} />
                    </div>
                  ))}
                  <div className="space-y-0.5 pb-1">
                    <span className="block text-[10.5px] text-muted-foreground">Unit widths:</span>
                    <SourceLine i={i} path="units.layout" onConfirm={() => confirmP("units.layout")} />
                    <span className="block text-[10.5px] text-muted-foreground">Stem spacing in each unit:</span>
                    <SourceLine i={i} path="units.layoutStems" onConfirm={() => confirmP("units.layoutStems")} />
                  </div>
                  <Field label="Joint between units" unit="in" value={i.units.jointGap} onChange={(v) => units({ jointGap: v })} step={0.25} />
                </>
              ) : (
                <>
                  <SrcField i={i} path="units.spacing" label="Spacing (unit CL to CL)" unit="in" onSet={setP} onConfirm={confirmP} />
                  <SrcField i={i} path="units.flangeWidth" label="Flange width" unit="in" onSet={setP} onConfirm={confirmP} />
                  <SrcField i={i} path="units.stemSpacing" label="Stem spacing (CL to CL)" unit="in" onSet={setP} onConfirm={confirmP} />
                  <Toggle label="Exterior flanges trimmed at the outer stem" value={i.units.exteriorTrimmed} onChange={(v) => units({ exteriorTrimmed: v })} />
                </>
              )}
              <SrcField i={i} path="units.depth" label="Depth (precast)" unit="in" onSet={setP} onConfirm={confirmP} hint="Stem plus the precast flange" />
              <SrcField i={i} path="units.flangeThk" label="Flange thickness" unit="in" step={0.25} onSet={setP} onConfirm={confirmP} />
              <SrcField i={i} path="units.stemTop" label="Stem width, top" unit="in" step={0.25} onSet={setP} onConfirm={confirmP} />
              <SrcField i={i} path="units.stemBot" label="Stem width, bottom" unit="in" step={0.25} onSet={setP} onConfirm={confirmP} />
            </Section>
            <Section title="Deck or topping" open>
              <SrcYesNo i={i} path="deck.present" label="Composite CIP deck or topping" onSet={setP} onConfirm={confirmP} />
              {i.deck.present && (
                <>
                  <SrcField i={i} path="deck.thk" label="Thickness" unit="in" step={0.25} onSet={setP} onConfirm={confirmP} hint="The CIP topping only: the precast flange is part of the double tee" />
                  <SrcField i={i} path="deck.fc" label="f′c" unit="ksi" step={0.5} onSet={setP} onConfirm={confirmP} />
                  <Field label="Unit weight (CDOT method)" unit="pcf" value={i.deck.pcf} onChange={(v) => setInputs((s) => ({ ...s, deck: { ...s.deck, pcf: v } }))} />
                </>
              )}
            </Section>
            <Section title="Roadway" open>
              <SrcField i={i} path="roadway.railToRail" label="Width, rail to rail (out to out)" unit="ft" step={0.25} onSet={setP} onConfirm={confirmP} />
              <SrcField i={i} path="roadway.railFaceOffset" label="Rail face in from the edge" unit="in" onSet={setP} onConfirm={confirmP} />
              {i.loads.sidewalks.length > 0 && (
                <>
                  <SrcField i={i} path="roadway.curbToCurb" label="Curb to curb" unit="ft" step={0.25} onSet={setP} onConfirm={confirmP} />
                  <SrcField i={i} path="roadway.curbFaceOffset" label="Curb face in from the edge" unit="in" onSet={setP} onConfirm={confirmP} />
                </>
              )}
            </Section>
            <Section title="Dead loads and sidewalks" open>
              <SrcField i={i} path="loads.asphalt" label="Asphalt" unit="in" step={0.5} onSet={setP} onConfirm={confirmP} />
              <SrcField i={i} path="loads.railKlf" label="Rail, each side" unit="klf" step={0.005} onSet={setP} onConfirm={confirmP} />
              <SrcField i={i} path="loads.diaphragmKip" label="Diaphragms, per girder at midspan (0: none)" unit="kip" step={0.1} onSet={setP} onConfirm={confirmP} />
              <Field label="Asphalt unit weight (CDOT method)" unit="pcf" value={i.loads.asphaltPcf} onChange={(v) => loads({ asphaltPcf: v })} />
              <Field label="Girder concrete for dead load (CDOT method)" unit="pcf" value={i.loads.concPcf} onChange={(v) => loads({ concPcf: v })} />
              <div className="flex items-center justify-between pt-2 text-xs">
                <span className="font-medium">Sidewalks and curbs</span>
                <span className="flex gap-1">
                  {!i.sources["loads.sidewalks"] && !i.loads.sidewalks.length && (
                    <Button size="xs" variant="outline" className="border-amber-400" onClick={() => setList("loads.sidewalks", [])}>
                      None on this bridge
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={() => setList("loads.sidewalks", [...i.loads.sidewalks, { width: 5, thk: 8 }])} disabled={i.loads.sidewalks.length >= 2}>
                    <Plus /> Add
                  </Button>
                </span>
              </div>
              <SourceLine i={i} path="loads.sidewalks" onConfirm={() => confirmP("loads.sidewalks")} />
              {i.loads.sidewalks.map((s, k) => (
                <div key={k} className="flex items-center gap-1 py-0.5 text-xs">
                  <span className="w-14 text-muted-foreground">Side {k + 1}</span>
                  <MiniNum label="Width, ft" value={s.width} onChange={(v) => setList("loads.sidewalks", i.loads.sidewalks.map((x, j) => (j === k ? { ...x, width: v } : x)))} />
                  <span className="text-muted-foreground">ft ×</span>
                  <MiniNum label="Thickness, in" value={s.thk} onChange={(v) => setList("loads.sidewalks", i.loads.sidewalks.map((x, j) => (j === k ? { ...x, thk: v } : x)))} />
                  <span className="text-muted-foreground">in</span>
                  <select
                    aria-label={`Side ${k + 1}: sidewalk or curb`}
                    value={s.curb ? "curb" : "sidewalk"}
                    onChange={(e) => setList("loads.sidewalks", i.loads.sidewalks.map((x, j) => (j === k ? { width: x.width, thk: x.thk, ...(e.target.value === "curb" ? { curb: true } : {}) } : x)))}
                    className="h-6 rounded border border-input bg-transparent px-1"
                    title="A curb carries dead load only: no pedestrians, and trucks can't mount it"
                  >
                    <option value="sidewalk">Sidewalk</option>
                    <option value="curb">Curb</option>
                  </select>
                  <Button size="icon-xs" variant="ghost" aria-label="Remove the sidewalk or curb" onClick={() => setList("loads.sidewalks", i.loads.sidewalks.filter((_, j) => j !== k))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {i.loads.sidewalks.some((s) => !s.curb) && (
                <>
                  <Field label="Width carrying pedestrians (0: the sidewalks')" unit="ft" value={i.loads.pedWidth} onChange={(v) => loads({ pedWidth: v })} step={0.5} />
                  <Toggle label="Mountable (also rate trucks on the sidewalk)" value={i.loads.sidewalkMountable} onChange={(v) => loads({ sidewalkMountable: v })} />
                  <Toggle label="Pedestrian load with trucks curb to curb (SSHB 3.14)" value={i.loads.pedestrians} onChange={(v) => loads({ pedestrians: v })} />
                </>
              )}
              <div className="flex items-center justify-between pt-2 text-xs">
                <span className="font-medium">Utilities</span>
                <span className="flex gap-1">
                  {!i.sources["loads.utilities"] && !i.loads.utilities.length && (
                    <Button size="xs" variant="outline" className="border-amber-400" onClick={() => setList("loads.utilities", [])}>
                      None on this bridge
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={() => setList("loads.utilities", [...i.loads.utilities, { desc: "Utility", klf: 0.01, unit: 1 }])}>
                    <Plus /> Add
                  </Button>
                </span>
              </div>
              <SourceLine i={i} path="loads.utilities" onConfirm={() => confirmP("loads.utilities")} />
              {i.loads.utilities.map((x, k) => (
                <div key={k} className="flex items-center gap-1 py-0.5 text-xs">
                  <input value={x.desc} aria-label="Utility" onChange={(e) => setList("loads.utilities", i.loads.utilities.map((y, j) => (j === k ? { ...y, desc: e.target.value } : y)))} className="h-7 w-24 min-w-0 rounded-md border border-input bg-transparent px-1" />
                  <MiniNum label="Weight, klf" value={x.klf} onChange={(v) => setList("loads.utilities", i.loads.utilities.map((y, j) => (j === k ? { ...y, klf: v } : y)))} />
                  <span className="text-muted-foreground">klf on G</span>
                  <MiniNum label="Girder" w="w-10" value={x.unit} onChange={(v) => setList("loads.utilities", i.loads.utilities.map((y, j) => (j === k ? { ...y, unit: Math.round(v) } : y)))} />
                  <Button size="icon-xs" variant="ghost" aria-label="Remove the utility" onClick={() => setList("loads.utilities", i.loads.utilities.filter((_, j) => j !== k))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </Section>
            <Section title="Materials" open>
              <p className="pb-1 text-[11px] text-muted-foreground">Filled from the BRM&apos;s tables once the year built is known; change any you know better.</p>
              <SrcField i={i} path="materials.fc" label="Girder f′c" unit="ksi" step={0.5} onSet={setP} onConfirm={confirmP} />
              <Field label="Girder f′ci" unit="ksi" value={i.materials.fci} onChange={(v) => mat({ fci: v })} step={0.5} />
              <TextField label="Strand" value={i.materials.strand} onChange={(v) => setP("materials.strand", v)} />
              <SourceLine i={i} path="materials.strand" onConfirm={() => confirmP("materials.strand")} />
              <SrcField i={i} path="materials.fpu" label="f′s (fpu)" unit="ksi" onSet={setP} onConfirm={confirmP} />
              <SrcField i={i} path="materials.aps" label="Strand area" unit="in²" step={0.001} onSet={setP} onConfirm={confirmP} />
              <Toggle label="Low relaxation" value={i.materials.lowRelaxation} onChange={(v) => mat({ lowRelaxation: v })} />
              <Field label="γ* (SSHB 9.17, CDOT method)" value={i.materials.gammaStar} onChange={(v) => mat({ gammaStar: v })} step={0.05} />
              <Field label="Jacking ratio fpj/f′s (CDOT method)" value={i.materials.jackingRatio} onChange={(v) => mat({ jackingRatio: v })} step={0.01} />
            </Section>
            <Section title="Prestress" open>
              <DtStandardPanel
                i={i}
                onApply={(r) => setInputs((s) => applyStandard(s, r))}
                onBackCalculate={() => setInputs((s) => ({ ...s, prestress: { ...s.prestress, mode: "back-calculate", harp: null }, options: { ...s.options, tensionLimit: 1 } }))}
              />
              <Choice
                label="Prestress"
                value={i.prestress.mode}
                options={[
                  { value: "back-calculate", label: "Back-calculate (no plans)" },
                  { value: "known", label: "Known strands" },
                ]}
                onChange={(v) => ps({ mode: v })}
              />
              {i.prestress.mode === "known" ? (
                <SrcField i={i} path="prestress.strands" label="Strands per unit" step={0.001} onSet={setP} onConfirm={confirmP} />
              ) : (
                <>
                  <Toggle label="Whole strands (force rounded down to the kip)" value={i.options.roundStrands} onChange={(v) => opt({ roundStrands: v })} />
                  <Toggle label="Asphalt in place while solving" value={i.options.solveWithOverlay} onChange={(v) => opt({ solveWithOverlay: v })} />
                  <Choice
                    label="Solve"
                    value={i.options.solveAt}
                    options={[
                      { value: "points", label: "Over the points (as BrR)" },
                      { value: "midspan", label: "At midspan (hand method)" },
                    ]}
                    onChange={(v) => opt({ solveAt: v })}
                  />
                </>
              )}
              <Field label="Strands per row per stem" value={i.materials.strandsPerRowPerStem} onChange={(v) => mat({ strandsPerRowPerStem: Math.max(1, Math.round(v)) })} />
              <Field label="First row from the bottom" unit="in" value={i.materials.firstRow} onChange={(v) => mat({ firstRow: v })} step={0.25} />
              <Field label="Row spacing" unit="in" value={i.materials.rowSpacing} onChange={(v) => mat({ rowSpacing: v })} step={0.25} />
              <Field label="Losses, lump sum (SSHB 9.16.2.2)" unit="ksi" value={i.options.lossLumpSum} onChange={(v) => opt({ lossLumpSum: v })} />
            </Section>
            <Section title="Rating options">
              <Choice
                label="Interior distribution"
                value={i.options.lldfInterior}
                options={[
                  { value: "table", label: "Table 3.23.1 (S/7.0, S/5.5)" },
                  { value: "sd", label: "Multi-beam S/D (3.23.4.3)" },
                ]}
                onChange={(v) => opt({ lldfInterior: v })}
              />
              <Choice
                label="Legal and permit vehicles"
                value={i.options.legalLldf}
                options={[
                  { value: "single", label: "Single-lane DF" },
                  { value: "multi", label: "Multi-lane DF" },
                ]}
                onChange={(v) => opt({ legalLldf: v })}
              />
              <Choice
                label="Final tension limit, girder"
                value={i.options.ignoreTension && i.prestress.mode === "back-calculate" ? "ignored" : i.options.tensionLimit === null ? "code" : i.options.tensionLimit === 1 ? "brm" : "entered"}
                options={[
                  ...(i.prestress.mode === "back-calculate" ? [{ value: "ignored", label: "Ignored (strength governs, BRM 1.7.2)" }] : []),
                  { value: "brm", label: "1 ksi (strength governs, BRM 1.7.2)" },
                  { value: "code", label: `6√f′c (${finalTension({ ...i, options: { ...i.options, tensionLimit: null } }).toFixed(3)} ksi)` },
                  { value: "entered", label: "Entered" },
                ]}
                onChange={(v) =>
                  opt(
                    v === "ignored"
                      ? { ignoreTension: true }
                      : { ignoreTension: false, tensionLimit: v === "code" ? null : v === "brm" ? 1 : finalTension(i) === 1 ? 0.8 : finalTension(i) },
                  )
                }
              />
              {!(i.options.ignoreTension && i.prestress.mode === "back-calculate") && i.options.tensionLimit !== null && i.options.tensionLimit !== 1 && (
                <Field label="Final tension, entered" unit="ksi" value={i.options.tensionLimit} onChange={(v) => opt({ tensionLimit: v })} step={0.05} />
              )}
              <Choice
                label="Points of interest"
                value={i.options.poi}
                options={[
                  { value: "tenth", label: "Tenth points" },
                  { value: "tenth-and-max", label: "Tenth points and each vehicle's max" },
                ]}
                onChange={(v) => opt({ poi: v })}
              />
              <Toggle label="Distribution factor overrides" value={!!i.options.dfOverride} onChange={(v) => opt({ dfOverride: v && r ? { intSingle: r.df.int.single.DF, intMulti: r.df.int.multi.DF, extSingle: r.df.ext.single.DF, extMulti: r.df.ext.multi.DF } : null })} />
              {i.options.dfOverride && (
                <>
                  <Field label="Interior, single lane" value={i.options.dfOverride.intSingle} onChange={(v) => opt({ dfOverride: { ...i.options.dfOverride!, intSingle: v } })} step={0.01} />
                  <Field label="Interior, multi lane" value={i.options.dfOverride.intMulti} onChange={(v) => opt({ dfOverride: { ...i.options.dfOverride!, intMulti: v } })} step={0.01} />
                  <Field label="Exterior, single lane" value={i.options.dfOverride.extSingle} onChange={(v) => opt({ dfOverride: { ...i.options.dfOverride!, extSingle: v } })} step={0.01} />
                  <Field label="Exterior, multi lane" value={i.options.dfOverride.extMulti} onChange={(v) => opt({ dfOverride: { ...i.options.dfOverride!, extMulti: v } })} step={0.01} />
                </>
              )}
              <Toggle label="Rate shear (SSHB 9.20; waived per BRM 1.4(O))" value={i.options.checkShear} onChange={(v) => opt({ checkShear: v })} />
              {i.options.checkShear && (
                <>
                  <Choice label="Stirrup bar" value={i.options.stirrups.bar} options={[3, 4, 5].map((b) => ({ value: b, label: `#${b}` }))} onChange={(v) => opt({ stirrups: { ...i.options.stirrups, bar: v } })} />
                  <Field label="Legs per stem" value={i.options.stirrups.legs} onChange={(v) => opt({ stirrups: { ...i.options.stirrups, legs: Math.max(1, Math.round(v)) } })} />
                  <Field label="Spacing" unit="in" value={i.options.stirrups.spacing} onChange={(v) => opt({ stirrups: { ...i.options.stirrups, spacing: v } })} />
                  <Field label="fy" unit="ksi" value={i.options.stirrups.fy} onChange={(v) => opt({ stirrups: { ...i.options.stirrups, fy: v } })} />
                </>
              )}
            </Section>
            <Section title="Condition and review">
              <label className="block py-1 text-xs">
                <span className="text-muted-foreground">Items for review (one per line)</span>
                <textarea value={i.review.items.join("\n")} onChange={(e) => up("review")({ items: e.target.value.split("\n") })} rows={4} className="mt-1 w-full rounded-md border border-input bg-transparent p-2 text-xs" />
              </label>
              <label className="block py-1 text-xs">
                <span className="text-muted-foreground">Main assumption</span>
                <textarea value={i.review.assumption} onChange={(e) => up("review")({ assumption: e.target.value })} rows={2} className="mt-1 w-full rounded-md border border-input bg-transparent p-2 text-xs" />
              </label>
            </Section>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {(layout || i.sketch) && (
            <div className={cn("grid gap-4", i.sketch && layout && "xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
              {i.sketch && (
                <SketchView
                  designId={design.id}
                  sketch={i.sketch}
                  onRemove={removeSketch}
                  onReadCallouts={
                    i.sketch.text?.length
                      ? () => {
                          const read = readSketchCallouts(i.sketch!.text!, i.sketch!.name, inputs);
                          if (read.values.length) setSia({ reading: read, file: i.sketch!.name });
                          else toast.info("No labeled callouts found on this sketch");
                        }
                      : undefined
                  }
                />
              )}
              {layout && (
                <Card className="self-start">
                  <CardContent className="py-3">
                    <DtSectionSketch inputs={deferred} layout={layout} cg={r ? r.solve.cg : null} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
          {missing.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1">
                <span className="font-medium">
                  {missing.length} input{missing.length === 1 ? "" : "s"} still needed before the bridge is rated
                  {geometryMissing.length ? " and its section drawn" : ""}:
                </span>{" "}
                {missing.map((k) => INPUT_LABEL[k] ?? k).join(", ")}.{" "}
                <span className="text-amber-800/90 dark:text-amber-300/90">
                  {i.blankStart ? "Use From SIA and the sketch's callouts, then enter the rest from the sketch (each field shows where its value came from)." : "These are still the old starting values: confirm each, or change it, in the form."}
                </span>
              </span>
            </div>
          )}
          {outcome.error ? <DesignErrorCard message={outcome.error} /> : r && <Results i={deferred} r={r} brr={i.brrResults} setBrr={set("brrResults")} df={i.brrDf} setDf={set("brrDf")} />}
        </div>
      </div>
      {sia && (
        <SiaDialog
          reading={sia.reading}
          file={sia.file}
          inputs={inputs}
          onClose={() => setSia(null)}
          onApply={(chosen) => {
            setInputs((s) => applySia(s, sia.reading, chosen));
            setSia(null);
            toast.success(`Used ${chosen.length} value${chosen.length === 1 ? "" : "s"} from the SIA`);
          }}
        />
      )}
    </div>
  );
}

function Results({ i, r, brr, setBrr, df, setDf }: { i: DtInputs; r: DtRating; brr: string; setBrr: (v: string) => void; df: DtInputs["brrDf"]; setDf: (v: DtInputs["brrDf"]) => void }) {
  const dfRows = compareBrrDf({ ...i, brrDf: df }, r);
  const brrRef = useRef<HTMLInputElement>(null);
  const [readingBrr, setReadingBrr] = useState(false);
  const readBrr = async (files: File[]) => {
    if (files.length > 2) return void toast.error("Pick one BrR report, or two for the two sidewalk models");
    setReadingBrr(true);
    try {
      setBrr(await readBrrFiles(files));
      toast.success(`Read ${files.map((f) => f.name).join(" and ")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read the BrR report");
    } finally {
      setReadingBrr(false);
    }
  };
  const [vehicle, setVehicle] = useState("HS-20");
  const s = r.solve;
  const hs = r.ratings.find((x) => x.cls === "design")!;
  const posted = r.ratings.filter((x) => x.posting === "Posting required");
  const exempt = r.ratings.filter((x) => x.posting.startsWith("Exempt"));
  const hsService = hs.govInv.inv.check !== "flexure" && hs.govInv.inv.check !== "shear";
  const sel = r.ratings.find((x) => x.name === vehicle) ?? hs;
  const sheet = useMemo(() => brrInputSheet(i, r), [i, r]);
  const cmp = useMemo(() => {
    if (!brr.trim()) return null;
    try {
      return { c: compareBrr(r, brr), error: null };
    } catch (e) {
      return { c: null, error: e instanceof Error ? e.message : "Can't read the table" };
    }
  }, [r, brr]);

  return (
    <>
      <div className={cn("flex items-start gap-2 rounded-lg border px-4 py-3 text-sm", posted.length ? "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200" : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200")}>
        {posted.length ? <XCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
        <span>
          {posted.length ? `Posting required (BRM 1.15.1): ${posted.map((x) => `${x.name} ${x.oprTons.toFixed(1)} T`).join(", ")}.` : "No posting required (BRM 1.15.1)."}
          {exempt.length > 0 && ` Exempt by the 95% rule: ${exempt.map((x) => x.name).join(", ")}.`} HS-20 inventory {f3(hs.govInv.inv.inv)} ({hs.govInv.g}), operating {f3(hs.govOpr.opr.opr)}.
        </span>
      </div>
      {s.mode === "back-calculate" && hsService && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {CHECK_LABEL[hs.govInv.inv.check]} governs HS-20 inventory ({f3(hs.govInv.inv.inv)} on {hs.govInv.g} at {f2(hs.govInv.inv.x)} ft), not flexure, with the final tension limit at {finalTension(i).toFixed(3)} ksi. BrR will report the same.{" "}
            {s.mode === "back-calculate"
              ? "With a back-calculated prestress that defeats the back-calculation (BRM 1.7.2 sets the prestress by strength): under Rating options, set the final tension limit to Ignored."
              : "Accept the service rating, or check the tension limit."}
          </span>
        </div>
      )}

      <Card>
        <CardContent className="overflow-x-auto py-2">
          <p className="pb-1 text-xs font-semibold">Ratings, every girder and point (MBE 6B.4.1, 6B.5.3)</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 font-normal">Vehicle</th>
                <th className="text-right font-normal">Weight, T</th>
                <th className="pl-3 text-right font-normal">Inv RF</th>
                <th className="text-right font-normal">Inv T</th>
                <th className="pl-3 text-right font-normal">Opr RF</th>
                <th className="text-right font-normal">Opr T</th>
                <th className="pl-3 font-normal">Governs (operating)</th>
                <th className="pl-3 font-normal">Posting</th>
              </tr>
            </thead>
            <tbody>
              {r.ratings.map((x) => (
                <tr key={x.name} className={cn("cursor-pointer border-b border-border/50 hover:bg-muted/50", x.name === sel.name && "bg-muted/60")} onClick={() => setVehicle(x.name)}>
                  <td className="py-1 pr-2 whitespace-nowrap">{x.name}</td>
                  <td className="text-right tabular-nums">{fmt(x.tons, 2)}</td>
                  <td className="pl-3 text-right tabular-nums">{f3(x.govInv.inv.inv)}</td>
                  <td className="text-right tabular-nums">{x.invTons.toFixed(1)}</td>
                  <td className="pl-3 text-right tabular-nums">{f3(x.govOpr.opr.opr)}</td>
                  <td className="text-right tabular-nums">{x.oprTons.toFixed(1)}</td>
                  <td className="pl-3 whitespace-nowrap text-muted-foreground">
                    {x.govOpr.g}, {CHECK_LABEL[x.govOpr.opr.check].split(" (")[0].toLowerCase()} at {f2(x.govOpr.opr.x)} ft
                  </td>
                  <td className={cn("pl-3 whitespace-nowrap", postingClass(x.posting))}>{x.posting}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pt-2 text-[11px] text-muted-foreground">Click a vehicle for each girder&apos;s ratings. Impact {f3(r.impact)}; {r.pois.length} points of interest.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto py-2">
          <p className="pb-1 text-xs font-semibold">{sel.name}, by girder</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 font-normal">Girder</th>
                <th className="text-right font-normal">DF</th>
                <th className="pl-3 text-right font-normal">Inv RF</th>
                <th className="pl-2 font-normal">check, x</th>
                <th className="pl-3 text-right font-normal">Opr RF</th>
                <th className="pl-2 font-normal">check, x</th>
                <th className="pl-3 text-right font-normal">Flexure inv / opr</th>
              </tr>
            </thead>
            <tbody>
              {sel.per.map((p) => (
                <tr key={p.g} className={cn("border-b border-border/50", (p.g === sel.govOpr.g || p.g === sel.govInv.g) && "font-medium")}>
                  <td className="py-1 pr-2 whitespace-nowrap">{p.g}</td>
                  <td className="text-right tabular-nums">{f3(p.df)}</td>
                  <td className="pl-3 text-right tabular-nums">{f3(p.inv.inv)}</td>
                  <td className="pl-2 whitespace-nowrap text-muted-foreground">
                    {CHECK_LABEL[p.inv.check].split(" (")[0].toLowerCase()}, {f2(p.inv.x)} ft
                  </td>
                  <td className="pl-3 text-right tabular-nums">{f3(p.opr.opr)}</td>
                  <td className="pl-2 whitespace-nowrap text-muted-foreground">
                    {CHECK_LABEL[p.opr.check].split(" (")[0].toLowerCase()}, {f2(p.opr.x)} ft
                  </td>
                  <td className="pl-3 text-right tabular-nums">
                    {f3(p.flexInv.inv)} / {f3(p.flexOpr.opr!)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <KeyValues
          title={s.mode === "back-calculate" ? "Prestress, back-calculated (BRM 1.7.2(A))" : "Prestress"}
          rows={[
            ["Strands per unit", s.mode === "back-calculate" ? `${fmt(s.nStrands, 2)} (exactly ${fmt(s.nExact, 3)})` : fmt(s.nStrands, 2)],
            ["A*s", `${fmt(s.As)} in²`],
            ["Jacking force Pj, for BrR", `${s.Pj.toFixed(s.mode === "back-calculate" && i.options.roundStrands ? 0 : 1)} kip`],
            ["Effective force Pe", `${fmt(s.Pe, 1)} kip (fse ${fmt(s.fse, 1)} ksi)`],
            ["Strand centroid from the bottom", `${fmt(s.cg, 2)} in`],
            ["Governing girder while solving", `${s.gov}, HS-20 inventory ${f3(s.govRF)}`],
            ["Cracking moment governs", s.crackGoverns ? "Yes (BRM 1.7.2)" : "No"],
            ["Flexure at midspan, governing girder", `Mn ${fmt(s.cap.Mn, 1)} kip·ft; fsu* ${fmt(s.cap.fsu, 1)} ksi; ${s.cap.type}`],
          ]}
        />
        <Card>
          <CardContent className="overflow-x-auto py-3 text-xs">
            <p className="pb-1 font-semibold">Girders: distribution and dead load at midspan</p>
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 font-normal">Girder</th>
                  <th className="text-right font-normal">DF single</th>
                  <th className="text-right font-normal">DF multi</th>
                  <th className="text-right font-normal">DC1 klf</th>
                  <th className="text-right font-normal">DC2 klf</th>
                  <th className="text-right font-normal">Ped klf</th>
                </tr>
              </thead>
              <tbody>
                {r.girders.map((g) => (
                  <tr key={g.name} className="border-b border-border/40" title={g.caseName}>
                    <td className="py-0.5 whitespace-nowrap">{g.name}</td>
                    <td className="text-right tabular-nums">{f3(g.dfSingle)}</td>
                    <td className="text-right tabular-nums">{f3(g.dfMulti)}</td>
                    <td className="text-right tabular-nums">{f3(g.dlNow.dc1)}</td>
                    <td className="text-right tabular-nums">{f3(g.dlNow.dc2)}</td>
                    <td className="text-right tabular-nums">{f3(g.pedKlf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold select-none">Hand method at midspan (the check)</summary>
        <div className="overflow-x-auto px-4 pb-3">
          <p className="pb-2 text-[11px] text-muted-foreground">Flexure only: each vehicle&apos;s absolute maximum moment with the dead load at midspan. The full analysis above checks every point and the service limits too.</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 font-normal">Vehicle</th>
                <th className="text-right font-normal">M max, kip·ft/wheel line</th>
                <th className="text-right font-normal">at, ft</th>
                <th className="text-right font-normal">Inv RF</th>
                <th className="text-right font-normal">Opr RF</th>
                <th className="pl-3 font-normal">Girder</th>
              </tr>
            </thead>
            <tbody>
              {r.midspan.map((x) => (
                <tr key={x.name} className="border-b border-border/40">
                  <td className="py-0.5">{x.name}</td>
                  <td className="text-right tabular-nums">{fmt(x.Mw, 2)}</td>
                  <td className="text-right tabular-nums">{fmt(x.at, 2)}</td>
                  <td className="text-right tabular-nums">{f3(x.govInv.inv)}</td>
                  <td className="text-right tabular-nums">{f3(x.gov.opr)}</td>
                  <td className="pl-3">{x.gov.g}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold select-none">BrR input sheet</summary>
        <div className="space-y-3 overflow-x-auto px-4 pb-3 text-xs">
          <p className="text-[11px] text-muted-foreground">In BrR&apos;s entry order: girder system, LFD, prestress by force and eccentricity.{r.ped.mountable ? " Two models: trucks curb to curb with pedestrians, and trucks rail to rail without; take the lower of the two." : ""}</p>
          {sheet.map((g) => (
            <div key={g.title}>
              <p className="pb-1 font-semibold">{g.title}</p>
              <table className="w-full">
                <tbody>
                  {g.rows.map(([k, v, n], j) => (
                    <tr key={j} className="border-b border-border/40 align-top">
                      <td className="w-1/3 py-0.5 pr-2 text-muted-foreground">{k}</td>
                      <td className="py-0.5 pr-2 font-medium">{v}</td>
                      <td className="py-0.5 text-[11px] text-muted-foreground">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </details>

      <Card>
        <CardContent className="space-y-2 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            <p className="mr-auto font-semibold">Comparison with BrR</p>
            <input
              ref={brrRef}
              type="file"
              multiple
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) void readBrr(files);
              }}
            />
            <Button size="xs" variant="outline" disabled={readingBrr} onClick={() => brrRef.current?.click()} title="BrR's Rating Results Summary Report as a PDF (or a rating package with it). With mountable sidewalks, pick both runs' reports: the lower rating of each is compared.">
              {readingBrr ? <Loader2 className="animate-spin" /> : <Upload />} Read BrR report (PDF)
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(brrTemplate(r));
                toast.success("A blank table is on the clipboard");
              }}
            >
              <Copy /> Blank table
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Read BrR&apos;s Rating Results Summary Report (PDF, read on this computer; two runs for the two sidewalk models), or paste its LFD rating results (from BrR or Excel, with the header row: Vehicle, Level, Rating Factor or Tons, and Girder if you have it). Each is compared with ALLCON&apos;s; more than {BRR_TOLERANCE * 100}% apart is flagged.</p>
          <textarea value={brr} onChange={(e) => setBrr(e.target.value)} rows={4} placeholder={"Vehicle\tLevel\tRating Factor\tGirder"} className="w-full rounded-md border border-input bg-transparent p-2 font-mono text-[11px]" />
          <div className="space-y-1 border-t pt-2">
            <p className="text-[11px] text-muted-foreground">BrR&apos;s moment distribution factors (from its LLDF report), checked against ALLCON&apos;s within {BRR_TOLERANCE * 100}%:</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              {(
                [
                  ["intSingle", "Interior, 1 lane"],
                  ["intMulti", "Interior, 2+ lanes"],
                  ["extSingle", "Exterior, 1 lane"],
                  ["extMulti", "Exterior, 2+ lanes"],
                ] as [keyof DtInputs["brrDf"], string][]
              ).map(([k, label]) => {
                const row = dfRows.find((x) => x.key === k);
                return (
                  <label key={k} className="space-y-0.5">
                    <span className="block text-[11px] text-muted-foreground">{label}</span>
                    <input
                      type="number"
                      step={0.001}
                      aria-label={`BrR distribution factor, ${label}`}
                      value={df[k] ?? ""}
                      onChange={(e) => setDf({ ...df, [k]: e.target.value === "" || !(Number(e.target.value) > 0) ? null : Number(e.target.value) })}
                      className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-right tabular-nums"
                    />
                    {row && (
                      <span className={cn("block text-[11px]", row.ok ? "text-emerald-700" : "text-red-600")}>
                        ALLCON {f3(row.ours)}, {row.diff >= 0 ? "+" : ""}
                        {(row.diff * 100).toFixed(1)}% {row.ok ? "OK" : "Check"}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
          {cmp?.error && <p className="text-destructive">{cmp.error}</p>}
          {cmp?.c && (
            <>
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 font-normal">Vehicle</th>
                    <th className="font-normal">Level</th>
                    <th className="font-normal">Girder</th>
                    <th className="text-right font-normal">ALLCON</th>
                    <th className="text-right font-normal">BrR</th>
                    <th className="text-right font-normal">Difference</th>
                    <th className="text-right font-normal">BrR, T</th>
                    <th className="pl-3 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {cmp.c.rows.map((x, k) =>
                    x.unmatched ? (
                      <tr key={k} className="border-b border-border/40 text-amber-700">
                        <td className="py-0.5">{x.vehicle}</td>
                        <td colSpan={7}>{x.why ?? "Not one of the CDOT vehicles"}</td>
                      </tr>
                    ) : (
                      <tr key={k} className="border-b border-border/40">
                        <td className="py-0.5">{x.name}</td>
                        <td>{x.level}</td>
                        <td>{x.girder}</td>
                        <td className="text-right tabular-nums">{f3(x.ours)}</td>
                        <td className="text-right tabular-nums">{f3(x.brr)}</td>
                        <td className="text-right tabular-nums">{`${x.diff >= 0 ? "+" : ""}${(x.diff * 100).toFixed(1)}%`}</td>
                        <td className="text-right tabular-nums">{x.brrTons.toFixed(1)}</td>
                        <td className={cn("pl-3 font-medium", x.ok ? "text-emerald-600" : "text-red-600")}>{x.ok ? "OK" : "Check"}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              {cmp.c.done.length > 0 && (
                <p className={cmp.c.outside ? "text-red-600" : "text-emerald-700"}>
                  {cmp.c.outside ? `${cmp.c.outside} outside ±${BRR_TOLERANCE * 100}%: check BrR's girder spacing, member loads, DF overrides and travelway.` : `All ${cmp.c.done.length} within ±${BRR_TOLERANCE * 100}%.`}
                  {cmp.c.hsInv && ` HS-20 inventory in BrR ${f3(cmp.c.hsInv.brr)}${s.mode === "back-calculate" ? (cmp.c.hsInv.brr >= 1 ? " (≥ 1.0, BRM 1.7.2(A))" : " (below 1.0: add a strand and rerun)") : ""}.`}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {Object.keys(i.notes).length > 0 && (
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold select-none">Sources of the values ({Object.keys(i.notes).length})</summary>
          <div className="px-4 pb-3 text-xs">
            {Object.entries(i.notes).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[12rem_1fr] gap-2 border-b border-border/40 py-0.5">
                <span className="text-muted-foreground">{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
