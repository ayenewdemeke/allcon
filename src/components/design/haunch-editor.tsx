"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { designHaunch, type HaunchInputs } from "@/lib/design/girders/haunch";
import { DesignError } from "@/lib/design/walls/cip";
import { ChecksBanner, ChecksTable, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";
import { HaunchSketch } from "./haunch-sketch";

// Setting a girder span's haunch: the inputs on the left, worked out as they change (elevation,
// checks and the haunches) on the right, saved as you go.

const groupOf = (id: string) => (id === "over" || id === "under" ? "Camber tolerances" : "Haunch");

export function HaunchEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: HaunchInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof HaunchInputs>(key: K) => (v: HaunchInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));

  const outcome = useMemo(() => {
    try {
      return { result: designHaunch(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Camber and Haunch" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Span and girder" open>
              <Field label="Span (between bearings)" unit="ft" value={inputs.L} onChange={set("L")} />
              <Field label="Haunch at the supports (girder CL)" unit="in" value={inputs.D1} onChange={set("D1")} step={0.25} />
              <Field label="Top flange width" unit="in" value={inputs.flange} onChange={set("flange")} />
              <Field label="Camber at deck placement" unit="in" value={inputs.camber} onChange={set("camber")} step={0.05} hint="Prestress camber less self weight, from the girder's design" />
              <Field label="Dead load deflection (down −)" unit="in" value={inputs.deflection} onChange={set("deflection")} step={0.05} />
              <Field label="Average haunch assumed for dead load" unit="in" value={inputs.assumedAverage} onChange={set("assumedAverage")} step={0.05} />
            </Section>
            <Section title="Deck geometry" open>
              <Field label="Cross-slope" unit="ft/ft" value={inputs.crossSlope} onChange={set("crossSlope")} step={0.005} />
              <Toggle label="Girders sloped to match the cross-slope" value={inputs.slopedGirders} onChange={set("slopedGirders")} />
              <Field label="First bearing station" unit="ft" value={inputs.startStation} onChange={set("startStation")} />
              <Field label="VPI station" unit="ft" value={inputs.vpiStation} onChange={set("vpiStation")} />
              <Field label="VPI elevation" unit="ft" value={inputs.vpiElevation} onChange={set("vpiElevation")} />
              <Field label="Vertical curve length (0: none)" unit="ft" value={inputs.curveLength} onChange={set("curveLength")} />
              <Field label="Grade in" unit="%" value={inputs.gradeIn} onChange={set("gradeIn")} step={0.25} />
              <Field label="Grade out" unit="%" value={inputs.gradeOut} onChange={set("gradeOut")} step={0.25} />
              <Field label="Horizontal curve radius at the girder (0: tangent)" unit="ft" value={inputs.radius} onChange={set("radius")} />
              {inputs.radius > 0 && <Toggle label="Deck slopes down toward the curve's center" value={inputs.slopeTowardCenter} onChange={set("slopeTowardCenter")} />}
            </Section>
            <Section title="Owner's limits and tolerances" open>
              <Field label="Minimum haunch at the supports (flange edge)" unit="in" value={inputs.minSupport} onChange={set("minSupport")} step={0.25} />
              <Field label="Minimum haunch at midspan" unit="in" value={inputs.minMidspan} onChange={set("minMidspan")} step={0.25} />
              <Field label="Over-camber" unit="% of camber" value={inputs.overPct} onChange={set("overPct")} />
              <Field label="Over-camber, at least" unit="in" value={inputs.overMin} onChange={set("overMin")} step={0.25} />
              <Toggle label="Shims at the bearings take the over-camber" value={inputs.shims} onChange={set("shims")} />
              <Field label="Under-camber" unit="% of camber" value={inputs.underPct} onChange={set("underPct")} />
              <Field label="Under-camber, at least" unit="in" value={inputs.underMin} onChange={set("underMin")} step={0.25} />
              <Field label="Dead load deflection with the under-camber haunch" unit="in" value={inputs.deflectionUnder} onChange={set("deflectionUnder")} step={0.05} hint="From the girder's design, with the average below" />
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
                    <HaunchSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                <KeyValues
                  title="Haunch (inches)"
                  rows={[
                    ["Vertical curve, rise over the chord at midspan", fmt(r.vertical)],
                    ["Chorded girder on the curve", fmt(r.chord)],
                    ["Cross-slope across half the flange", fmt(r.crossEffect)],
                    ["At midspan, as predicted (girder CL)", fmt(r.D2)],
                    ["Average for dead load (parabolic)", fmt(r.avg)],
                    [inputs.shims ? "Shim height for over-camber" : "Over-cambered, at midspan (flange edge)", fmt(inputs.shims ? r.shim : r.D2over)],
                    ["Under-cambered, at midspan; its average", `${fmt(r.D2under)}; ${fmt(r.avgUnder)} (use for the dead load deflection)`],
                    ["Residual camber, under-cambered", fmt(r.residual)],
                  ]}
                />
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
