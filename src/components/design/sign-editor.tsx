"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { designSign, type SignInputs } from "@/lib/design/signs/cantilever";
import { DesignError } from "@/lib/design/walls/cip";
import { ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section } from "./design-kit";
import { SignSketch } from "./sign-sketch";

// Designing a cantilever sign structure's shaft foundation: the inputs on the left, worked out as
// they change (elevation, checks and the loads) on the right, saved as you go.

const sizes = [3, 4, 5, 6, 7, 8, 9, 10, 11].map((b) => ({ value: b, label: `#${b}` }));

export function SignEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: SignInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof SignInputs>(key: K) => (v: SignInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));

  const outcome = useMemo(() => {
    try {
      return { result: designSign(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Cantilever Sign Foundation · AASHTO LTS" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Pole and arm (steel tubes)" open>
              <Field label="Pole length" unit="ft" value={inputs.poleLength} onChange={set("poleLength")} step={0.5} />
              <Field label="Pole diameter at the base" unit="in" value={inputs.poleBase} onChange={set("poleBase")} step={0.25} />
              <Field label="Pole diameter at the top" unit="in" value={inputs.poleTop} onChange={set("poleTop")} step={0.25} />
              <Field label="Pole wall" unit="in" value={inputs.poleWall} onChange={set("poleWall")} step={0.0625} />
              <Field label="Pole top down to the arm" unit="ft" value={inputs.armDrop} onChange={set("armDrop")} step={0.25} />
              <Field label="Arm length" unit="ft" value={inputs.armLength} onChange={set("armLength")} step={0.5} />
              <Field label="Arm diameter at the pole" unit="in" value={inputs.armBase} onChange={set("armBase")} step={0.25} />
              <Field label="Arm diameter at its end" unit="in" value={inputs.armEnd} onChange={set("armEnd")} step={0.25} />
              <Field label="Arm wall" unit="in" value={inputs.armWall} onChange={set("armWall")} step={0.0625} />
            </Section>
            <Section title="Sign panel (aluminum)" open>
              <Field label="Length" unit="ft" value={inputs.signLength} onChange={set("signLength")} step={0.5} />
              <Field label="Height" unit="ft" value={inputs.signHeight} onChange={set("signHeight")} step={0.5} />
              <Field label="Pole to the panel's center" unit="ft" value={inputs.signOffset} onChange={set("signOffset")} step={0.5} />
              <Field label="Panel thickness" unit="in" value={inputs.signThickness} onChange={set("signThickness")} step={0.03125} />
              <Field label="Supports and anchors" unit="% of panel" value={inputs.miscPct} onChange={set("miscPct")} />
            </Section>
            <Section title="Wind (LTS 3.8)" open>
              <Field label="Basic wind speed (for the MRI)" unit="mph" value={inputs.V} onChange={set("V")} />
              <Field label="Directionality Kd (3.8.5)" value={inputs.Kd} onChange={set("Kd")} step={0.05} />
              <Field label="Gust effect G (3.8.6)" value={inputs.G} onChange={set("G")} step={0.01} />
              <Field label="Velocity conversion Cv (3.8.3)" value={inputs.Cv} onChange={set("Cv")} step={0.05} />
              <Field label="Sign panel drag Cd (T. 3.8.7-1)" value={inputs.CdSign} onChange={set("CdSign")} step={0.01} />
            </Section>
            <Section title="Drilled shaft" open>
              <Field label="Diameter" unit="in" value={inputs.shaftD} onChange={set("shaftD")} />
              <Field label="Length" unit="ft" value={inputs.shaftLength} onChange={set("shaftLength")} step={0.5} />
              <Field label="Clear cover to the ties" unit="in" value={inputs.cover} onChange={set("cover")} step={0.25} />
              <Field label="Longitudinal bars" value={inputs.bars} onChange={(v) => set("bars")(Math.max(4, Math.round(v)))} />
              <Choice label="Bar size" value={inputs.bar} options={sizes} onChange={(v) => set("bar")(Number(v))} />
              <Choice label="Tie bar" value={inputs.tieBar} options={sizes.slice(0, 4)} onChange={(v) => set("tieBar")(Number(v))} />
              <Field label="Tie spacing" unit="in" value={inputs.tieSpacing} onChange={set("tieSpacing")} step={0.5} />
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
              <Field label="Resistance factor, bending (5.5.4.2)" value={inputs.phiM} onChange={set("phiM")} step={0.05} />
            </Section>
            <Section title="Geotechnical">
              <Field label="Unit tip resistance qp" unit="ksf" value={inputs.qp} onChange={set("qp")} />
              <Field label="Unit side resistance qs" unit="ksf" value={inputs.qs} onChange={set("qs")} step={0.1} />
              <Field label="Resistance factor, tip" value={inputs.phiQp} onChange={set("phiQp")} step={0.05} />
              <Field label="Resistance factor, side" value={inputs.phiQs} onChange={set("phiQs")} step={0.05} />
              <Field label="Shaft length counted for side resistance" unit="ft" value={inputs.sideLength} onChange={set("sideLength")} step={0.5} />
            </Section>
            <Section title="Lateral response (from a p–y analysis)">
              <Field label="Largest moment in the shaft" unit="kip·ft" value={inputs.pyMoment} onChange={set("pyMoment")} />
              <Field label="Largest shear in the shaft" unit="kip" value={inputs.pyShear} onChange={set("pyShear")} />
              <Field label="Top deflection" unit="in" value={inputs.pyDeflection} onChange={set("pyDeflection")} step={0.001} />
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
                    <SignSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={(id) => (id === "axial" ? "Geotechnical" : "Shaft")} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <KeyValues
                    title="Loads"
                    rows={[
                      ["Dead load (pole, arm, panel, supports)", `${fmt(r.dead.DC)} kip`],
                      ["Kz, Cd members", `${fmt(r.wind.kz, 4)}, ${fmt(r.wind.CdMember, 3)} (Cv V d ${fmt(r.wind.CvVd, 1)})`],
                      ["Wind pressure, members / panel", `${fmt(r.wind.qMember, 2)} / ${fmt(r.wind.qSign, 2)} psf`],
                      ["Wind on panel / arm / pole", `${fmt(r.wind.Wsign)} / ${fmt(r.wind.Warm)} / ${fmt(r.wind.Wpole)} kip`],
                      ["Overturning / torsion at the shaft top", `${fmt(r.wind.Mx, 2)} / ${fmt(r.wind.T, 2)} kip·ft`],
                    ]}
                  />
                  <KeyValues
                    title="Shaft"
                    rows={[
                      ["Axial demand (with its weight)", `${fmt(r.shaft.Pu, 2)} kip`],
                      ["Tip / side resistance", `${fmt(r.shaft.Rp, 1)} / ${fmt(r.shaft.Rs, 1)} kip`],
                      ["Mn at the smallest axial load", `${fmt(r.shaft.Mn, 1)} kip·ft`],
                      ["dv", `${fmt(r.shaft.dv, 2)} in`],
                      ["Torsional cracking Tcr", `${fmt(r.shaft.Tcr, 0)} kip·in`],
                      ["Top deflection (p–y)", `${fmt(inputs.pyDeflection, 4)} in`],
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
