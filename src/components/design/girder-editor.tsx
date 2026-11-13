"use client";

import { useCdot } from "./agency-context";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createLinkedDesign } from "@/app/actions/design";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CDOT_END_BUNDLE, changeShape, designGirder, HAUL_TRUCKS, spanInputs, zoneAv, zoneCallout, type GirderDesign, type Handling, type GirderInputs, type GirderResult, type HarpedStrands, type StirrupZone, type StrandRow } from "@/lib/design/girders/prestressed";
import { GIRDER_SHAPES, type Profile } from "@/lib/design/girders/sections";
import { BARS, DesignError } from "@/lib/design/walls/cip";
import { cn } from "@/lib/utils";
import { ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";
import { TakeoffPanel } from "./takeoff-panel";
import { BridgeElevation, GirderElevation, GirderSketch, HandlingSketch } from "./girder-sketch";
import { FromPlansPanel } from "./from-plans-panel";
import { BridgeSectionSketch } from "./bridge-section-sketch";
import { GirderScheduleSketch } from "./girder-schedule-sketch";
import { girderSchedule, SCHEDULE_HEAD, scheduleCells } from "@/lib/design/girders/schedule";
import { applyRail, CROWN_DEFAULT, deckLength, GIRDER_RAIL_DEFAULT } from "@/lib/design/girders/bridge-deck";
import { RAILS, railDef, type RailKey, type TestLevel } from "@/lib/design/decks/rails";
import { toConfirm, trackEdits } from "@/lib/design/girders/from-plans";
import { brakingPerLane, continuousEndShear, SITE_WIND_DEFAULTS, superstructureWind, type SiteWind } from "@/lib/design/girders/substructure-loads";

/** The wind and braking this superstructure delivers to its piers and abutments (read by the pier cap's girder link). */
function SubstructureLoads({ inputs, onChange }: { inputs: GirderInputs; onChange: (site: SiteWind) => void }) {
  const site = inputs.site ?? SITE_WIND_DEFAULTS;
  const set = <K extends keyof SiteWind>(k: K) => (v: SiteWind[K]) => onChange({ ...site, [k]: v });
  let out: { w: ReturnType<typeof superstructureWind>; br: ReturnType<typeof brakingPerLane>; share: number | null } | null = null;
  try {
    const length = [inputs.L, ...inputs.extraSpans.map((s) => s.L)].reduce((a, b) => a + b, 0);
    out = { w: superstructureWind(inputs, site), br: brakingPerLane(length), share: inputs.extraSpans.length ? continuousEndShear(inputs, 0, "end") : null };
  } catch {
    out = null;
  }
  return (
    <div className="text-xs">
      <Field label="Design wind speed, Strength III" unit="mph" value={site.V} onChange={set("V")} step={5} hint="Figure 3.8.1.1.2-1 for the site" />
      <Choice
        label="Wind exposure (3.8.1.1.5)"
        value={site.exposure}
        options={[
          { value: "B", label: "B: urban, suburban, wooded" },
          { value: "C", label: "C: open terrain" },
          { value: "D", label: "D: flat, open water" },
        ]}
        onChange={set("exposure")}
      />
      <Field label="Top of the superstructure above ground or water" unit="ft" value={site.Z} onChange={set("Z")} hint="Kz takes at least 33 ft" />
      {inputs.rail && inputs.rail.type !== "custom" ? <p className="pb-1 text-[11px] text-muted-foreground">Barrier height above the deck: {fmt(site.barrierHeight, 3)} ft, the rail&apos;s.</p> : <Field label="Barrier height above the deck" unit="ft" value={site.barrierHeight} onChange={set("barrierHeight")} step={0.25} />}
      {out && (
        <div className="mt-1 rounded bg-muted/40 p-1.5 text-[11px]">
          <p>
            Depth seen by the wind {fmt(out.w.depth, 2)} ft (girder {fmt(out.w.girderDepth, 2)} ft, haunch and deck, barrier), at its mid-depth; deck top {fmt(out.w.deckTop, 2)} ft above the bearings.
          </p>
          <p>
            WS on the superstructure: {out.w.strengthIII ? `${fmt(out.w.strengthIII.line, 3)} klf Strength III (${site.V} mph, Kz ${fmt(out.w.strengthIII.Kz, 2)})` : "Strength III needs the site's wind speed"}; {fmt(out.w.strengthV.line, 3)} klf Strength V (80 mph); {fmt(out.w.serviceI.line, 3)} klf Service I (70 mph). PZ = 2.56×10⁻⁶ V² Kz G Cd, G = 1.0, Cd = 1.3 (3.8.1.2.1).
          </p>
          <p>WL 0.10 klf, 6 ft above the roadway (3.8.1.3); vertical 0.020 ksf on the deck at its windward quarter point, Strength III (3.8.2).</p>
          <p>
            Braking BR {fmt(out.br.perLane, 1)} kip per lane ({out.br.governs}, 3.6.4), 6 ft above the roadway, with the multiple presence factor.
          </p>
          {out.share !== null && <p>Continuous girders: each span&apos;s end shear at the first pier carries {fmt(out.share, 2)} ft of a uniform load placed after continuity (5.12.3.3).</p>}
          <p className="text-muted-foreground">A pier cap&apos;s strut-and-tie design reads these through its link to this design.</p>
        </div>
      )}
    </div>
  );
}

// The LRFD Bridge Design Check: a precast prestressed girder span's inputs on the left, its checks
// (interior and exterior girders) worked out on the right as they change, saved as you go.

const GROUPS: Record<string, string> = {
  fpj: "Prestressing steel",
  fpe: "Prestressing steel",
  "rel-comp": "At release (5.9.2.3.1)",
  "rel-tens": "At release (5.9.2.3.1)",
  "svc-perm": "Service I and III (5.9.2.3.2)",
  "svc-total": "Service I and III (5.9.2.3.2)",
  "deck-perm": "Service I and III (5.9.2.3.2)",
  "deck-total": "Service I and III (5.9.2.3.2)",
  "svc-tens": "Service I and III (5.9.2.3.2)",
  flexure: "Strength I: flexure (5.6)",
  "min-reinf": "Strength I: flexure (5.6)",
  shear: "Strength I: shear (5.7)",
  "av-min": "Strength I: shear (5.7)",
  "s-max": "Strength I: shear (5.7)",
  interface: "Strength I: shear (5.7)",
  "interface-min": "Strength I: shear (5.7)",
  long: "Strength I: shear (5.7)",
  "long-brg": "Strength I: shear (5.7)",
  "deb-total": "Debonding (5.9.4.3.3)",
  "deb-row": "Debonding (5.9.4.3.3)",
  "deb-section": "Debonding (5.9.4.3.3)",
  "deb-length": "Debonding (5.9.4.3.3)",
  "deb-outer": "Debonding (5.9.4.3.3)",
  "ll-defl": "Live load deflection (2.5.2.6.2)",
  "svc-bot-perm": "Service I and III (5.9.2.3.2)",
  "svc-bot-total": "Service I and III (5.9.2.3.2)",
  "neg-flexure": "Over the piers: negative moment (5.12.3.3)",
  "neg-min-reinf": "Over the piers: negative moment (5.12.3.3)",
  "crack-control": "Over the piers: negative moment (5.12.3.3)",
  "conn-strength": "Positive moment connection (5.12.3.3)",
  "conn-stress": "Positive moment connection (5.12.3.3)",
  fatigue: "Fatigue I (5.5.3.1)",
  principal: "Service I and III (5.9.2.3.2)",
  splitting: "Anchorage zone (5.9.4.4)",
  "conf-bar": "Anchorage zone (5.9.4.4)",
  "conf-spacing": "Anchorage zone (5.9.4.4)",
  "conf-length": "Anchorage zone (5.9.4.4)",
};
const groupOf = (id: string) => GROUPS[id] ?? (id.startsWith("lift-") ? "Lifting (5.5.4.3)" : id.startsWith("haul-") ? "Hauling (5.5.4.3)" : "Checks");

const shapeOptions = [...GIRDER_SHAPES.map((s) => ({ value: s.id, label: s.name })), { value: "custom", label: "Custom section" }];

export function GirderEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: GirderInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setRawInputs] = useState(design.inputs);
  // CDOT's criteria, rails and end detail are offered with its rules on (or where the design already uses them).
  const cdot = useCdot();
  // Every edit also marks the values from the plans it changes as edited (confirmed by the engineer).
  // A standard rail keeps the barrier's width, weight and height in step with it.
  const setInputs = (next: GirderInputs | ((s: GirderInputs) => GirderInputs)) => setRawInputs((s) => applyRail(trackEdits(typeof next === "function" ? next(s) : next)));
  const railChoice = { ...GIRDER_RAIL_DEFAULT, ...(inputs.rail ?? {}) };
  const stdRail = railDef(railChoice.type);
  const crown = { ...CROWN_DEFAULT, ...(inputs.crown ?? {}) };
  const pending = toConfirm(inputs.fromPlans);
  const set = <K extends keyof GirderInputs>(key: K) => (v: GirderInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const [view, setView] = useState<"interior" | "exterior" | null>(null);
  const [spanView, setSpanView] = useState<number | "piers" | null>(null); // results shown: a span, or the piers
  const [strandSpan, setStrandSpan] = useState(0); // the span whose strands are being edited

  const outcome = useMemo(() => {
    try {
      return { result: designGirder(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;
  const nSpans = 1 + inputs.extraSpans.length;
  const multi = nSpans > 1;
  const shown = r ? (view ?? r.controlling) : null;
  const sv = r ? (spanView === "piers" && r.piers.length ? "piers" : typeof spanView === "number" && spanView < r.spans.length ? spanView : r.controllingSpan) : 0;
  const spanIdx = typeof sv === "number" ? sv : r?.controllingSpan ?? 0;
  const g = r && shown ? r.spans[spanIdx][shown] : null;
  const shownInputs = spanInputs(inputs, Math.min(spanIdx, nSpans - 1));
  const label = (k: number, side: string) => (multi ? `Span ${k + 1}, ${side}` : side[0].toUpperCase() + side.slice(1));
  const allChecks = r
    ? [
        ...r.spans.flatMap((s, k) => [
          ...s.interior.checks.map((c) => ({ ...c, id: `${k}-i-${c.id}`, name: `${label(k, "interior")}: ${c.name}` })),
          ...s.exterior.checks.map((c) => ({ ...c, id: `${k}-e-${c.id}`, name: `${label(k, "exterior")}: ${c.name}` })),
        ]),
        ...r.piers.flatMap((p) => [
          ...p.interior.checks.map((c) => ({ ...c, id: `p${p.index}-i-${c.id}`, name: `Pier ${p.index}, interior: ${c.name}` })),
          ...p.exterior.checks.map((c) => ({ ...c, id: `p${p.index}-e-${c.id}`, name: `Pier ${p.index}, exterior: ${c.name}` })),
        ]),
      ]
    : [];

  // Strands: span 1's, or another span's own set (null: the same as span 1).
  const editSpan = Math.min(strandSpan, nSpans - 1);
  const extra = editSpan > 0 ? inputs.extraSpans[editSpan - 1] : null;
  const ownStrands = !extra || extra.strands !== null;
  const strandRows = extra?.strands ?? inputs.strands;
  const harpedNow = extra?.harped ?? inputs.harped;
  const setSpan = (k: number, patch: Partial<GirderInputs["extraSpans"][number]>) => setInputs((s) => ({ ...s, extraSpans: s.extraSpans.map((x, j) => (j === k ? { ...x, ...patch } : x)) }));
  const setStrandRows = (rows: StrandRow[]) => (extra ? setSpan(editSpan - 1, { strands: rows }) : set("strands")(rows));
  const setHarped = (patch: Partial<HarpedStrands>) => (extra ? setSpan(editSpan - 1, { harped: { ...harpedNow, ...patch } }) : setInputs((s) => ({ ...s, harped: { ...s.harped, ...patch } })));

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label={inputs.criteria === "cdot" ? "LRFD Bridge Design Check · AASHTO LRFD 10th ed. with the CDOT BDM" : "LRFD Bridge Design Check · AASHTO LRFD 10th ed."} canMakeCalc={!!r && pending.length === 0} />
      {inputs.fromPlans && <FromPlansPanel fromPlans={inputs.fromPlans} projectId={design.projectId} onChange={(update) => setRawInputs((s) => (s.fromPlans ? { ...s, fromPlans: update(s.fromPlans) } : s))} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Girder section" open>
              <Choice label="Section" value={inputs.shape} options={shapeOptions} onChange={(id) => setInputs((s) => changeShape(s, id))} />
              {inputs.shape === "custom" && <CustomSection inputs={inputs} onChange={(custom) => setInputs((s) => ({ ...s, custom }))} />}
            </Section>
            <Section title="Span and layout" open>
              <Field label={multi ? "Span 1 (bearing to bearing)" : "Span (bearing to bearing)"} unit="ft" value={inputs.L} onChange={set("L")} />
              {inputs.extraSpans.map((s, k) => (
                <div key={k} className="flex items-end gap-1">
                  <div className="flex-1">
                    <Field label={`Span ${k + 2}`} unit="ft" value={s.L} onChange={(L) => setSpan(k, { L })} />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove span ${k + 2}`}
                    onClick={() => {
                      setInputs((x) => ({ ...x, extraSpans: x.extraSpans.filter((_, j) => j !== k) }));
                      setStrandSpan(0);
                      setSpanView(null);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {nSpans < 5 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setInputs((x) => ({ ...x, extraSpans: [...x.extraSpans, { L: x.extraSpans.length ? x.extraSpans[x.extraSpans.length - 1].L : x.L, strands: null, harped: null }] }))}>
                  <Plus /> Add a span (girders made continuous)
                </Button>
              )}
              <Field label="Girder end to bearing CL" unit="ft" value={inputs.endDist} onChange={set("endDist")} step={0.05} />
              <Field label="Number of girders" value={inputs.nGirders} onChange={(v) => set("nGirders")(Math.max(2, Math.round(v)))} />
              <Field label="Girder spacing" unit="ft" value={inputs.S} onChange={set("S")} step={0.25} />
              <Field label="Overhang (exterior girder CL to deck edge)" unit="ft" value={inputs.overhang} onChange={set("overhang")} step={0.25} />
              <Field label="Skew" unit="°" value={inputs.skew} onChange={set("skew")} />
            </Section>
            <Section title="Bridge rail and roadway" open>
              <Choice label="Rail" value={railChoice.type} options={[...(cdot || railChoice.type !== "custom" ? RAILS.map((x) => ({ value: x.key as RailKey, label: `CDOT ${x.name} (${x.sheet})` })) : []), { value: "custom" as RailKey, label: "Barrier (entered)" }]} onChange={(v) => setInputs((s) => ({ ...s, rail: { ...railChoice, type: v } }))} />
              {stdRail ? (
                <>
                  <Choice label="Test level" value={railChoice.testLevel} options={[{ value: "TL-5" as TestLevel, label: "TL-5 (42 in)" }, { value: "TL-4" as TestLevel, label: "TL-4" }]} onChange={(v) => setInputs((s) => ({ ...s, rail: { ...railChoice, testLevel: v } }))} />
                  <p className="pb-1 text-[11px] text-muted-foreground">
                    {fmt(inputs.barrierWidth, 3)} ft wide at its base, {fmt(stdRail.height / 12, 3)} ft high, {fmt(inputs.barrierWeight * 1000, 0)} plf each (its concrete{stdRail.steel ? ", posts and tubes" : ""}): the barrier the girders carry and the wind sees. Its bars are detailed in the Deck Slab design.
                  </p>
                </>
              ) : (
                <Field label="Deck edge to barrier's inside face" unit="ft" value={inputs.barrierWidth} onChange={set("barrierWidth")} step={0.125} />
              )}
              <Choice label="Roadway" value={crown.kind} options={[{ value: "crown", label: "Crowned" }, { value: "one-way", label: "One-way slope" }]} onChange={(v) => set("crown")({ ...crown, kind: v as "crown" | "one-way" })} />
              {crown.kind === "crown" && <Field label="Crown from the deck's centerline" unit="ft" value={crown.offset} onChange={(offset) => set("crown")({ ...crown, offset })} step={0.5} hint="+ toward the right" />}
              <Field label="Cross-slope" unit="ft/ft" value={inputs.crossSlope ?? 0.02} onChange={set("crossSlope")} step={0.005} hint="Over a level top flange, the haunch is thinner at one edge" />
            </Section>
            <Section title="Deck and haunch" open>
              <Field label="Deck thickness, as cast" unit="in" value={inputs.deckT} onChange={set("deckT")} step={0.25} />
              <Field label="Sacrificial (integral wearing) thickness" unit="in" value={inputs.sacrificial} onChange={set("sacrificial")} step={0.25} />
              {inputs.criteria === "cdot" && (
                <Choice
                  label="Haunch"
                  value={inputs.haunchMode ?? "given"}
                  options={[
                    { value: "given", label: "As given (a load)" },
                    { value: "computed", label: "From the camber (CDOT BDM 5.5.2.1)" },
                  ]}
                  onChange={(v) => set("haunchMode")(v as "given" | "computed")}
                />
              )}
              {inputs.criteria === "cdot" && inputs.haunchMode === "computed" ? (
                <>
                  <Toggle label="Partial-depth precast deck panels permitted" value={!!inputs.deckPanels} onChange={set("deckPanels")} />
                  <Field label="Profile above the chord at midspan" unit="in" value={inputs.profileOrdinate ?? 0} onChange={set("profileOrdinate")} step={0.25} hint="+ where the profile grade is above the bearing-to-bearing chord (a crest); BDM 5.5.2.1 F" />
                  <p className="pb-1 text-[11px] text-muted-foreground">
                    The haunch at the supports is the least that keeps BDM 5.5.2.1&apos;s minimums with the girder 30% over-cambered (at least 1 in); the dead load carries Eq. 5.1&apos;s haunch with it 30% under-cambered. Worked out per span.
                  </p>
                </>
              ) : (
                <Field label="Haunch at the girder" unit="in" value={inputs.haunch} onChange={set("haunch")} step={0.25} />
              )}
              <Toggle label="Count the haunch in the composite section" value={inputs.haunchInSection} onChange={set("haunchInSection")} />
              <Field label="Deck f′c" unit="ksi" value={inputs.fcDeck} onChange={set("fcDeck")} step={0.5} />
              <Field label="Deck unit weight" unit="kcf" value={inputs.wcDeck} onChange={set("wcDeck")} step={0.005} />
            </Section>
            <Section title="Girder concrete">
              <Field label="f′ci at release" unit="ksi" value={inputs.fci} onChange={set("fci")} step={0.5} />
              <Field label="f′c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="Unit weight" unit="kcf" value={inputs.wc} onChange={set("wc")} step={0.005} />
              <Field label="K1 (aggregate correction)" value={inputs.K1} onChange={set("K1")} step={0.05} hint="5.4.2.4" />
            </Section>
            <Section title="Strands" open>
              <Choice label="Strand" value={inputs.strandDia} options={[{ value: 0.6, label: '0.6" Grade 270 low-relax' }, { value: 0.5, label: '0.5" Grade 270 low-relax' }]} onChange={(v) => set("strandDia")(v as 0.5 | 0.6)} />
              <Field label="Jacking stress, fpj / fpu" value={inputs.fpjRatio} onChange={set("fpjRatio")} step={0.01} />
              {multi && <Choice label="Strands of" value={editSpan} options={Array.from({ length: nSpans }, (_, k) => ({ value: k, label: `Span ${k + 1}` }))} onChange={(v) => setStrandSpan(Number(v))} />}
              {extra && (
                <Toggle
                  label="Same as span 1"
                  value={!ownStrands}
                  onChange={(same) => setSpan(editSpan - 1, same ? { strands: null, harped: null } : { strands: inputs.strands.map((x) => ({ ...x })), harped: { ...inputs.harped } })}
                />
              )}
              {ownStrands && (
                <>
                  <Rows
                    title="Straight rows: height, strands, and how many are debonded for a length at each end"
                    rows={strandRows}
                    onChange={setStrandRows}
                    blank={{ y: 8, count: 2, debonded: 0, debondLength: 0 }}
                    cols={[
                      { key: "y", label: "y", unit: "in", step: 0.5 },
                      { key: "count", label: "Strands", step: 2 },
                      { key: "debonded", label: "Debonded", step: 2 },
                      { key: "debondLength", label: "for", unit: "ft", step: 1 },
                    ]}
                  />
                  <p className="pt-2 pb-1 text-xs text-muted-foreground">Harped strands (two-point drape)</p>
                  <Field label="Harped strands" value={harpedNow.count} onChange={(v) => setHarped({ count: Math.max(0, Math.round(v)) })} step={2} />
                  {harpedNow.count > 0 && (
                    <>
                      <Field label="Their centroid at the girder's ends" unit="in" value={harpedNow.yEnd} onChange={(yEnd) => setHarped({ yEnd })} step={0.5} />
                      <Field label="At the harp points" unit="in" value={harpedNow.yHarp} onChange={(yHarp) => setHarped({ yHarp })} step={0.5} />
                      <Field label="Harp points from each end" unit="× Lg" value={harpedNow.harpPoint} onChange={(harpPoint) => setHarped({ harpPoint })} step={0.05} hint="Fraction of the girder's length" />
                    </>
                  )}
                </>
              )}
            </Section>
            <Section title="Losses and time" open>
              <Choice
                label="Time-dependent losses"
                value={inputs.losses}
                options={[
                  { value: "refined", label: "Refined (5.9.3.4)" },
                  { value: "approximate", label: "Approximate (5.9.3.3)" },
                ]}
                onChange={set("losses")}
              />
              {inputs.losses === "refined" && <Toggle label="Count elastic gains (Service III γLL = 1.0)" value={inputs.elasticGain} onChange={set("elasticGain")} />}
              <Field label="Relative humidity" unit="%" value={inputs.humidity} onChange={set("humidity")} />
              <Field label="Age at release" unit="days" value={inputs.tRelease} onChange={set("tRelease")} step={0.5} />
              <Field label="Age when the deck is cast" unit="days" value={inputs.tDeck} onChange={set("tDeck")} />
              {inputs.losses === "refined" && <Field label="Final age" unit="days" value={inputs.tFinal} onChange={set("tFinal")} step={100} />}
            </Section>
            <Section title="Dead loads">
              <Field label="Intermediate diaphragms (equally spaced)" value={inputs.diaphragms} onChange={(v) => set("diaphragms")(Math.max(0, Math.round(v)))} />
              <Field label="Diaphragm weight on an interior girder" unit="kip" value={inputs.diaphragmWeight} onChange={set("diaphragmWeight")} step={0.1} hint="Each diaphragm; an exterior girder, with diaphragms on one side, carries half" />
              <Field label="Other DC on the girder alone" unit="klf" value={inputs.otherDC1} onChange={set("otherDC1")} step={0.01} hint="Stay-in-place forms and the like" />
              {!stdRail && <Field label="Barrier weight, each" unit="klf" value={inputs.barrierWeight} onChange={set("barrierWeight")} step={0.01} />}
              <Toggle label="Each barrier carried by its exterior girder" value={inputs.barriersOnExterior} onChange={set("barriersOnExterior")} />
              <Field label="Other DC on the composite section" unit="klf" value={inputs.otherDC2} onChange={set("otherDC2")} step={0.01} />
              <Field label="Future wearing surface (DW)" unit="psf" value={inputs.fws} onChange={set("fws")} />
            </Section>
            <Section title="Shear and longitudinal reinforcement">
              <Rows
                title="Zones from each bearing (the last runs to midspan)"
                rows={inputs.stirrups}
                onChange={set("stirrups")}
                blank={{ length: 10, bar: 4, legs: 2, spacing: 12 }}
                cols={[
                  { key: "length", label: "Length", unit: "ft", step: 1 },
                  { key: "bar", label: "Bar #", step: 1 },
                  { key: "legs", label: "Legs", step: 1 },
                  { key: "spacing", label: "s", unit: "in", step: 1 },
                ]}
              />
              {(cdot || !!inputs.stirrups[0]?.bundle) && <Toggle
                label={`First zone: CDOT's end detail, ${zoneCallout({ bar: 4, spacing: 3, bundle: CDOT_END_BUNDLE })} for 6 spaces (B-618-CBT1)`}
                value={!!inputs.stirrups[0]?.bundle}
                onChange={(on) =>
                  setInputs((s) => ({
                    ...s,
                    // 6 spaces at 3 in from the girder's end: the zone's length is measured from the bearing.
                    stirrups: s.stirrups.map((z, k) => (k !== 0 ? z : on ? { length: +Math.max(0.25, 1.5 - s.endDist).toFixed(4), bar: 4, legs: 2, spacing: 3, bundle: { ...CDOT_END_BUNDLE } } : { length: z.length, bar: z.bar, legs: z.legs, spacing: z.spacing })),
                  }))
                }
              />}
              {inputs.stirrups[0]?.bundle && <p className="pb-1 text-[11px] text-muted-foreground">Zone 1: each set is {inputs.stirrups[0].bundle.bars} #{inputs.stirrups[0].bar} bars and a D{Math.round(inputs.stirrups[0].bundle.wire * 100)} wire bundled, {fmt(zoneAv(inputs.stirrups[0]), 2)} in² a set: counted in the splitting resistance (5.9.4.4.1) and the shear.</p>}
              <Toggle label="Stirrups extend into the deck" value={inputs.stirrupsIntoDeck} onChange={set("stirrupsIntoDeck")} />
              <Field label="Bars fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
              <Field label="Maximum aggregate size" unit="in" value={inputs.ag} onChange={set("ag")} step={0.125} />
              <Field label="Bottom bars (5.7.3.5), count" value={inputs.bottomBars.count} onChange={(v) => setInputs((s) => ({ ...s, bottomBars: { ...s.bottomBars, count: Math.max(0, Math.round(v)) } }))} hint="Longitudinal bars at the bottom, fully developed" />
              {inputs.bottomBars.count > 0 && (
                <Choice label="Bottom bar size" value={inputs.bottomBars.bar} options={[4, 5, 6, 7, 8, 9].map((b) => ({ value: b, label: `#${b}` }))} onChange={(bar) => setInputs((s) => ({ ...s, bottomBars: { ...s.bottomBars, bar } }))} />
              )}
              <Field label="Bearing length along the girder" unit="in" value={inputs.bearingLength} onChange={set("bearingLength")} hint="For 5.7.3.5 at the bearing's inside edge" />
              <p className="pt-2 pb-1 text-xs text-muted-foreground">Confinement around the bottom flange&apos;s strands at each end (5.9.4.4.2)</p>
              <BarChoice label="Confinement bar" bar={inputs.confinement.bar} sizes={[3, 4, 5]} onBar={(bar) => setInputs((s) => ({ ...s, confinement: { ...s.confinement, bar } }))} />
              <Field label="Spacing" unit="in" value={inputs.confinement.spacing} onChange={(spacing) => setInputs((s) => ({ ...s, confinement: { ...s.confinement, spacing } }))} step={0.5} />
              <Field label="From the girder's end" unit="ft" value={inputs.confinement.length} onChange={(length) => setInputs((s) => ({ ...s, confinement: { ...s.confinement, length } }))} step={0.5} hint="At least 1.5 times the girder's depth" />
            </Section>
            <Section title="Lifting and hauling (5.5.4.3)">
              <HandlingInputs value={inputs.handling} onChange={(handling) => setInputs((s) => ({ ...s, handling }))} />
            </Section>
            {multi && (
              <Section title="Continuity over the piers (5.12.3.3)" open>
                <Field label="Girder age when continuity is made" unit="days" value={inputs.tContinuity} onChange={set("tContinuity")} hint="The diaphragms cast; not before the deck" />
                <Field label="Pier centerline to the bearings" unit="ft" value={inputs.pierBearingOffset} onChange={set("pierBearingOffset")} step={0.05} hint="The continuous beam spans to the piers' centerlines" />
                <Choice
                  label="After continuity"
                  value={inputs.continuity ?? "auto"}
                  options={[
                    { value: "auto", label: inputs.criteria === "cdot" ? "Continuous if the girders are 60 days old (CDOT BDM 5.7.3)" : "Continuous where the joint is fully effective (5.12.3.3)" },
                    { value: "envelope", label: "Envelope of simple span and continuous" },
                  ]}
                  onChange={set("continuity")}
                />
                {inputs.criteria === "cdot" ? (
                  <p className="pt-1 text-xs text-muted-foreground">Restraint moments: taken as zero, not computed (CDOT BDM 5.7.2). The connection resists 1.2 Mcr.</p>
                ) : (
                  <Choice
                    label="Restraint moments (creep, shrinkage)"
                    value={inputs.restraintMoments}
                    options={[
                      { value: "all", label: "All (conservative)" },
                      { value: "positive", label: "Positive only" },
                      { value: "none", label: "None" },
                    ]}
                    onChange={set("restraintMoments")}
                  />
                )}
                <p className="pt-2 pb-1 text-xs text-muted-foreground">Deck bars over the piers (longitudinal)</p>
                <BarChoice label="Top mat" bar={inputs.pierBars.topBar} onBar={(topBar) => setInputs((s) => ({ ...s, pierBars: { ...s.pierBars, topBar } }))} />
                <Field label="Top mat spacing" unit="in" value={inputs.pierBars.topSpacing} onChange={(topSpacing) => setInputs((s) => ({ ...s, pierBars: { ...s.pierBars, topSpacing } }))} step={0.5} />
                <BarChoice label="Bottom mat" bar={inputs.pierBars.botBar} onBar={(botBar) => setInputs((s) => ({ ...s, pierBars: { ...s.pierBars, botBar } }))} />
                <Field label="Bottom mat spacing" unit="in" value={inputs.pierBars.botSpacing} onChange={(botSpacing) => setInputs((s) => ({ ...s, pierBars: { ...s.pierBars, botSpacing } }))} step={0.5} />
                <Field label="Top cover (from the deck's top as cast)" unit="in" value={inputs.pierBars.coverTop} onChange={(coverTop) => setInputs((s) => ({ ...s, pierBars: { ...s.pierBars, coverTop } }))} step={0.25} />
                <Field label="Bottom cover" unit="in" value={inputs.pierBars.coverBottom} onChange={(coverBottom) => setInputs((s) => ({ ...s, pierBars: { ...s.pierBars, coverBottom } }))} step={0.25} />
                <p className="pt-2 pb-1 text-xs text-muted-foreground">Positive moment connection (bars from each girder&apos;s bottom into the diaphragm)</p>
                <Field label="Bars per girder" value={inputs.connection.count} onChange={(v) => setInputs((s) => ({ ...s, connection: { ...s.connection, count: Math.max(0, Math.round(v)) } }))} step={2} />
                <BarChoice label="Bar size" bar={inputs.connection.bar} onBar={(bar) => setInputs((s) => ({ ...s, connection: { ...s.connection, bar } }))} />
                <Field label="Height above the girder's bottom" unit="in" value={inputs.connection.y} onChange={(y) => setInputs((s) => ({ ...s, connection: { ...s.connection, y } }))} step={0.5} />
              </Section>
            )}
            <Section title="Loads to the substructure (wind, braking)">
              <SubstructureLoads inputs={inputs} onChange={(site) => setInputs((s) => ({ ...s, site }))} />
            </Section>
            <Section title="Factors and options">
              {(cdot || inputs.criteria === "cdot") && (
                <Choice
                  label="Design criteria"
                  value={inputs.criteria ?? "aashto"}
                  options={[
                    { value: "aashto", label: "AASHTO LRFD" },
                    { value: "cdot", label: "AASHTO LRFD with the CDOT Bridge Design Manual" },
                  ]}
                  onChange={set("criteria")}
                />
              )}
              {inputs.criteria === "cdot" && (
                <p className="pb-1 text-xs text-muted-foreground">
                  CDOT BDM: Colorado Permit Vehicle and EV3 at Strength II (3.6); f′ci ≤ 6.5, f′c ≤ 8.5 ksi (5.3.1.2); no tension under dead load (5.5.1.3); live load elastic gain with γLL = 1.0 (5.5.1.1); hold-down ≤ 4 kip per strand (5.5.2.2); continuity rules (5.7); stirrups ≤ 18 in (5.5.1.6); harp height, harped strands only over 100 ft and 2,800 kip on the bed (5.5.1.5, B-618-CBT2); shipping 154 ft, 240 kip (5.5.1.9); camber at 60 days ±30%, no sag, minimum haunches (5.5.2.1). For information: the harp points at 0.35–0.45 of the girder&apos;s length (5.5.1.5, guidance), lifting and hauling (the fabricator&apos;s, 5.5.1.8). Creep and shrinkage at 55% humidity (5.3.3), whatever is entered below.
                </p>
              )}
              {inputs.criteria === "cdot" && <Toggle label="Higher f′ci or f′c approved by the Unit Leader with the State Bridge Engineer (5.3.1.2)" value={!!inputs.highStrengthApproved} onChange={set("highStrengthApproved")} />}
              <Choice
                label="Live load distribution"
                value={inputs.distribution ?? "aashto"}
                options={[
                  { value: "aashto", label: "AASHTO's tables (4.6.2.2)" },
                  { value: "lever-rule", label: "The lever rule for every girder" },
                ]}
                onChange={set("distribution")}
              />
              <Field label="η (ηD·ηR·ηI)" value={inputs.eta} onChange={set("eta")} step={0.05} hint="1.3.2" />
              <Choice
                label="Service III tension limit"
                value={inputs.exposure}
                options={[
                  { value: "moderate", label: "Not worse than moderate corrosion" },
                  { value: "severe", label: "Severe corrosive conditions" },
                  { value: "none", label: "No tension" },
                ]}
                onChange={set("exposure")}
              />
              <Toggle label="Exterior girder not less than the rigid cross-section" value={inputs.rigidMethod} onChange={set("rigidMethod")} />
              <Toggle label="Skew correction for shear on interior girders too" value={inputs.skewShearInterior} onChange={set("skewShearInterior")} />
              <Toggle label="Check live load deflection (2.5.2.6.2, optional)" value={inputs.llDeflection} onChange={set("llDeflection")} />
              {inputs.llDeflection && <Field label="Deflection limit, L /" value={inputs.deflectionLimit} onChange={set("deflectionLimit")} step={100} hint="800; 1000 with pedestrians" />}
            </Section>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {outcome.error ? (
            <DesignErrorCard
              message={outcome.error}
              action={
                outcome.error.endsWith("Change it under Strands.") ? (
                  <Button size="sm" variant="outline" onClick={() => setInputs((s) => changeShape(s, s.shape))}>
                    Fit the strands to this girder
                  </Button>
                ) : undefined
              }
            />
          ) : (
            r &&
            g && (
              <>
                {pending.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                    Not yet confirmed: {pending.length} {pending.length === 1 ? "value" : "values"} from the plans still to confirm (above). These results are for checking, not for use, and the calc package stays off until every value is confirmed.
                  </div>
                )}
                <ChecksBanner checks={allChecks} extra={<span className="ml-auto text-xs whitespace-nowrap">Controlling: {multi ? `span ${r.controllingSpan + 1}, ` : ""}{r.controlling} girder</span>} />
                {multi && (
                  <div className="flex flex-wrap items-center gap-2">
                    {r.spans.map((s, k) => (
                      <Button key={k} size="sm" variant={sv === k ? "default" : "outline"} onClick={() => setSpanView(k)}>
                        Span {k + 1}
                        {r.controllingSpan === k && <span className="text-[10px] opacity-70">controls</span>}
                        {!s.ok && <span className="size-1.5 rounded-full bg-red-500" />}
                      </Button>
                    ))}
                    <Button size="sm" variant={sv === "piers" ? "default" : "outline"} onClick={() => setSpanView("piers")}>
                      {r.piers.length === 1 ? "Pier" : "Piers"}
                      {!r.piers.every((p) => p.ok) && <span className="size-1.5 rounded-full bg-red-500" />}
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {(["interior", "exterior"] as const).map((k) => (
                    <Button key={k} size="sm" variant={shown === k ? "default" : "outline"} onClick={() => setView(k)}>
                      {k === "interior" ? "Interior girder" : "Exterior girder"}
                      {r.controlling === k && <span className="text-[10px] opacity-70">controls</span>}
                      {!(sv === "piers" ? r.piers.every((p) => p[k].checks.every((c) => c.ok)) : r.spans[spanIdx][k].ok) && <span className="size-1.5 rounded-full bg-red-500" />}
                    </Button>
                  ))}
                  <span className="ml-auto flex gap-2">
                    <HandOff designId={design.id} designName={design.name} inputs={shownInputs} result={r.spans[spanIdx][r.spans[spanIdx].controlling]} />
                  </span>
                </div>
                <Card>
                  <CardContent className="py-3">
                    <BridgeSectionSketch inputs={inputs} />
                  </CardContent>
                </Card>
                {multi && shown && (
                  <Card>
                    <CardContent className="py-3">
                      <BridgeElevation design={r} side={shown} selected={sv === "piers" ? undefined : spanIdx} />
                    </CardContent>
                  </Card>
                )}
                {sv === "piers" && shown ? (
                  <PierResults design={r} side={shown} />
                ) : (
                  <>
                {g.df.outOfRange.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                    Outside the distribution factors&apos; range of applicability (4.6.2.2): {g.df.outOfRange.join("; ")}. Check them by another method (e.g. the lever rule or a refined analysis, 4.6.3).
                  </div>
                )}
                <Card>
                  <CardContent className="py-3">
                    <GirderSketch inputs={shownInputs} result={g} />
                    <GirderElevation inputs={shownInputs} result={g} />
                  </CardContent>
                </Card>
                <ChecksTable checks={g.checks} groupOf={groupOf} />
                <TakeoffPanel kind="lrfd-girder-check" design={design} inputs={inputs} ok={g.checks.every((c) => c.advisory || c.ok)} onSettings={(t) => setRawInputs((s) => ({ ...s, takeoff: t }))} />
                <StationTable result={g} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <KeyValues
                    title="Section properties"
                    rows={[
                      ["Girder A, I", `${fmt(g.g.A, 1)} in², ${fmt(g.g.I, 0)} in⁴`],
                      ["Girder yb, Sb, St", `${fmt(g.g.yb, 2)} in, ${fmt(g.g.Sb, 0)} in³, ${fmt(g.g.St, 0)} in³`],
                      ["Effective deck width (4.6.2.6.1)", `${fmt(g.comp.beff / 12, 3)} ft`],
                      ["Modular ratio, deck / girder", fmt(g.comp.n, 3)],
                      ["Composite A, I", `${fmt(g.comp.A, 0)} in², ${fmt(g.comp.I, 0)} in⁴`],
                      ["Composite ybc, Sbc, Stc", `${fmt(g.comp.yb, 2)} in, ${fmt(g.comp.Sbc, 0)} in³, ${fmt(g.comp.Stc, 0)} in³`],
                      ["Strands: N, Aps, cg, e", `${g.strands.N}, ${fmt(g.strands.Aps, 3)} in², ${fmt(g.strands.ybar, 2)} in, ${fmt(g.strands.e, 2)} in`],
                      ["Transfer, development length", `${fmt(g.strands.lt, 2)} ft, ${fmt(g.strands.ld, 2)} ft${g.strands.groups.some((k) => k.kind === "debonded") ? ` (debonded ${fmt(g.strands.ldDebonded, 2)} ft)` : ""}`],
                      ["Strand groups", g.strands.groups.map((k) => (k.kind === "harped" ? `${k.n} harped ${fmt(k.yEnd, 1)}→${fmt(k.yMid, 1)} in` : k.kind === "debonded" ? `${k.n} debonded ${fmt(k.bondFrom, 1)} ft at ${fmt(k.yMid, 1)} in` : `${k.n} at ${fmt(k.yMid, 1)} in`)).join("; ")],
                      ...(g.longitudinalAtBearing ? ([["5.7.3.5 at the bearing's inside edge", `${fmt(g.longitudinalAtBearing.demand, 0)} / ${fmt(g.longitudinalAtBearing.capacity, 0)} kip`]] as [string, string][]) : []),
                      ...(inputs.llDeflection ? ([["Live load deflection", `${fmt(g.llDeflection.delta)} in (${g.llDeflection.governs}), limit ${fmt((g.L * 12) / inputs.deflectionLimit)} in`]] as [string, string][]) : []),
                      ...(g.negativeSection
                        ? ([
                            ["Deck bars over the piers, As", `${fmt(g.negativeSection.As, 2)} in² in ${fmt(g.comp.beff / 12, 2)} ft`],
                            ["Over the piers: c, φ, φMn", `${fmt(g.negativeSection.c, 2)} in, ${fmt(g.negativeSection.phi)}, ${fmt(g.negativeSection.phiMn, 0)} kip·ft`],
                            ["Over the piers: Mcr (deck top), fr", `${fmt(g.negativeSection.Mcr, 0)} kip·ft, ${fmt(g.negativeSection.frDeck)} ksi`],
                          ] as [string, string][])
                        : []),
                    ]}
                  />
                  <KeyValues
                    title="Live load distribution (4.6.2.2), per lane"
                    rows={[
                      ["Design lanes", String(g.df.lanes)],
                      ["Kg (4.6.2.2.1-1)", `${fmt(g.df.Kg, 0)} in⁴`],
                      ["Moment: one lane; two or more", `${fmt(g.df.momentOne)}; ${fmt(g.df.momentMulti)} (interior)`],
                      ["Shear: one lane; two or more", `${fmt(g.df.shearOne)}; ${fmt(g.df.shearMulti)} (interior)`],
                      ...(g.exterior
                        ? ([
                            ["Lever rule (one lane, m = 1.2)", fmt(g.df.lever ?? 0)],
                            ["e for moment; for shear", `${fmt(g.df.e!.moment)}; ${fmt(g.df.e!.shear)}`],
                            ...(g.df.rigid !== undefined ? ([["Rigid cross-section", fmt(g.df.rigid)]] as [string, string][]) : []),
                          ] as [string, string][])
                        : []),
                      ["Skew: moment; shear", `${fmt(g.df.skewMoment)}; ${fmt(g.df.skewShear)}`],
                      ["Moment DF (governs)", `${fmt(g.df.moment)} (${g.df.governs.moment})`],
                      ["Shear DF (governs)", `${fmt(g.df.shear)} (${g.df.governs.shear})`],
                    ]}
                  />
                  <KeyValues
                    title={`Prestress losses (5.9.3), ${g.losses.kind}`}
                    rows={[
                      ["Eci; Ec (5.4.2.4)", `${fmt(g.losses.Eci, 0)}; ${fmt(g.losses.Ec, 0)} ksi`],
                      ["fpj", `${fmt(g.losses.fpj, 2)} ksi`],
                      ["fcgp at midspan", `${fmt(g.losses.fcgp)} ksi`],
                      ["Elastic shortening ΔfpES (5.9.3.2.3a)", `${fmt(g.losses.dES, 2)} ksi`],
                      ["Stress after transfer fpt", `${fmt(g.losses.fpt, 2)} ksi`],
                      ...(g.losses.kind === "refined"
                        ? ([
                            ["To the deck: shrinkage, creep, relaxation", `${fmt(g.losses.dSR, 2)}, ${fmt(g.losses.dCR, 2)}, ${fmt(g.losses.dR1, 2)} ksi`],
                            ["After: shrinkage, creep, relaxation", `${fmt(g.losses.dSD, 2)}, ${fmt(g.losses.dCD, 2)}, ${fmt(g.losses.dR2, 2)} ksi`],
                            ["Deck shrinkage ΔfpSS (a gain if −)", `${fmt(g.losses.dSS, 2)} ksi`],
                            ["Kid; Kdf", `${fmt(g.losses.Kid)}; ${fmt(g.losses.Kdf)}`],
                          ] as [string, string][])
                        : ([["γh; γst", `${fmt(g.losses.gh)}; ${fmt(g.losses.gst)}`]] as [string, string][])),
                      [`Long-term ΔfpLT (${g.losses.kind === "refined" ? "5.9.3.4.1-1" : "5.9.3.3-1"})`, `${fmt(g.losses.dLT, 2)} ksi`],
                      ["Effective stress fpe", `${fmt(g.losses.fpe, 2)} ksi`],
                      ["Total loss", `${fmt(((g.losses.fpj - g.losses.fpe) / g.losses.fpj) * 100, 1)} %`],
                      ["Service III γLL (T. 3.4.1-4)", g.gammaLL3 === 1 ? "1.0 (refined losses with elastic gains)" : "0.8"],
                    ]}
                  />
                  <KeyValues
                    title="Camber and deflection (in, up +)"
                    rows={[
                      ["Prestress camber at release", fmt(g.camber.dPs)],
                      ["Self-weight deflection at release", fmt(-g.camber.dGr)],
                      ["Camber at release", fmt(g.camber.cRelease)],
                      ["Creep coefficient ψ(t, ti) (5.4.2.3.2)", `${fmt(g.camber.psiCam)} at ${g.camber.tCam} days under load`],
                      [g.camber.age === inputs.tDeck ? "Camber at deck placement" : `Camber at deck placement, ${g.camber.age} days (BDM 5.5.2.1)`, fmt(g.camber.cDeck)],
                      ["Deck, haunch, diaphragms", fmt(g.camber.dDeck)],
                      ["Superimposed dead load", fmt(g.camber.dSidl)],
                      ["Net camber after the deck", fmt(g.camber.net)],
                      ...(inputs.criteria === "cdot"
                        ? ([
                            ["Camber tolerance, over or under", fmt(g.haunch.tolerance)],
                            ...(g.haunch.D1 !== undefined
                              ? ([
                                  ["Haunch at the supports, D1", fmt(g.haunch.D1, 2)],
                                  ["Haunch at midspan, predicted (D2)", fmt(g.haunch.D2!, 2)],
                                  ["Over / under-cambered at midspan", `${fmt(g.haunch.D2over!, 2)} / ${fmt(g.haunch.D2under!, 2)}`],
                                  ["Dead load haunch, Eq. 5.1", fmt(g.haunch.design, 2)],
                                ] as [string, string][])
                              : []),
                          ] as [string, string][])
                        : []),
                      ["Strength I at midspan: c, a, fps, φ", `${fmt(g.flexMid.c, 2)} in, ${fmt(g.flexMid.a, 2)} in, ${fmt(g.flexMid.fps, 1)} ksi, ${fmt(g.flexMid.phi)}`],
                    ]}
                  />
                  <KeyValues
                    title="Anchorage zone and fatigue"
                    rows={[
                      ["Splitting: 4% of Fpi (bonded strands after transfer)", `${fmt(g.splitting.demand, 1)} kip of ${fmt(g.splitting.Fpi, 0)} kip`],
                      ["Splitting: As within h/4 = " + fmt(g.splitting.zone, 1) + " in, Pr = 20 ksi × As", `${fmt(g.splitting.As, 2)} in², ${fmt(g.splitting.Pr, 1)} kip`],
                      ["Confinement", `#${g.confinement.bar} at ${fmt(g.confinement.spacing, 1)} in for ${fmt(g.confinement.length, 1)} ft (1.5d = ${fmt((1.5 * g.shape.depth) / 12, 2)} ft)`],
                      ["Fatigue truck DF (one lane, no m)", fmt(g.df.fatigue)],
                      ["Fatigue I at midspan: Mfat, top stress", (() => {
                        const m = g.stations.reduce((a, b) => (Math.abs(b.x - g.L / 2) < Math.abs(a.x - g.L / 2) ? b : a));
                        return `${fmt(m.fatigue.Mfat, 0)} kip·ft, ${fmt(m.fatigue.top)} ksi (limit ${fmt(0.4 * shownInputs.fc)})`;
                      })()],
                    ]}
                  />
                </div>
                {g.handling && <HandlingResults result={g} inputs={shownInputs} />}
                  </>
                )}
                <GirderScheduleCard inputs={inputs} design={r} />
                <p className="text-[11px] text-muted-foreground">
                  Assumptions: {multi ? "girders simple for their own weight and the deck, made continuous for later loads (5.12.3.3), a line-girder analysis with uniform EI, spanning from the abutments' bearings to the piers' centerlines; restraint moments from creep and shrinkage after continuity, relaxed by creep, (1 − e^−φ)/φ" : "simple span"}; straight, debonded and two-point harped strands; ΔfpES with fcgp at midspan (5.9.3.2.3a); γLL = 1.0 at Service III only with refined losses and elastic gains, else 0.8 (T. 3.4.1-4); shear critical section at dv from the bearing centerline; interface shear with a roughened girder top (c = 0.28 ksi, μ = 1.0) and no permanent clamping force; camber by AASHTO creep coefficients; Fatigue I on the uncracked section; splitting force from the strands bonded at the end, after transfer; lifting and hauling by PCI&apos;s lateral stability method (CB-02-16-E) with WSDOT&apos;s criteria, the prestress section by section.
                </p>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** Lifting and hauling (5.5.4.3): the sketch, and each case's working by PCI's method. */
function HandlingResults({ result: g, inputs }: { result: GirderResult; inputs: GirderInputs }) {
  const h = g.handling!;
  const L = h.lifting;
  const f2 = (v: number) => (Number.isFinite(v) ? fmt(v, 2) : "∞");
  const theta = (cases: { winds: { thetaEq: number }[] }[]) => Math.max(...cases.flatMap((k) => k.winds.map((w) => (Number.isFinite(w.thetaEq) ? Math.abs(w.thetaEq) : 0))));
  const slopeRows = (s: typeof h.hauling.crown, name: string): [string, string][] => [
    [`${name}: equilibrium tilt θeq (largest)`, `${fmt(theta(s.cases))} rad`],
    [`${name}: stresses, plumb (min; max)`, `${fmt(s.summary.minDirect)}; ${fmt(s.summary.maxDirect)} ksi`],
    [`${name}: stresses, tilted (min; max)`, `${fmt(s.summary.minStress)}; ${fmt(s.summary.maxStress)} ksi`],
    [`${name}: FS cracking; failure; rollover`, `${f2(s.summary.FScr)}; ${f2(s.summary.FSf)}; ${f2(s.summary.FSr)}`],
  ];
  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <HandlingSketch inputs={inputs} result={g} />
        <div className="grid gap-4 xl:grid-cols-2">
          <KeyValues
            title="Lifting (PCI CB-02-16), stresses + tension"
            rows={[
              ["Weight; Eci; fr", `${fmt(h.Wg, 1)} kip; ${fmt(g.losses.Eci, 0)} ksi; ${fmt(0.24 * Math.sqrt(inputs.fci))} ksi`],
              ["Camber; sweep offset factor", `${fmt(h.camberLift, 2)} in; ${fmt(L.F)}`],
              ["Initial eccentricity ei (sweep + device tolerance)", `${fmt(L.ei, 3)} in`],
              ["zo, the weight applied sideways", `${fmt(L.zo, 3)} in`],
              ["Center of gravity below the roll axis, yr", `${fmt(L.Dra, 2)} in`],
              ["Equilibrium tilt θeq (largest)", `${fmt(theta(L.cases))} rad`],
              ["Stresses, plumb (min; max)", `${fmt(L.summary.minDirect)}; ${fmt(L.summary.maxDirect)} ksi`],
              ["Stresses, tilted (min; max)", `${fmt(L.summary.minStress)}; ${fmt(L.summary.maxStress)} ksi`],
              ["FS cracking; failure", `${f2(L.summary.FScr)}; ${f2(L.summary.adjFSf)} (need 1.0; 1.5)`],
            ]}
          />
          <KeyValues
            title="Hauling (PCI CB-02-16, WSDOT), stresses + tension"
            rows={[
              ["Age; loss to hauling; camber", `${fmt(h.tHaul, 0)} days; ${fmt(h.lossToHaul, 2)} ksi; ${fmt(h.camberHaul, 2)} in`],
              ["ei; zo; height of the CG above the roll center", `${fmt(h.hauling.ei, 3)} in; ${fmt(h.hauling.zo, 3)} in; ${fmt(h.hauling.Dra, 2)} in`],
              ...slopeRows(h.hauling.crown, `Crown ${fmt(inputs.handling.crown * 100, 0)}%`),
              ...slopeRows(h.hauling.superelevation, `Superelevation ${fmt(inputs.handling.superelevation * 100, 0)}%`),
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** The piers of a continuous bridge: restraint moments, the joint, and the positive moment connection. */
function PierResults({ design, side }: { design: GirderDesign; side: "interior" | "exterior" }) {
  const rs = design.restraint!;
  const R = rs[side];
  const rl = design.spans[0][side].restraintLoads!;
  return (
    <>
      {design.piers.map((p) => {
        const d = p[side];
        return (
          <div key={p.index} className="space-y-2">
            <ChecksTable checks={d.checks} groupOf={groupOf} />
            <KeyValues
              title={`Pier ${p.index}, ${side} girder (kip·ft, + sagging)`}
              rows={[
                ["Restraint moment: creep; shrinkage; used", `${fmt(R.creep[p.index], 0)}; ${fmt(R.shrinkage[p.index], 0)}; ${fmt(R.Mr[p.index], 0)}`],
                ["Barriers and other DC; overlay (DW)", `${fmt(d.Mdc2, 0)}; ${fmt(d.Mdw, 0)}`],
                ["LL+IM positive moment at the pier", fmt(d.MllPos, 0)],
                ["Fully effective: DC2 + DW + restraint + 50% LL", `${fmt(d.Mfe, 0)} → ${fmt(d.fBottom)} ksi at the diaphragm's bottom (${d.effective ? "compression: fully effective" : "tension: not fully effective, positive moments also as simple spans"})`],
                ["Connection: As, d, φMn", `${fmt(d.connection.As, 2)} in², ${fmt(d.connection.d, 2)} in, ${fmt(d.connection.phiMn, 0)} kip·ft`],
                ["Connection: Mu+, service M, fs", `${fmt(Math.max(0, d.MuPos), 0)}, ${fmt(Math.max(0, d.Ms), 0)} kip·ft, ${fmt(d.fs, 1)} ksi`],
              ]}
            />
          </div>
        );
      })}
      <KeyValues
        title="Restraint moments: the creep and shrinkage after continuity (per span 1's girder line)"
        rows={[
          ["Girder age at continuity; final", `${fmt(rl.tc, 0)}; ${fmt(rl.tf, 0)} days`],
          ["Creep after continuity: prestress and girder; deck weight", `${fmt(rl.dPsiG)}; ${fmt(rl.dPsiD)}`],
          ["φ = ψ(tf, tc); relaxation (1 − e^−φ)/φ", `${fmt(rl.phi)}; ${fmt(rl.relax)}`],
          ["Strand stress over the period", `${fmt(rl.fpAvg, 1)} ksi`],
          ["Deck; girder shrinkage after continuity", `${fmt(rl.eDeck * 1e6, 0)}; ${fmt(rl.eGirder * 1e6, 0)} με`],
          ["Differential shrinkage force; eccentricity", `${fmt(rl.Fsh, 0)} kip; ${fmt(rl.ed, 2)} in`],
        ]}
      />
    </>
  );
}

/** Station-by-station results: moments, shears and stresses along the half span. */
function StationTable({ result }: { result: GirderResult }) {
  const neg = !!result.negativeSection;
  const head = ["Location", "x (ft)", "Mu", "φMn", ...(neg ? ["Mu−", "φMn−"] : []), "Vu", "φVn", "Release top", "Release bot", "Svc I top", "Svc III bot"];
  return (
    <Card>
      <CardContent className="overflow-x-auto py-2">
        <p className="pb-1 text-xs font-semibold">Along the span (kip·ft, kip, ksi; compression +)</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-right text-muted-foreground">
              {head.map((h, k) => (
                <th key={h} className={cn("py-1 font-normal", k === 0 && "text-left")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.stations.map((s) => (
              <tr key={s.label} className="border-b border-border/50 text-right tabular-nums">
                <td className="py-1 text-left">{s.label}</td>
                <td>{fmt(s.x, 2)}</td>
                <td>{fmt(s.Mu, 0)}</td>
                <td className={cn(!s.pier && s.Mu > s.phiMn && "text-red-600")}>{s.pier ? "—" : fmt(s.phiMn, 0)}</td>
                {neg && (
                  <>
                    <td>{s.negative && s.negative.Mu < 0 ? fmt(s.negative.Mu, 0) : "—"}</td>
                    <td className={cn(s.negative && -s.negative.Mu > result.negativeSection!.phiMn && "text-red-600")}>{s.negative && s.negative.Mu < 0 ? fmt(result.negativeSection!.phiMn, 0) : "—"}</td>
                  </>
                )}
                <td>{fmt(s.Vu, 1)}</td>
                <td className={cn(s.phiVn !== undefined && s.Vu > s.phiVn && "text-red-600")}>{s.phiVn === undefined ? "—" : fmt(s.phiVn, 1)}</td>
                <td>{fmt(s.release.top)}</td>
                <td>{fmt(s.release.bot)}</td>
                <td>{fmt(s.service.topTotal)}</td>
                <td>{fmt(s.service.botIII)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function BarChoice({ label, bar, onBar, sizes = [4, 5, 6, 7, 8, 9, 10, 11] }: { label: string; bar: number; onBar: (bar: number) => void; sizes?: number[] }) {
  return <Choice label={label} value={bar} options={sizes.map((b) => ({ value: b, label: `#${b}` }))} onChange={onBar} />;
}

/** Lifting and hauling inputs, with WSDOT's haul trucks to pick from (PGSuper's library). */
function HandlingInputs({ value: h, onChange }: { value: Handling; onChange: (h: Handling) => void }) {
  const set = <K extends keyof Handling>(k: K) => (v: Handling[K]) => onChange({ ...h, [k]: v });
  const setTruck = <K extends keyof Handling["truck"]>(k: K) => (v: number) => onChange({ ...h, truck: { ...h.truck, [k]: v } });
  const preset = HAUL_TRUCKS.find((t) => (Object.keys(t.truck) as (keyof Handling["truck"])[]).every((k) => t.truck[k] === h.truck[k]))?.name ?? "custom";
  return (
    <>
      <Toggle label="Check lifting and hauling" value={h.check} onChange={set("check")} />
      {h.check && (
        <>
          <p className="pt-2 pb-1 text-xs text-muted-foreground">Lifting from the form (at release strength)</p>
          <Field label="Lifting devices from each end" unit="ft" value={h.liftPoint} onChange={set("liftPoint")} step={0.25} />
          <Field label="Impact up" unit="%" value={h.liftImpactUp * 100} onChange={(v) => set("liftImpactUp")(v / 100)} step={5} />
          <Field label="Impact down" unit="%" value={h.liftImpactDown * 100} onChange={(v) => set("liftImpactDown")(v / 100)} step={5} />
          <Field label="Lifting device placement tolerance" unit="in" value={h.liftTolerance} onChange={set("liftTolerance")} step={0.125} />
          <p className="pt-2 pb-1 text-xs text-muted-foreground">Hauling (at f′c)</p>
          <Field label="Girder age when hauled" unit="days" value={h.haulAge} onChange={set("haulAge")} hint="Its losses to then; WSDOT's criteria take 10 days" />
          <Field label="Truck supports from each end" unit="ft" value={h.bunkPoint} onChange={set("bunkPoint")} step={0.5} />
          <Choice
            label="Haul truck"
            value={preset}
            options={[...HAUL_TRUCKS.map((t) => ({ value: t.name, label: `WSDOT ${t.name}` })), { value: "custom", label: "Custom" }]}
            onChange={(name) => {
              const t = HAUL_TRUCKS.find((x) => x.name === name);
              if (t) onChange({ ...h, truck: { ...t.truck } });
            }}
          />
          <Field label="Roll stiffness" unit="kip·in/rad" value={h.truck.Ktheta} onChange={setTruck("Ktheta")} step={5000} />
          <Field label="Roll center above the road" unit="in" value={h.truck.Hrc} onChange={setTruck("Hrc")} />
          <Field label="Girder bottom above the road" unit="in" value={h.truck.Hbg} onChange={setTruck("Hbg")} />
          <Field label="Dual tires, center to center" unit="in" value={h.truck.Wcc} onChange={setTruck("Wcc")} />
          <Field label="Truck: longest span between supports" unit="ft" value={h.truck.maxSpan} onChange={setTruck("maxSpan")} />
          <Field label="Truck: longest overhang" unit="ft" value={h.truck.maxOverhang} onChange={setTruck("maxOverhang")} />
          <Field label="Truck: heaviest girder" unit="kip" value={h.truck.maxWeight} onChange={setTruck("maxWeight")} />
          <Field label="Impact (on the normal crown)" unit="%" value={h.haulImpactUp * 100} onChange={(v) => onChange({ ...h, haulImpactUp: v / 100, haulImpactDown: v / 100 })} step={5} />
          <Field label="Normal crown slope" unit="%" value={h.crown * 100} onChange={(v) => set("crown")(v / 100)} step={0.5} />
          <Field label="Maximum superelevation" unit="%" value={h.superelevation * 100} onChange={(v) => set("superelevation")(v / 100)} step={0.5} />
          <Field label="Support placement tolerance" unit="in" value={h.haulTolerance} onChange={set("haulTolerance")} step={0.25} />
          <Field label="Speed in the turn" unit="mph" value={h.speed} onChange={set("speed")} hint="0: no centrifugal force" />
          {h.speed > 0 && <Field label="Turning radius" unit="ft" value={h.radius} onChange={set("radius")} step={10} />}
          <p className="pt-2 pb-1 text-xs text-muted-foreground">Both</p>
          <Field label="Sweep tolerance, per 10 ft of girder" unit="in" value={h.sweep} onChange={set("sweep")} step={0.0625} />
          <Field label="Wind on the girder's side" unit="psf" value={h.wind} onChange={set("wind")} />
        </>
      )}
    </>
  );
}

type Col<T> = { key: keyof T & string; label: string; unit?: string; step?: number };

/** A small editable list (strand rows, stirrup zones). */
function Rows<T extends StrandRow | StirrupZone>({ title, rows, onChange, blank, cols }: { title: string; rows: T[]; onChange: (rows: T[]) => void; blank: T; cols: Col<T>[] }) {
  return (
    <div className="py-1 text-xs">
      <p className="pb-1 text-muted-foreground">{title}</p>
      <table className="w-full">
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            {cols.map((c) => (
              <th key={c.key} className="text-left font-normal">
                {c.label}
                {c.unit ? ` (${c.unit})` : ""}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, k) => (
            <tr key={k}>
              {cols.map((c) => (
                <td key={c.key} className="pr-1">
                  {c.key === "bar" ? (
                    <select
                      value={Number(row[c.key] ?? 0)}
                      onChange={(e) => onChange(rows.map((r, j) => (j === k ? { ...r, [c.key]: Number(e.target.value) } : r)))}
                      className="h-7 w-full rounded-md border border-input bg-transparent px-1"
                    >
                      {Object.keys(BARS)
                        .filter((b) => Number(b) <= 8)
                        .map((b) => (
                          <option key={b} value={b}>
                            #{b}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      step={c.step ?? 1}
                      value={Number(row[c.key] ?? 0)}
                      onChange={(e) => e.target.value !== "" && Number.isFinite(Number(e.target.value)) && onChange(rows.map((r, j) => (j === k ? { ...r, [c.key]: Number(e.target.value) } : r)))}
                      className="h-7 w-full rounded-md border border-input bg-transparent px-1 text-right tabular-nums"
                    />
                  )}
                </td>
              ))}
              <td className="w-7">
                <Button variant="ghost" size="icon-sm" onClick={() => onChange(rows.filter((_, j) => j !== k))} disabled={rows.length <= 1} aria-label="Remove row">
                  <Trash2 />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="ghost" size="sm" className="mt-1 h-7 text-xs" onClick={() => onChange([...rows, { ...blank }])}>
        <Plus /> Add row
      </Button>
    </div>
  );
}

/** A custom section: its outline as heights and full widths, bottom to top. */
function CustomSection({ inputs, onChange }: { inputs: GirderInputs; onChange: (c: GirderInputs["custom"]) => void }) {
  const toText = (p: Profile) => p.map(([y, h]) => `${y} ${+(2 * h).toFixed(4)}`).join("\n");
  const [text, setText] = useState(toText(inputs.custom.profile));
  const parse = (t: string): Profile | null => {
    const pts = t
      .split(/\n+/)
      .map((l) => l.trim().split(/[\s,;]+/).map(Number))
      .filter((p) => p.length >= 2 && p.every(Number.isFinite))
      .map(([y, w]) => [y, w / 2] as [number, number]);
    if (pts.length < 2) return null;
    for (let k = 1; k < pts.length; k++) if (pts[k][0] < pts[k - 1][0]) return null;
    return pts;
  };
  return (
    <div className="space-y-1 py-1 text-xs">
      <p className="text-muted-foreground">Outline, bottom to top: one &ldquo;height width&rdquo; pair (in) per line, straight lines between. Two points at the same height make a step.</p>
      <textarea
        value={text}
        rows={8}
        onChange={(e) => {
          setText(e.target.value);
          const p = parse(e.target.value);
          if (p) onChange({ ...inputs.custom, profile: p });
        }}
        className="w-full rounded-md border border-input bg-transparent p-2 font-mono text-[11px]"
      />
      <Field label="Web thickness (bv)" unit="in" value={inputs.custom.web} onChange={(web) => onChange({ ...inputs.custom, web })} step={0.5} />
      <Field label="Top flange width (bvi)" unit="in" value={inputs.custom.topWidth} onChange={(topWidth) => onChange({ ...inputs.custom, topWidth })} />
    </div>
  );
}

/** The girder schedule as CDOT's worksheet B-618-CBT1 tabulates it, with the debonding table and the girder's elevation. */
function GirderScheduleCard({ inputs, design }: { inputs: GirderInputs; design: GirderDesign }) {
  const s = girderSchedule(inputs, design);
  const shownRow = s.rows.find((x) => x.span === design.controllingSpan + 1 && x.side === design.controlling) ?? s.rows[0];
  const spanIn = spanInputs(inputs, shownRow.span - 1);
  return (
    <Card>
      <CardContent className="space-y-3 py-3 text-xs">
        <div className="flex items-center gap-2">
          <p className="font-semibold">Girder schedule (CDOT B-618-CBT1)</p>
          {!s.final && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900">Preliminary: the design has failing checks, not for plans</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="text-muted-foreground">
                {SCHEDULE_HEAD.map(([a, b], k) => (
                  <th key={k} className={cn("px-1 font-normal", k > 2 && "text-right")}>
                    {a}
                    <span className="block">{b}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((row) => (
                <tr key={`${row.span}-${row.side}`} className="border-b border-border/40">
                  {scheduleCells(row).map((c, k) => (
                    <td key={k} className={cn("px-1 tabular-nums", k > 2 && "text-right")}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          As* the prestressing steel provided; Ee and Ec the strands&apos; centroid above the girder&apos;s bottom at its end and at midspan; Fj the jacking force, Ff the force after all losses; Δ the deflection at midspan from the deck, diaphragms, overlay and rails; the predicted camber at {shownRow.age} days{shownRow.age === 60 ? "" : " (CDOT's table: 60 days; the age the deck is cast)"}, for the girder alone. Acceptable camber: 30% over or under, or ±1 in, whichever is greater (B-618-CBT1 note 9).
        </p>
        {s.debond.length > 0 && (
          <div>
            <p className="pb-1 font-semibold">Debonding</p>
            <table className="whitespace-nowrap">
              <thead>
                <tr className="text-muted-foreground">
                  {["Span", "Row above bottom (in)", "Strands in row", "Debonded", "Debonded length from each end (ft)"].map((h) => (
                    <th key={h} className="px-1 text-right font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.debond.map((d, k) => (
                  <tr key={k} className="border-b border-border/40">
                    {[d.span, d.y, d.strands, d.debonded, d.length].map((c, j) => (
                      <td key={j} className="px-1 text-right tabular-nums">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <GirderScheduleSketch inputs={spanIn} shape={design.spans[shownRow.span - 1][shownRow.side].shape} span={shownRow.span} />
      </CardContent>
    </Card>
  );
}

/** Opens the results in the existing Camber and Haunch and Deck Slab designs. */
function HandOff({ designId, designName, inputs, result }: { designId: string; designName: string; inputs: GirderInputs; result: GirderResult }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (kind: "camber-haunch" | "deck-slab") => {
    setBusy(kind);
    try {
      const patch =
        kind === "camber-haunch"
          ? {
              L: result.L,
              D1: inputs.haunch,
              flange: result.shape.topWidth,
              camber: +result.camber.cDeck.toFixed(3),
              deflection: +result.camber.dTotal.toFixed(3),
              deflectionUnder: +result.camber.dTotal.toFixed(3),
              assumedAverage: inputs.haunch,
            }
          : {
              nGirders: inputs.nGirders,
              S: inputs.S,
              overhang: inputs.overhang,
              t: inputs.deckT,
              flange: result.shape.topWidth,
              barrierWidth: inputs.barrierWidth * 12,
              barrierWeight: inputs.barrierWeight,
              fc: inputs.fcDeck,
              gammaC: inputs.wcDeck,
              // The rail goes along; the girder design keeps the deck's concrete, rails and waterproofing in its quantities.
              rail: { ...GIRDER_RAIL_DEFAULT, ...(inputs.rail ?? {}) },
              fromGirder: { id: designId, name: designName },
              takeoff: { length: +deckLength(inputs).toFixed(2) },
            };
      const { designId: id } = await createLinkedDesign(designId, kind, patch);
      router.push(`/design/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the design");
      setBusy(null);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void open("camber-haunch")} disabled={!!busy} title="Starts a Camber and Haunch design with this girder's camber and dead load deflection">
        {busy === "camber-haunch" ? <Loader2 className="animate-spin" /> : <ArrowUpRight />} Camber and Haunch
      </Button>
      <Button size="sm" variant="outline" onClick={() => void open("deck-slab")} disabled={!!busy} title="Starts a Deck Slab design with this bridge's girders and deck">
        {busy === "deck-slab" ? <Loader2 className="animate-spin" /> : <ArrowUpRight />} Deck Slab
      </Button>
    </>
  );
}
