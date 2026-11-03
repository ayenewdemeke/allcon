"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { designBearing, HARDNESS, type BearingInputs, type Hardness } from "@/lib/design/bearings/elastomeric";
import { DesignError } from "@/lib/design/walls/cip";
import { BearingSketch } from "./bearing-sketch";
import { ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";

// Designing an elastomeric bearing pad: the inputs on the left, worked out as they change (sketch,
// checks and the working) on the right, saved as you go.

const groupOf = (id: string) =>
  id.startsWith("mat") || id.startsWith("geo") ? "Material and proportions" : id.startsWith("comp") || id.startsWith("strain") ? "Compression and shear strains" : id.startsWith("defl") ? "Deflection" : id.startsWith("shear") ? "Shear deformation" : id.startsWith("stab") ? "Stability" : id.startsWith("shim") ? "Steel shims" : "Anchorage";

export function BearingEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: BearingInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof BearingInputs>(key: K) => (v: BearingInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));

  const outcome = useMemo(() => {
    try {
      return { result: designBearing(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;
  const steel = inputs.pad === "steel";
  const methodB = steel && inputs.method === "B";
  const byHardness = !methodB && inputs.byHardness;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label={`Elastomeric Bearing · AASHTO LRFD, Method ${methodB ? "B" : "A"}`} canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        {/* Inputs */}
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Pad" open>
              <Choice
                label="Pad"
                value={inputs.pad}
                options={[
                  { value: "steel", label: "Steel-reinforced" },
                  { value: "plain", label: "Plain" },
                ]}
                onChange={set("pad")}
              />
              {steel && (
                <Choice
                  label="Method"
                  value={inputs.method}
                  options={[
                    { value: "B", label: "B (14.7.5)" },
                    { value: "A", label: "A (14.7.6)" },
                  ]}
                  onChange={set("method")}
                />
              )}
              <Field label="Length L (along the bridge)" unit="in" value={inputs.L} onChange={set("L")} step={0.5} />
              <Field label="Width W (across)" unit="in" value={inputs.W} onChange={set("W")} step={0.5} />
              <Field label={steel ? "Interior layer hri" : "Pad thickness"} unit="in" value={inputs.hri} onChange={set("hri")} step={0.125} />
              {steel && (
                <>
                  <Field label="Interior layers n" value={inputs.n} onChange={(v) => set("n")(Math.max(1, Math.round(v)))} />
                  <Field label="Cover layer hre (top and bottom)" unit="in" value={inputs.hre} onChange={set("hre")} step={0.0625} />
                  <Field label="Steel shim hs" unit="in" value={inputs.hs} onChange={set("hs")} step={0.0625} />
                  <Field label="Shim yield strength Fy" unit="ksi" value={inputs.Fy} onChange={set("Fy")} />
                  <Field label="Fatigue threshold ΔFTH (T. 6.6.1.2.3-1)" unit="ksi" value={inputs.dFth} onChange={set("dFth")} />
                </>
              )}
            </Section>
            <Section title="Elastomer" open>
              {!methodB && <Toggle label="Specified by hardness (else by G)" value={inputs.byHardness} onChange={set("byHardness")} />}
              {byHardness ? (
                <Choice
                  label="Hardness (durometer)"
                  value={inputs.hardness}
                  options={([50, 60, 70] as Hardness[]).map((h) => ({ value: h, label: `${h}: G ${HARDNESS[h].Gmin}–${HARDNESS[h].Gmax} ksi` }))}
                  onChange={(v) => set("hardness")(Number(v) as Hardness)}
                />
              ) : (
                <>
                  <Field label="Shear modulus G at 73°F (±15%)" unit="ksi" value={inputs.G} onChange={set("G")} step={0.01} />
                  <Field label="Creep deflection factor acr (T. 14.7.6.2-1)" value={inputs.creep} onChange={set("creep")} step={0.05} />
                </>
              )}
            </Section>
            <Section title="Loads (Service I, per bearing)" open>
              <Field label="Dead load DL" unit="kip" value={inputs.DL} onChange={set("DL")} />
              <Field label="Live load LL (no impact)" unit="kip" value={inputs.LL} onChange={set("LL")} />
              <Toggle label="Deck joint here (live load deflection ≤ 1/8 in)" value={inputs.jointed} onChange={set("jointed")} />
            </Section>
            <Section title="Shear deformation">
              <Field label="Coefficient of thermal expansion" unit="×10⁻⁶/°F" value={inputs.alpha} scale={1e6} onChange={set("alpha")} step={0.5} />
              <Field label="Expansion length" unit="ft" value={inputs.expansionLength} onChange={set("expansionLength")} />
              <Field label="Maximum design temperature" unit="°F" value={inputs.Tmax} onChange={set("Tmax")} />
              <Field label="Minimum design temperature" unit="°F" value={inputs.Tmin} onChange={set("Tmin")} />
              <Field label="Load factor γTU (Service I)" value={inputs.gammaTU} onChange={set("gammaTU")} step={0.05} />
              <Field label="Part of the thermal range taken" value={inputs.thermalFactor} onChange={set("thermalFactor")} step={0.05} />
              <Field label="Creep, shrinkage and other static" unit="in" value={inputs.otherStatic} onChange={set("otherStatic")} step={0.01} />
              <Field label="Live load and other cyclic" unit="in" value={inputs.cyclic} onChange={set("cyclic")} step={0.01} />
              {!methodB && <Toggle label="Shear deformation prevented (+10% stress limits)" value={inputs.shearPrevented} onChange={set("shearPrevented")} />}
            </Section>
            {methodB && (
              <Section title="Rotations and stability">
                <Field label="Dead load rotation θd" unit="rad" value={inputs.thetaD} onChange={set("thetaD")} step={0.001} />
                <Field label="Allowance for uncertainties (14.4.2.1)" unit="rad" value={inputs.thetaU} onChange={set("thetaU")} step={0.001} />
                <Field label="Live load rotation θL" unit="rad" value={inputs.thetaL} onChange={set("thetaL")} step={0.001} />
                <Toggle label="Deck free to translate horizontally" value={inputs.deckFree} onChange={set("deckFree")} />
              </Section>
            )}
            <Section title="Anchorage">
              <Field label="Friction coefficient μ (C14.8.3.1)" value={inputs.mu} onChange={set("mu")} step={0.05} />
            </Section>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="min-w-0 space-y-4">
          {outcome.error ? (
            <DesignErrorCard message={outcome.error} />
          ) : (
            r && (
              <>
                <ChecksBanner checks={r.checks} />
                <Card>
                  <CardContent className="py-3">
                    <BearingSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <KeyValues
                    title="Pad and loads"
                    rows={[
                      ["Shape factor S (Eq. 14.7.5.1-1)", fmt(r.pad.S, 3)],
                      ["Total elastomer hrt", `${fmt(r.pad.hrt)} in`],
                      ["Total height", `${fmt(r.pad.height)} in`],
                      ["G, least to most", `${fmt(r.pad.G.Gmin, 4)}–${fmt(r.pad.G.Gmax, 4)} ksi`],
                      ["σs (total) / σd / σL", `${fmt(r.loads.sigmaS, 4)} / ${fmt(r.loads.sigmaD, 4)} / ${fmt(r.loads.sigmaL, 4)} ksi`],
                      ["Thermal movement α L ΔT", `${fmt(r.movement.thermal, 4)} in`],
                      ["Shear deformation Δs (static / total)", `${fmt(r.movement.dsStatic, 4)} / ${fmt(r.movement.ds, 4)} in`],
                    ]}
                  />
                  <KeyValues
                    title="Deflection and anchorage"
                    rows={
                      [
                        ["Live load deflection", `${fmt(r.deflection.dL, 4)} in`],
                        ["Dead load deflection, initial / long-term", `${fmt(r.deflection.dD, 4)} / ${fmt(r.deflection.dLong, 4)} in`],
                        ...(methodB
                          ? [
                              ["Rotation, static / cyclic", `${fmt(r.strains.thetaSt, 4)} / ${fmt(r.strains.thetaCy, 4)} rad`],
                              ["Shear strains γa, γr, γs (static)", `${fmt(r.strains.aSt)}, ${fmt(r.strains.rSt)}, ${fmt(r.strains.sSt)}`],
                              ["Shear strains γa, γr, γs (cyclic)", `${fmt(r.strains.aCy)}, ${fmt(r.strains.rCy)}, ${fmt(r.strains.sCy)}`],
                            ]
                          : []),
                        ["Allowed movement before slip", `${fmt(r.anchorage.dsAllow, 4)} in`],
                      ] as [string, string][]
                    }
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
