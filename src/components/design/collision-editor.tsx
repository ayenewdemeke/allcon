"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { designCollision, type CollisionInputs } from "@/lib/design/piers/collision";
import { DesignError } from "@/lib/design/walls/cip";
import { CollisionSketch } from "./collision-sketch";
import { ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";

// Designing a round pier column for vehicle collision: the inputs on the left, worked out as they
// change (column, interaction diagram, checks and the working) on the right, saved as you go.

const groupOf = (id: string) => (id.startsWith("shear") ? "Shear" : "Axial load and bending");
const sizes = [3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 18].map((b) => ({ value: b, label: `#${b}` }));

export function CollisionEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: CollisionInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof CollisionInputs>(key: K) => (v: CollisionInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));

  const outcome = useMemo(() => {
    try {
      return { result: designCollision(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Pier Column Collision · AASHTO LRFD 3.6.5" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Column" open>
              <Field label="Diameter" unit="in" value={inputs.D} onChange={set("D")} />
              <Field label="Clear cover to the ties" unit="in" value={inputs.cover} onChange={set("cover")} step={0.25} />
              <Field label="Longitudinal bars" value={inputs.bars} onChange={(v) => set("bars")(Math.max(4, Math.round(v)))} />
              <Choice label="Bar size" value={inputs.bar} options={sizes} onChange={(v) => set("bar")(Number(v))} />
              <Choice label="Tie or spiral bar" value={inputs.tieBar} options={sizes.slice(0, 4)} onChange={(v) => set("tieBar")(Number(v))} />
              <Field label="Legs in each spacing" value={inputs.tieLegs} onChange={(v) => set("tieLegs")(Math.max(1, Math.round(v)))} />
              <Field label="Tie spacing" unit="in" value={inputs.tieSpacing} onChange={set("tieSpacing")} step={0.5} />
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
            </Section>
            <Section title="Height and fixity" open>
              <Field label="Column, top of shaft to cap" unit="ft" value={inputs.height} onChange={set("height")} step={0.5} />
              <Field label="Cap depth" unit="ft" value={inputs.capDepth} onChange={set("capDepth")} step={0.25} />
              <Field label="Shaft diameter" unit="in" value={inputs.shaftD} onChange={set("shaftD")} />
              <Field label="Ground above the top of the shaft" unit="ft" value={inputs.shaftCover} onChange={set("shaftCover")} step={0.5} />
              <Field label="Top of shaft to its point of fixity" unit="ft" value={inputs.fixity} onChange={set("fixity")} step={0.5} />
              <Field label="Columns in the bent" value={inputs.columns} onChange={(v) => set("columns")(Math.max(1, Math.round(v)))} hint="The cap sways; the others share the load" />
            </Section>
            <Section title="Loads (Extreme Event II)" open>
              <Field label="Collision force (3.6.5.1)" unit="kip" value={inputs.CT} onChange={set("CT")} />
              <Field label="Height above the ground" unit="ft" value={inputs.impact} onChange={set("impact")} step={0.5} />
              <Field label="Axial dead load on the column" unit="kip" value={inputs.PDC} onChange={set("PDC")} />
              <Toggle label="Forces from a frame analysis" value={inputs.useFrame} onChange={set("useFrame")} />
              {inputs.useFrame && (
                <>
                  <Field label="Shear Vu" unit="kip" value={inputs.Vu} onChange={set("Vu")} />
                  <Field label="Moment Mu" unit="kip·ft" value={inputs.Mu} onChange={set("Mu")} />
                </>
              )}
              <Field label="Resistance factor, shear (1.3.2.1)" value={inputs.phiV} onChange={set("phiV")} step={0.05} />
              <Field label="Resistance factor, bending" value={inputs.phiM} onChange={set("phiM")} step={0.05} />
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
                    <CollisionSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <KeyValues
                    title="Forces"
                    rows={[
                      ["Column, fixity to cap mid-depth", `${fmt(r.L)} ft`],
                      ["Shear below / above the impact", inputs.useFrame ? "from the frame" : `${fmt(r.fixed.Vbottom, 1)} / ${fmt(r.fixed.Vtop, 1)} kip`],
                      ["Moment at column base / impact / cap", inputs.useFrame ? "from the frame" : `${fmt(Math.abs(r.fixed.M(inputs.fixity)), 0)} / ${fmt(r.fixed.Mimpact, 0)} / ${fmt(Math.abs(r.fixed.M(r.L - inputs.capDepth / 2)), 0)} kip·ft`],
                      ["Moment at the shaft's fixity", inputs.useFrame ? "from the frame" : `${fmt(r.fixed.Mbottom, 0)} kip·ft`],
                      ["Design Vu / Mu", `${fmt(r.Vu, 1)} kip / ${fmt(r.Mu, 0)} kip·ft`],
                    ]}
                  />
                  <KeyValues
                    title="Resistance"
                    rows={[
                      ["dv (C5.7.2.8)", `${fmt(r.shear.dv, 2)} in`],
                      ["Vc / Vs", `${fmt(r.shear.Vc, 1)} / ${fmt(r.shear.Vs, 1)} kip`],
                      ...r.cases.map((c) => [`Mn at Pu = ${fmt(c.Pu, 0)} kip`, `${fmt(c.Mn, 0)} kip·ft`] as [string, string]),
                      ["P0", `${fmt(r.section.P0, 0)} kip`],
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
