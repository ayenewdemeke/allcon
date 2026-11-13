"use client";

import { Choice, Field, Toggle } from "@/components/design/design-kit";
import { GIRDER_CHOICES, supportsFor, type BridgeDefinition } from "@/lib/bridge/definition";

// The bridge's inputs, in the groups the workspace's ribbon and tree open in the properties panel
// (as midas Civil's girder bridge wizard groups them: layout, section, boundary, loads).

export type FormKey = "layout" | "girders" | "diaphragms" | "bearings" | "piers" | "loads";
export const FORM_TITLES: Record<FormKey, string> = { layout: "Layout", girders: "Girders and deck", diaphragms: "Diaphragms", bearings: "Bearings", piers: "Piers", loads: "Loads" };

type Props = { def: BridgeDefinition; setDef: (update: (d: BridgeDefinition) => BridgeDefinition) => void };

const note = (text: string) => <p className="py-1 text-[11px] leading-snug text-muted-foreground">{text}</p>;

export function BridgeForm({ form, def, setDef }: Props & { form: FormKey }) {
  const set = <K extends keyof BridgeDefinition>(key: K) => (v: BridgeDefinition[K]) => setDef((s) => ({ ...s, [key]: v }));
  const part = <K extends "girder" | "deck" | "diaphragms" | "piers" | "loads">(key: K) => <F extends keyof BridgeDefinition[K]>(field: F) => (v: BridgeDefinition[K][F]) => setDef((s) => ({ ...s, [key]: { ...s[key], [field]: v } }));
  const setSpans = (spans: number[]) => setDef((s) => ({ ...s, spans, supports: supportsFor(spans.length, s.supports) }));
  const lineName = (k: number) => (k === 0 ? "Abutment 1" : k === def.supports.length - 1 ? "Abutment 2" : `Pier ${k}`);

  if (form === "layout")
    return (
      <>
        <Field label="Spans" value={def.spans.length} onChange={(n) => setSpans(Array.from({ length: Math.min(8, Math.max(1, Math.round(n))) }, (_, k) => def.spans[k] ?? def.spans[def.spans.length - 1]))} />
        {def.spans.map((L, k) => (
          <Field key={k} label={`Span ${k + 1}`} unit="ft" value={L} onChange={(v) => setSpans(def.spans.map((x, j) => (j === k ? v : x)))} step={5} hint="Between support centerlines" />
        ))}
        <Field label="Skew of the supports" unit="°" value={def.skew} onChange={set("skew")} step={5} />
        {def.spans.length > 1 && (
          <>
            <Choice
              label="At the piers"
              value={def.continuity}
              options={[
                { value: "continuous", label: "Made continuous" },
                { value: "simple", label: "Simple spans" },
              ]}
              onChange={set("continuity")}
            />
            {def.continuity === "continuous" && note("Continuous for the loads after the deck (barriers, wearing surface, live load); the girders carry their weight and the deck on simple spans.")}
          </>
        )}
        <Field label="Elements per span" value={def.divisions} onChange={(v) => set("divisions")(Math.round(v))} hint="10: results at the tenth points" />
      </>
    );
  if (form === "girders")
    return (
      <>
        <Choice label="Girder" value={def.girder.shape} options={def.girder.shape === "custom" ? [{ value: "custom", label: "Custom section" }, ...GIRDER_CHOICES] : GIRDER_CHOICES} onChange={(shape) => setDef((s) => ({ ...s, girder: { shape, fc: s.girder.fc, wc: s.girder.wc } }))} />
        <Field label="Number of girders" value={def.nGirders} onChange={(v) => set("nGirders")(Math.round(v))} />
        <Field label="Girder spacing" unit="ft" value={def.spacing} onChange={set("spacing")} step={0.25} />
        <Field label="Overhang" unit="ft" value={def.overhang} onChange={set("overhang")} step={0.25} hint="Exterior girder centerline to the deck's edge" />
        <Field label="Girder f'c" unit="ksi" value={def.girder.fc} onChange={part("girder")("fc")} step={0.5} />
        <Field label="Girder unit weight" unit="kcf" value={def.girder.wc} onChange={part("girder")("wc")} step={0.005} />
        <Field label="Deck thickness, as cast" unit="in" value={def.deck.thickness} onChange={part("deck")("thickness")} step={0.25} />
        <Field label="Sacrificial thickness" unit="in" value={def.deck.sacrificial} onChange={part("deck")("sacrificial")} step={0.25} hint="A load, left out of the section" />
        <Field label="Haunch" unit="in" value={def.deck.haunch} onChange={part("deck")("haunch")} step={0.5} />
        <Field label="Deck f'c" unit="ksi" value={def.deck.fc} onChange={part("deck")("fc")} step={0.5} />
        <Field label="Deck unit weight" unit="kcf" value={def.deck.wc} onChange={part("deck")("wc")} step={0.005} />
      </>
    );
  if (form === "diaphragms")
    return (
      <>
        <Field label="Intermediate, per span" value={def.diaphragms.perSpan} onChange={(v) => part("diaphragms")("perSpan")(Math.round(v))} />
        <Field label="Weight, per bay" unit="kip" value={def.diaphragms.weight} onChange={part("diaphragms")("weight")} step={0.5} hint="Between two girders: an interior girder carries one, an exterior girder half" />
        <Field label="Thickness" unit="ft" value={def.diaphragms.thickness} onChange={part("diaphragms")("thickness")} step={0.25} />
        <Toggle label="Diaphragms at the supports" value={def.diaphragms.atSupports} onChange={part("diaphragms")("atSupports")} />
      </>
    );
  if (form === "bearings")
    return (
      <>
        {def.supports.map((s, k) => (
          <Choice
            key={k}
            label={lineName(k)}
            value={s.bearing}
            options={[
              { value: "fixed", label: "Fixed" },
              { value: "expansion", label: "Expansion" },
            ]}
            onChange={(v) => set("supports")(def.supports.map((x, j) => (j === k ? { bearing: v } : x)))}
          />
        ))}
        <Field label="Bearing height" unit="in" value={def.piers.bearingHeight} onChange={part("piers")("bearingHeight")} step={0.5} />
        {note("Fixed bearings hold the girders along the bridge; expansion bearings let them slide. Every bearing holds its girder vertically and across the bridge.")}
      </>
    );
  if (form === "piers")
    return def.spans.length < 2 ? (
      note("A single span has no piers: its girders sit on the abutments.")
    ) : (
      <>
        <Toggle label="Model the caps and columns" value={def.piers.model} onChange={part("piers")("model")} />
        {def.piers.model ? (
          <>
            <Field label="Cap width" unit="ft" value={def.piers.capWidth} onChange={part("piers")("capWidth")} step={0.5} />
            <Field label="Cap depth" unit="ft" value={def.piers.capDepth} onChange={part("piers")("capDepth")} step={0.5} />
            <Field label="Columns" value={def.piers.columns} onChange={(v) => part("piers")("columns")(Math.round(v))} />
            <Field label="Column diameter" unit="ft" value={def.piers.columnDiameter} onChange={part("piers")("columnDiameter")} step={0.5} />
            <Field label="Column height" unit="ft" value={def.piers.columnHeight} onChange={part("piers")("columnHeight")} step={1} hint="Cap's soffit to the fixed base" />
            <Field label="Column spacing" unit="ft" value={def.piers.columnSpacing} onChange={part("piers")("columnSpacing")} step={1} />
            <Field label="Pier f'c" unit="ksi" value={def.piers.fc} onChange={part("piers")("fc")} step={0.5} />
          </>
        ) : (
          note("Without the caps and columns, the bearings at each pier stand on fixed supports.")
        )}
      </>
    );
  return (
    <>
      <Field label="Barrier, each side" unit="klf" value={def.loads.barrierWeight} onChange={part("loads")("barrierWeight")} step={0.05} />
      <Field label="Barrier width" unit="ft" value={def.loads.barrierWidth} onChange={part("loads")("barrierWidth")} step={0.25} hint="The roadway, and its lanes, run between the barriers" />
      <Field label="Future wearing surface" unit="psf" value={def.loads.wearingSurface} onChange={part("loads")("wearingSurface")} step={5} />
      {note("The girders', deck's, haunches' and piers' weights come from the sections. Live load is HL-93 (AASHTO 3.6.1): the design truck or tandem with 33% dynamic allowance, plus the lane load, in every lane that adds to an effect.")}
    </>
  );
}
