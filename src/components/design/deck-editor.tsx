"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { designDeck, RAIL_DEFAULT, type DeckInputs } from "@/lib/design/decks/deck";
import { RAILS, type RailKey, type RailSteel, type TestLevel } from "@/lib/design/decks/rails";
import { DesignError } from "@/lib/design/walls/cip";
import { BarsField, ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section } from "./design-kit";
import { TakeoffPanel } from "./takeoff-panel";
import { DeckSketch } from "./deck-sketch";

// Designing a deck slab: the inputs on the left, worked out as they change (section, checks and the
// strip's design moments) on the right, saved as you go.

const groupOf = (id: string) => (id.startsWith("pos") ? "Bottom transverse bars" : id.startsWith("neg") ? "Top transverse bars" : id.startsWith("long") ? "Longitudinal bars" : id.startsWith("rail") ? "Bridge rail (A13.3, 13.7.3)" : "Overhang (A13.4.1)");

export function DeckEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: DeckInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof DeckInputs>(key: K) => (v: DeckInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));

  const outcome = useMemo(() => {
    try {
      return { result: designDeck(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;
  const railChoice = { ...RAIL_DEFAULT, ...(inputs.rail ?? {}) };
  const setRail = (patch: Partial<NonNullable<DeckInputs["rail"]>>) => setInputs((s) => ({ ...s, rail: { ...RAIL_DEFAULT, ...(s.rail ?? {}), ...patch } }));

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Deck Slab · AASHTO LRFD, equivalent strips" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Deck and girders" open>
              <Field label="Number of girders" value={inputs.nGirders} onChange={(v) => set("nGirders")(Math.max(2, Math.round(v)))} />
              <Field label="Girder spacing S (≤ 15 ft)" unit="ft" value={inputs.S} onChange={set("S")} step={0.25} />
              <Field label="Overhang (edge to girder centerline)" unit="ft" value={inputs.overhang} onChange={set("overhang")} step={0.25} />
              <Field label="Slab thickness" unit="in" value={inputs.t} onChange={set("t")} step={0.25} />
              <Field label="Overhang thickness at the edge" unit="in" value={inputs.tEdge} onChange={set("tEdge")} step={0.25} />
              <Field label="Overhang thickness at the flange" unit="in" value={inputs.tFlange} onChange={set("tFlange")} step={0.25} />
              <Field label="Girder top flange width" unit="in" value={inputs.flange} onChange={set("flange")} />
              <Field label="Girder centerline to −M design section (4.6.2.1.6)" unit="in" value={inputs.dSection} onChange={set("dSection")} />
            </Section>
            <Section title="Bridge rail" open>
              <Choice label="Rail" value={railChoice.type} options={[...RAILS.map((x) => ({ value: x.key as RailKey, label: `${x.name} (${x.sheet})` })), { value: "custom" as RailKey, label: "Other barrier (entered)" }]} onChange={(v) => setRail({ type: v })} />
              {railChoice.type !== "custom" && (
                <>
                  <Choice label="Test level" value={railChoice.testLevel} options={[{ value: "TL-5" as TestLevel, label: "TL-5 (42 in, as the worksheet designs it)" }, { value: "TL-4" as TestLevel, label: "TL-4" }]} onChange={(v) => setRail({ testLevel: v })} />
                  <Choice label="Rail bars" value={railChoice.steel} options={[{ value: "A1035" as RailSteel, label: "ASTM A1035CS (most of the state)" }, { value: "A955" as RailSteel, label: "Stainless A955 (Interstate and the mountain counties)" }]} onChange={(v) => setRail({ steel: v })} />
                  {r?.rail && (
                    <p className="text-[11px] text-muted-foreground">
                      {fmt(r.rail.rail.width, 1)} in wide, {fmt(r.rail.rail.height, 0)} in high, {fmt(r.rail.weight * 1000, 0)} plf, c.g. {fmt(r.rail.cg, 2)} in from the deck edge
                      {r.rail.resistance ? `; Rw ${fmt(r.rail.resistance.interior.Rw, 0)} kip (yield lines), Mc ${fmt(r.applied.Mc, 1)} kip·ft/ft (averaged over its height), T ${fmt(r.applied.T, 2)} kip/ft` : ""}. Paid by the foot under {r.rail.rail.payItem}.
                    </p>
                  )}
                </>
              )}
            </Section>
            <Section title={railChoice.type === "custom" ? "Barrier and wearing surface" : "Wearing surface"} open>
              {railChoice.type === "custom" && (
                <>
                  <Field label="Barrier base width" unit="in" value={inputs.barrierWidth} onChange={set("barrierWidth")} />
                  <Field label="Barrier weight" unit="plf" value={inputs.barrierWeight} scale={1000} onChange={set("barrierWeight")} />
                  <Field label="Barrier c.g. from the deck edge" unit="in" value={inputs.barrierCg} onChange={set("barrierCg")} step={0.25} />
                </>
              )}
              <Field label="Wearing surface" unit="in" value={inputs.wearing} onChange={set("wearing")} step={0.5} />
              <Field label="Wearing surface unit weight" unit="pcf" value={inputs.gammaWS} scale={1000} onChange={set("gammaWS")} />
              <Field label="Utilities" unit="psf" value={inputs.utilities} scale={1000} onChange={set("utilities")} />
            </Section>
            <Section title="Concrete and bars" open>
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
              <Field label="Concrete unit weight" unit="pcf" value={inputs.gammaC} scale={1000} onChange={set("gammaC")} />
              <Field label="Cover, top" unit="in" value={inputs.coverTop} onChange={set("coverTop")} step={0.25} />
              <Field label="Cover, bottom" unit="in" value={inputs.coverBot} onChange={set("coverBot")} step={0.25} />
              <Field label="Exposure class (1 or 2)" value={inputs.exposure} onChange={(v) => set("exposure")(v >= 1.5 ? 2 : 1)} />
              <BarsField label="Top transverse" value={inputs.topBars} onChange={set("topBars")} />
              <BarsField label="Bottom transverse" value={inputs.botBars} onChange={set("botBars")} />
              <BarsField label="Top longitudinal" value={inputs.topLong} onChange={set("topLong")} />
              <BarsField label="Bottom longitudinal" value={inputs.botLong} onChange={set("botLong")} />
            </Section>
            {!(r?.rail?.resistance) && (
              <Section title="Overhang: vehicle collision (A13)">
                {r?.rail && <p className="text-[11px] text-muted-foreground">A post-and-tube rail on a curb: enter the deck&apos;s design forces from the rail&apos;s design (AASHTO A13.4.3). Its Fv, Lv and lever arm come from the rail.</p>}
                <Field label="Barrier resistance at its base Mc" unit="kip·ft/ft" value={inputs.Mc} onChange={set("Mc")} step={0.1} />
                <Field label="Axial tension T = Rw/(Lc + 2H)" unit="kip/ft" value={inputs.T} onChange={set("T")} step={0.1} />
                {!r?.rail && (
                  <>
                    <Field label="Vertical force Fv (T. A13.2-1)" unit="kip" value={inputs.Fv} onChange={set("Fv")} />
                    <Field label="Its distribution Lv" unit="ft" value={inputs.Lv} onChange={set("Lv")} />
                    <Field label="Its lever arm" unit="ft" value={inputs.la} onChange={set("la")} step={0.05} />
                  </>
                )}
              </Section>
            )}
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
                    <DeckSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                <TakeoffPanel kind="deck-slab" design={design} inputs={inputs} ok={r.checks.every((c) => c.advisory || c.ok)} onSettings={(t) => setInputs((s) => ({ ...s, takeoff: t }))} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <KeyValues
                    title="Positive moment (kip·ft/ft)"
                    rows={[
                      ["Section, from the deck edge", `${fmt(r.pos.x, 2)} ft`],
                      ["DC / DW", `${fmt(r.pos.MDC)} / ${fmt(r.pos.MDW)}`],
                      ["LL + IM (strip " + fmt(r.geometry.stripPos, 2) + " ft)", fmt(r.pos.MLL)],
                      ["Strength I / Service I", `${fmt(r.pos.Mu)} / ${fmt(r.pos.Ms)}`],
                    ]}
                  />
                  <KeyValues
                    title="Negative moment (kip·ft/ft)"
                    rows={[
                      ["Section, from the deck edge", `${fmt(r.neg.x, 2)} ft`],
                      ["DC / DW", `${fmt(r.neg.MDC)} / ${fmt(r.neg.MDW)}`],
                      ["LL + IM (strip " + fmt(r.geometry.stripNeg, 2) + " ft)", fmt(r.neg.MLL)],
                      ["Strength I / Service I", `${fmt(r.neg.Mu)} / ${fmt(r.neg.Ms)}`],
                    ]}
                  />
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
