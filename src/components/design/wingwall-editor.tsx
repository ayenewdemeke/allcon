"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DesignError } from "@/lib/design/walls/cip";
import { designWingwall, type WingwallInputs } from "@/lib/design/walls/wingwall";
import { BarsField, ChecksBanner, ChecksTable, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";
import { WingwallSketch } from "./wingwall-sketch";

// Designing a cantilever wingwall: the inputs on the left, worked out as they change (sketch,
// checks, and the forces at Sections A and B) on the right, saved as you go.

export function WingwallEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: WingwallInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof WingwallInputs>(key: K) => (v: WingwallInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));

  const outcome = useMemo(() => {
    try {
      return { result: designWingwall(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Cantilever Wingwall · AASHTO LRFD" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Geometry" open>
              <Field label="Height at the abutment H" unit="ft" value={inputs.H} onChange={set("H")} step={0.5} />
              <Field label="Pressure depth at the tip h" unit="ft" value={inputs.h} onChange={set("h")} step={0.5} />
              <Field label="Length from the abutment L" unit="ft" value={inputs.L} onChange={set("L")} step={0.5} />
              <Field label="Thickness t" unit="in" value={inputs.t} onChange={set("t")} />
              <Field label="Abutment width" unit="ft" value={inputs.A} onChange={set("A")} step={0.25} />
              <Field label="Skew" unit="deg" value={inputs.skew} onChange={set("skew")} />
            </Section>
            <Section title="Backfill and surcharge" open>
              <Field label="Backfill unit weight γs" unit="pcf" value={inputs.gammaS} scale={1000} onChange={set("gammaS")} />
              <Toggle label="At rest, k0 = 1 − sin φ (3.11.5.2)" value={inputs.atRest} onChange={set("atRest")} />
              {inputs.atRest ? <Field label="Backfill friction angle φ" unit="deg" value={inputs.phi} onChange={set("phi")} /> : <Field label="Lateral earth pressure coefficient k" value={inputs.k} onChange={set("k")} step={0.01} />}
              <Field label="Live load surcharge height (3.11.6.4)" unit="ft" value={inputs.heq} onChange={set("heq")} step={0.5} />
            </Section>
            <Section title="Load factors (T. 3.4.1-1 and -2)">
              <Field label="γDC" value={inputs.gDC} onChange={set("gDC")} step={0.05} />
              <Field label={inputs.atRest ? "γEH (at rest)" : "γEH"} value={inputs.gEH} onChange={set("gEH")} step={0.05} />
              <Field label="γLS" value={inputs.gLS} onChange={set("gLS")} step={0.05} />
            </Section>
            <Section title="Concrete and reinforcement" open>
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
              <Field label="Concrete unit weight γc" unit="pcf" value={inputs.gammaC} scale={1000} onChange={set("gammaC")} />
              <BarsField label="Horizontal bars, retained face" value={inputs.bars} onChange={set("bars")} />
              <Field label="Cover" unit="in" value={inputs.cover} onChange={set("cover")} step={0.25} />
              <Field label="Exposure class (1 or 2)" value={inputs.exposure} onChange={(v) => set("exposure")(v >= 1.5 ? 2 : 1)} />
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
                    <WingwallSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={() => "Section A: horizontal bars"} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <KeyValues
                    title="Earth pressure and Section A"
                    rows={[
                      ["k (W = k γs)", `${fmt(r.soil.k, 4)} (${fmt(r.soil.W * 1000, 1)} pcf)`],
                      ["Thrust P, service / strength", `${fmt(r.service.P)} / ${fmt(r.strength.P)} kip`],
                      ["Moment about the abutment face", `${fmt(r.service.MA)} / ${fmt(r.strength.MA)} kip·ft`],
                      ["Moment about the top", `${fmt(r.service.MC)} / ${fmt(r.strength.MC)} kip·ft`],
                      ["Thrust from the abutment / top (service)", `${fmt(r.service.x)} / ${fmt(r.service.y)} ft`],
                      ["Per foot of height, Ms / Mu", `${fmt(r.sectionA.Ms)} / ${fmt(r.sectionA.Mu)} kip·ft/ft`],
                      ["Self weight, and its moment (factored)", `${fmt(r.wall.Vs)} kip, ${fmt(r.wall.Mu)} kip·ft`],
                    ]}
                  />
                  <KeyValues
                    title="Section B: to the abutment (service / strength)"
                    rows={[
                      ["Abutment width along the skew", `${fmt(r.Askew)} ft`],
                      ["Tension P", `${fmt(r.sectionB.service.P)} / ${fmt(r.sectionB.strength.P)} kip`],
                      ["Shear V", `${fmt(r.sectionB.service.V)} / ${fmt(r.sectionB.strength.V)} kip`],
                      ["My", `${fmt(r.sectionB.service.My)} / ${fmt(r.sectionB.strength.My)} kip·ft`],
                      ["Mx", `${fmt(r.sectionB.service.Mx)} / ${fmt(r.sectionB.strength.Mx)} kip·ft`],
                      ["Torsion Tz", `${fmt(r.sectionB.service.Tz)} / ${fmt(r.sectionB.strength.Tz)} kip·ft`],
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
