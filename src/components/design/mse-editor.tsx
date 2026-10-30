"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DesignError } from "@/lib/design/walls/cip";
import { designMseWall, REINFORCEMENTS, type MseFactors, type MseInputs, type MseResult } from "@/lib/design/walls/mse";
import { BarsField, ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";
import { MseSketch } from "./wall-sketch";

// Designing an MSE wall: the inputs on the left, worked out as they change (sketch, checks, the
// layers and the working) on the right, saved as you go.

const groupOf = (id: string) => (id.startsWith("geom") ? "Geometry" : id.startsWith("ext") ? "External stability" : id.startsWith("int") ? "Internal stability" : "Facing panel");

export function MseEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: MseInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof MseInputs>(key: K) => (v: MseInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const setFactor = (key: keyof MseFactors) => (v: number) => setInputs((s) => ({ ...s, factors: { ...s.factors, [key]: v } }));

  const outcome = useMemo(() => {
    try {
      return { result: designMseWall(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;
  const type = inputs.reinforcement;
  const steel = type === "steelstrip" || type === "steelgrid";

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="MSE Wall · AASHTO LRFD" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        {/* Inputs */}
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Geometry" open>
              <Field label="Design height H (top of leveling pad)" unit="ft" value={inputs.H} onChange={set("H")} step={0.25} />
              <Field label="Reinforcement length L" unit="ft" value={inputs.L} onChange={set("L")} step={0.5} hint={`0.7H = ${fmt(0.7 * inputs.H, 2)} ft`} />
              <Field label="Embedment" unit="ft" value={inputs.embedment} onChange={set("embedment")} step={0.25} />
              <Field label="Backslope (H:1V, 0 = level)" unit="H:1V" value={inputs.backslope} onChange={set("backslope")} step={0.5} />
              <Choice
                label="Wall"
                value={inputs.wallType}
                options={[
                  { value: "wall", label: "Retaining wall" },
                  { value: "abutment", label: "Abutment / wingwall" },
                ]}
                onChange={set("wallType")}
              />
            </Section>
            <Section title="Soils" open>
              <Field label="Reinforced fill γr" unit="pcf" value={inputs.gammaR} scale={1000} onChange={set("gammaR")} />
              <Field label="Reinforced fill φr" unit="deg" value={inputs.phiR} onChange={set("phiR")} />
              <Field label="Retained fill γ" unit="pcf" value={inputs.gammaRet} scale={1000} onChange={set("gammaRet")} />
              <Field label="Retained fill φ" unit="deg" value={inputs.phiRet} onChange={set("phiRet")} />
              <Toggle label="Friction at the back of the reinforced zone δ = β" value={inputs.delta === null} onChange={(auto) => set("delta")(auto ? null : 0)} />
              {inputs.delta !== null && <Field label="δ" unit="deg" value={inputs.delta} onChange={set("delta")} />}
              <Field label="Foundation soil φ" unit="deg" value={inputs.phiF} onChange={set("phiF")} />
              <Field label="Nominal bearing resistance qn" unit="ksf" value={inputs.qn} onChange={set("qn")} step={0.1} />
            </Section>
            <Section title="Live load and seismic">
              <Toggle label="Live load surcharge" value={inputs.liveLoad} onChange={set("liveLoad")} />
              {inputs.liveLoad && inputs.wallType === "wall" && <Field label="Wall to edge of traffic" unit="ft" value={inputs.trafficDistance} onChange={set("trafficDistance")} />}
              <Toggle label="Seismic (Extreme Event I)" value={inputs.seismic} onChange={set("seismic")} />
              {inputs.seismic && (
                <>
                  <Field label="PGA" unit="g" value={inputs.pga} onChange={set("pga")} step={0.005} />
                  <Field label="Site factor Fpga" value={inputs.fpga} onChange={set("fpga")} step={0.1} />
                  <Field label="kh / As (0.5 if it can move 1–2 in)" value={inputs.khFactor} onChange={set("khFactor")} step={0.5} />
                </>
              )}
            </Section>
            <Section title="Reinforcement" open>
              <Choice label="Type" value={type} options={REINFORCEMENTS.map((k) => ({ value: k.id, label: k.name }))} onChange={set("reinforcement")} />
              <Field label="Vertical spacing Sv" unit="ft" value={inputs.Sv} onChange={set("Sv")} step={0.25} />
              <Field label="Depth of the top layer" unit="ft" value={inputs.topLayer} onChange={set("topLayer")} step={0.25} />
              {!steel && (
                <>
                  <Field label="Long-term strength Tal" unit="lb/ft" value={inputs.Tal} scale={1000} step={100} onChange={set("Tal")} hint="The product's long-term design strength, with its reduction factors" />
                  <Field label="Coverage ratio Rc" value={inputs.Rc} onChange={set("Rc")} step={0.05} />
                </>
              )}
              {steel && (
                <>
                  <Field label="Steel yield Fy" unit="ksi" value={inputs.fyReinf} onChange={set("fyReinf")} />
                  <Field label="Design life (corrosion loss)" unit="yr" value={inputs.designLife} onChange={set("designLife")} step={25} />
                </>
              )}
              {type === "steelstrip" && (
                <>
                  <Field label="Strip width" unit="in" value={inputs.stripWidth} onChange={set("stripWidth")} step={0.25} />
                  <Field label="Strip thickness" unit="in" value={inputs.stripThickness} onChange={set("stripThickness")} step={0.01} />
                  <Field label="Strip spacing along the wall" unit="ft" value={inputs.stripSpacing} onChange={set("stripSpacing")} step={0.25} />
                  <Field label="Fill uniformity Cu = D60/D10" value={inputs.cu} onChange={set("cu")} step={0.5} />
                </>
              )}
              {type === "steelgrid" && (
                <>
                  <Field label="Longitudinal wire diameter" unit="in" value={inputs.gridLongDia} onChange={set("gridLongDia")} step={0.01} />
                  <Field label="Longitudinal wire spacing" unit="in" value={inputs.gridLongSpacing} onChange={set("gridLongSpacing")} />
                  <Field label="Transverse wire diameter t" unit="in" value={inputs.gridTransDia} onChange={set("gridTransDia")} step={0.01} />
                  <Field label="Transverse wire spacing St" unit="in" value={inputs.gridTransSpacing} onChange={set("gridTransSpacing")} />
                  <Field label="Coverage ratio Rc" value={inputs.Rc} onChange={set("Rc")} step={0.05} />
                </>
              )}
            </Section>
            <Section title="Facing panel">
              <Field label="Panel thickness" unit="in" value={inputs.panelT} onChange={set("panelT")} step={0.5} />
              <Field label="Span between connections" unit="in" value={inputs.panelSpan} onChange={set("panelSpan")} />
              <Field label="Clear cover (vertical bars)" unit="in" value={inputs.panelCover} onChange={set("panelCover")} step={0.25} />
              <BarsField label="Vertical bars" value={inputs.panelV} onChange={set("panelV")} />
              <BarsField label="Horizontal bars" value={inputs.panelH} onChange={set("panelH")} />
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
              <Choice
                label="Exposure class"
                value={inputs.exposure}
                options={[
                  { value: 1, label: "Class 1" },
                  { value: 2, label: "Class 2" },
                ]}
                onChange={set("exposure")}
              />
            </Section>
            <Section title="Resistance factors and limits">
              <Field label="Bearing φb" value={inputs.phiB} onChange={set("phiB")} step={0.05} />
              <Field label="Bearing, extreme event" value={inputs.phiBEE} onChange={set("phiBEE")} step={0.05} />
              <Field label="Sliding φτ" value={inputs.phiS} onChange={set("phiS")} step={0.05} />
              <Field label="Sliding, extreme event" value={inputs.phiSEE} onChange={set("phiSEE")} step={0.05} />
              <Choice
                label="Eccentricity limit"
                value={inputs.eccDivisor}
                options={[
                  { value: 3, label: "L/3 (AASHTO 11.6.3.3)" },
                  { value: 4, label: "L/4 (older practice)" },
                ]}
                onChange={set("eccDivisor")}
              />
              <p className="pt-1 text-[11px] text-muted-foreground">Pullout and tensile resistance factors follow AASHTO T. 11.5.7-1 for the reinforcement type.</p>
            </Section>
            <Section title="Load factors">
              <Field label="γEV, max" value={inputs.factors.evMax} onChange={setFactor("evMax")} step={0.05} />
              <Field label="γEV, min" value={inputs.factors.evMin} onChange={setFactor("evMin")} step={0.05} />
              <Field label="γEH" value={inputs.factors.eh} onChange={setFactor("eh")} step={0.05} />
              <Field label="γLS, Strength I" value={inputs.factors.ls} onChange={setFactor("ls")} step={0.05} />
              <Field label="γEQ (live load), Extreme Event I" value={inputs.factors.lsEE} onChange={setFactor("lsEE")} step={0.05} />
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
                    <MseSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                <Working r={r} seismic={inputs.seismic} />
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** The working: soil, loads, load groups and each layer, for checking by hand. */
function Working({ r, seismic }: { r: MseResult; seismic: boolean }) {
  const g = r.groups;
  const groups = [
    ["Strength I, max (bearing)", g.StrMax],
    ["Strength I, min (sliding, eccentricity)", g.StrMin],
    ...(g.EEMax && g.EEMin
      ? [
          ["Extreme Event I, with LL (bearing)", g.EEMax],
          ["Extreme Event I (sliding, eccentricity)", g.EEMin],
        ]
      : []),
  ] as [string, NonNullable<typeof g.EEMax>][];
  const loads = r.loads;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <KeyValues
        title="Soil"
        rows={[
          ["Backslope β", `${fmt(r.soil.beta, 2)}°`],
          ["δ", `${fmt(r.soil.delta, 2)}°`],
          ["Ka, retained fill (Coulomb)", fmt(r.soil.Ka, 4)],
          ["Ka, reinforced fill (internal)", fmt(r.soil.KaInt, 4)],
          ["Height at the back h", `${fmt(r.soil.h, 3)} ft`],
          ...(r.soil.heq ? [["Live load surcharge heq", `${fmt(r.soil.heq, 2)} ft`] as [string, string]] : []),
          ["μ = tan(min φ)", fmt(r.soil.mu, 3)],
          ...(r.soil.kh !== undefined
            ? ([
                ["kh", fmt(r.soil.kh, 4)],
                ["θMO", `${fmt(r.soil.thetaMO!, 3)}°`],
                ["KAE (Mononobe–Okabe)", fmt(r.soil.KAE!, 4)],
              ] as [string, string][])
            : []),
        ]}
      />
      <KeyValues
        title="Unfactored loads (kip/ft)"
        rows={[
          ["EV1 reinforced zone", fmt(loads.EV1)],
          ["EV2 backslope over it", fmt(loads.EV2)],
          ["PEH earth pressure", fmt(loads.PEH)],
          ["  horizontal / vertical", `${fmt(loads.EHH)} / ${fmt(loads.EHV)}`],
          ["LS surcharge, vertical / horizontal", `${fmt(loads.LSV)} / ${fmt(loads.LSH)}`],
          ...(loads.PEQ !== undefined
            ? ([
                ["PIR inertia / PAE seismic pressure", `${fmt(loads.PIR!)} / ${fmt(loads.PAE!)}`],
                ["PEQ / MEQ (kip·ft/ft)", `${fmt(loads.PEQ)} / ${fmt(loads.MEQ!)}`],
              ] as [string, string][])
            : []),
        ]}
      />
      <Card className="xl:col-span-2">
        <CardContent className="overflow-x-auto py-3 text-xs">
          <p className="pb-1 font-semibold">Load groups (moments about the center of the base)</p>
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-normal">Group</th>
                <th className="text-right font-normal">ΣV kip/ft</th>
                <th className="text-right font-normal">ΣH kip/ft</th>
                <th className="text-right font-normal">ΣM kip·ft/ft</th>
                <th className="text-right font-normal">e ft</th>
                <th className="text-right font-normal">σV ksf</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([name, x]) => (
                <tr key={name} className="border-b border-border/40">
                  <td>{name}</td>
                  <td className="text-right tabular-nums">{fmt(x.V)}</td>
                  <td className="text-right tabular-nums">{fmt(x.H)}</td>
                  <td className="text-right tabular-nums">{fmt(x.M)}</td>
                  <td className="text-right tabular-nums">{fmt(x.e)}</td>
                  <td className="text-right tabular-nums">{fmt(x.sigma)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardContent className="overflow-x-auto py-3 text-xs">
          <p className="pb-1 font-semibold">
            Layers: {r.internal.kind.name.toLowerCase()}, Tal {fmt(r.internal.Tal * 1000, 0)} lb/ft, Rc {fmt(r.internal.Rc, 3)}
            {r.internal.Es > 0 && `, corrosion loss ${fmt(r.internal.Es, 4)} in`}
          </p>
          <table className="w-full">
            <thead>
              <tr className="text-right text-muted-foreground">
                <th className="text-left font-normal">z ft</th>
                <th className="font-normal">Sv ft</th>
                <th className="font-normal">kr</th>
                <th className="font-normal">F*</th>
                <th className="font-normal">σv ksf</th>
                <th className="font-normal">Tmax kip/ft</th>
                <th className="font-normal">La ft</th>
                <th className="font-normal">Le ft</th>
                <th className="font-normal">Pr kip/ft</th>
                <th className="font-normal">Tr kip/ft</th>
                {seismic && <th className="font-normal">Ttotal EE</th>}
                {seismic && <th className="font-normal">Pr EE</th>}
              </tr>
            </thead>
            <tbody>
              {r.internal.layers.map((l) => (
                <tr key={l.z} className="border-b border-border/40 text-right tabular-nums">
                  <td className="text-left">{fmt(l.z, 2)}</td>
                  <td>{fmt(l.Svi, 2)}</td>
                  <td>{fmt(l.kr, 4)}</td>
                  <td>{fmt(l.Fstar, 3)}</td>
                  <td>{fmt(l.sigmaV)}</td>
                  <td className={l.Tstr > Math.min(l.Pr, l.Tr) ? "text-red-600" : ""}>{fmt(l.Tstr)}</td>
                  <td>{fmt(l.LA, 2)}</td>
                  <td>{fmt(l.Le, 2)}</td>
                  <td>{fmt(l.Pr)}</td>
                  <td>{fmt(l.Tr)}</td>
                  {seismic && <td className={l.Tee > Math.min(l.PrEE, l.TrEE) ? "text-red-600" : ""}>{fmt(l.Tee)}</td>}
                  {seismic && <td>{fmt(l.PrEE)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <KeyValues
        title="Facing panel"
        rows={[
          ["Factored pressure pu", `${fmt(r.panel.pu)} ksf`],
          ["Service pressure ps", `${fmt(r.panel.ps)} ksf`],
          ["Spans: horizontal / vertical", `${fmt(r.panel.spanH, 2)} / ${fmt(r.panel.spanV, 2)} ft`],
          ["Mu horizontal / vertical", `${fmt(r.panel.horPos.Mu)} / ${fmt(r.panel.vertPos.Mu)} kip·ft/ft`],
          ["Mcr", `${fmt(r.panel.vertPos.Mcr)} kip·ft/ft`],
          ["φ (from εt), the four faces", [r.panel.vertPos, r.panel.vertNeg, r.panel.horPos, r.panel.horNeg].map((p) => fmt(p.phi, 3)).join(" / ")],
        ]}
      />
    </div>
  );
}
