"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { designApproachSlab, SLEEPER_OF, type ApproachSlabInputs } from "@/lib/design/approach/approach-slab";
import { APPROACH_GROUPS } from "@/lib/design/approach/approach-slab-calc";
import { DesignError } from "@/lib/design/walls/cip";
import { CRITERIA } from "@/lib/design/agency-checks";
import { useCdot } from "./agency-context";
import { BarsField, ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";
import { TakeoffPanel } from "./takeoff-panel";
import { ApproachSlabSketch } from "./approach-slab-sketch";

// Designing an approach slab: the inputs on the left, worked out as they change (the sketch, the
// checks, the moments and the details and quantities) on the right, saved as you go.

const groupOf = (id: string) => APPROACH_GROUPS.find((g) => g.of(id))?.title ?? "Other";

export function ApproachSlabEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: ApproachSlabInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof ApproachSlabInputs>(key: K) => (v: ApproachSlabInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const cdot = useCdot(); // CDOT's criteria are offered with its rules on (or where the design already uses them)
  const criteria = inputs.criteria ?? "aashto";

  const outcome = useMemo(() => {
    try {
      return { result: designApproachSlab(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label={criteria === "cdot" ? `Approach Slab · AASHTO LRFD, CDOT BDM 11.3.7 and ${inputs.joint === "device" ? "B-601-1EA" : "B-601-1"}` : "Approach Slab · AASHTO LRFD"} canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            {(cdot || criteria === "cdot") && <Choice label="Design criteria" value={criteria} options={CRITERIA} onChange={set("criteria")} />}
            <Section title="Slab" open>
              <Field label="Length, abutment back face to the slab's end" unit="ft" value={inputs.L} onChange={set("L")} hint={r?.worksheet ? `B-601-1EA: #${r.worksheet.bar} @ ${r.worksheet.spacing} in bottom at this length` : "B-601-1EA covers 20 ft up to 31 ft"} />
              <Field label="Width" unit="ft" value={inputs.W} onChange={set("W")} />
              <Field label="Clear roadway width (for lanes)" unit="ft" value={inputs.roadway} onChange={set("roadway")} />
              <Field label="Skew" unit="deg" value={inputs.skew} onChange={set("skew")} />
              <Field label="Thickness" unit="in" value={inputs.t} onChange={set("t")} step={0.5} />
              <Field label="Design span / length (CDOT 0.5)" value={inputs.supportLoss} onChange={set("supportLoss")} step={0.05} hint="CDOT BDM 11.3.7: designed for 50% of the slab's length (PCI). 1.0 spans the whole length." />
              <Field label="HMA overlay (0 for bare concrete)" unit="in" value={inputs.wearing} onChange={set("wearing")} step={0.5} />
              <Choice label="Joint at the slab's end (BDM 14.4.2)" value={inputs.joint} options={[{ value: "device", label: "0–4 in expansion device on the sleeper (B-601-1EA)" }, { value: "none", label: "Poured joint only, movement ≤ ¾ in (B-601-1)" }]} onChange={(v) => setInputs((s) => ({ ...s, joint: v, ...SLEEPER_OF[v] }))} />
            </Section>
            <Section title="Concrete and bars" open>
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
              <Field label="Concrete unit weight" unit="pcf" value={inputs.gammaC} scale={1000} onChange={set("gammaC")} />
              <Field label="Cover, top (chain wear)" unit="in" value={inputs.coverTop} onChange={set("coverTop")} step={0.25} />
              <Field label="Cover, bottom (cast on earth)" unit="in" value={inputs.coverBot} onChange={set("coverBot")} step={0.25} />
              <Field label="Exposure class (1 or 2)" value={inputs.exposure} onChange={(v) => set("exposure")(v >= 1.5 ? 2 : 1)} />
              <BarsField label="Main, bottom along the roadway" value={inputs.mainBars} onChange={set("mainBars")} />
              <BarsField label="Bottom transverse (distribution)" value={inputs.distBars} onChange={set("distBars")} />
              <BarsField label="Top longitudinal" value={inputs.topLong} onChange={set("topLong")} />
              <BarsField label="Top transverse" value={inputs.topTrans} onChange={set("topTrans")} />
            </Section>
            <Section title="Anchorage to the abutment" open>
              <BarsField label="Dowels" value={inputs.dowels} onChange={set("dowels")} />
              <Field label="Embedment into the slab" unit="in" value={inputs.dowelSlab} onChange={set("dowelSlab")} />
              <Field label="Embedment into the abutment (hooked)" unit="in" value={inputs.dowelAbut} onChange={set("dowelAbut")} />
              <Field label="Hooked leg" unit="in" value={inputs.dowelHook} onChange={set("dowelHook")} />
              <Field label="Seat on the notch (B-601-1EA: 6 in)" unit="in" value={inputs.seat} onChange={set("seat")} />
            </Section>
            <Section title="Sleeper slab" open>
              <Toggle label="Sleeper slab under the free end" value={inputs.sleeper} onChange={set("sleeper")} />
              {inputs.sleeper && (
                <>
                  <Field label="Width along the roadway" unit="ft" value={inputs.sleeperB} onChange={set("sleeperB")} step={0.5} />
                  <Field label="Thickness" unit="in" value={inputs.sleeperT} onChange={set("sleeperT")} />
                  <Field label="The slab's ledge on it" unit="in" value={inputs.sleeperSeat} onChange={set("sleeperSeat")} />
                  <Field label="Block under the device, width" unit="in" value={inputs.blockW} onChange={set("blockW")} />
                  <Field label="Factored bearing resistance (geotech)" unit="ksf" value={inputs.qR} onChange={set("qR")} step={0.5} />
                  <BarsField label={inputs.joint === "device" ? "Bent bars, 2 each place" : "Closed hoops"} value={inputs.sleeperBars} onChange={set("sleeperBars")} />
                  <BarsField label="Along it, each face" value={inputs.sleeperLong} onChange={set("sleeperLong")} />
                </>
              )}
            </Section>
            <Section title="Barrier on the edge (A13.4)">
              <Toggle label="A barrier or transition on the slab" value={inputs.barrier} onChange={set("barrier")} />
              {inputs.barrier && (
                <>
                  <Field label="Barrier's Mc at its base" unit="kip·ft/ft" value={inputs.Mc} onChange={set("Mc")} step={0.1} />
                  <Field label="Axial tension T" unit="kip/ft" value={inputs.T} onChange={set("T")} step={0.1} />
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
                <ChecksBanner checks={r.checks} extra={<span className="ml-auto text-xs">Design span {fmt(r.span.S, 2)} ft</span>} />
                <Card>
                  <CardContent className="py-3">
                    <ApproachSlabSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                <TakeoffPanel kind="approach-slab" design={design} inputs={inputs} ok={r.checks.every((c) => c.advisory || c.ok)} onSettings={(t) => setInputs((s) => ({ ...s, takeoff: t }))} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <KeyValues
                    title="Strip (AASHTO 4.6.2.3)"
                    rows={[
                      ["Design lanes", String(r.span.NL)],
                      ["One lane E₁ / more lanes Eₘ", `${fmt(r.span.E1, 1)} / ${fmt(r.span.Em, 1)} in`],
                      ["Strip used", `${fmt(r.span.E / 12, 2)} ft`],
                      ["Skew factor r", fmt(r.span.r)],
                      ["Live load", r.span.axlesOnly ? "Axles only (span ≤ 15 ft)" : "HL-93 with lane"],
                    ]}
                  />
                  <KeyValues
                    title="Moments per foot (kip·ft/ft)"
                    rows={[
                      ["DC / DW", `${fmt(r.loads.MDC)} / ${fmt(r.loads.MDW)}`],
                      ["LL + IM", fmt(r.loads.MLL)],
                      ["Strength I / Service I", `${fmt(r.loads.Mu)} / ${fmt(r.loads.Ms)}`],
                      ["Shear Vu (kip/ft)", fmt(r.loads.Vu)],
                      ["Governing vehicle", r.loads.gov.M],
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
