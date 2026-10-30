"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CASES, designCbc, type CbcInputs, type CbcResult, type Steel } from "@/lib/design/culverts/cbc";
import { DesignError } from "@/lib/design/walls/cip";
import { ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";
import { CbcSketch } from "./wall-sketch";

// Designing a box culvert: the inputs on the left, worked out as they change (section and moment
// diagram, checks, the steel each face needs and the frame's results) on the right, saved as you go.

const groupOf = (id: string) => (id.startsWith("top") ? "Top slab" : id.startsWith("bottom") ? "Bottom slab" : id.startsWith("iwall") ? "Interior walls" : "Exterior walls");

export function CbcEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: CbcInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const [moments, setMoments] = useState(true);
  const set = <K extends keyof CbcInputs>(key: K) => (v: CbcInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const setSteel = (key: keyof Steel) => (v: number) => setInputs((s) => ({ ...s, steel: { ...s.steel, [key]: v } }));

  const outcome = useMemo(() => {
    try {
      return { result: designCbc(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;
  const multi = inputs.cells > 1;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Box Culvert · AASHTO LRFD, MnDOT" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        {/* Inputs */}
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Geometry" open>
              <Choice
                label="Cells"
                value={inputs.cells}
                options={[1, 2, 3, 4, 5, 6].map((c) => ({ value: c, label: c === 1 ? "Single cell" : `${c} cells` }))}
                onChange={set("cells")}
              />
              <Field label={multi ? "Clear span of each cell" : "Clear span"} unit="ft" value={inputs.span} onChange={set("span")} step={0.5} />
              <Field label="Clear rise" unit="ft" value={inputs.rise} onChange={set("rise")} step={0.5} />
              <Field label="Top slab" unit="in" value={inputs.Tt} onChange={set("Tt")} />
              <Field label="Bottom slab" unit="in" value={inputs.Tb} onChange={set("Tb")} />
              <Field label="Exterior walls" unit="in" value={inputs.Ts} onChange={set("Ts")} />
              {multi && <Field label="Interior walls" unit="in" value={inputs.Ti} onChange={set("Ti")} />}
              <Field label="Haunches (45°)" unit="in" value={inputs.haunch} onChange={set("haunch")} />
              <Field label="Fill over the top slab" unit="ft" value={inputs.fill} onChange={set("fill")} step={0.5} />
            </Section>
            <Section title="Soil and water">
              <Field label="Fill unit weight γs" unit="pcf" value={inputs.gammaS} scale={1000} onChange={set("gammaS")} />
              <Field label="Lateral earth, max (at rest)" unit="pcf" value={inputs.efwMax} scale={1000} onChange={set("efwMax")} />
              <Field label="Lateral earth, min" unit="pcf" value={inputs.efwMin} scale={1000} onChange={set("efwMin")} />
              <Field label="ka for live load surcharge" value={inputs.ka} onChange={set("ka")} step={0.01} />
              <Toggle label="Compacted fill at the sides (Fe ≤ 1.15)" value={inputs.compactedSides} onChange={set("compactedSides")} />
              <Toggle label="Case with the culvert full of water" value={inputs.water} onChange={set("water")} />
            </Section>
            <Section title="Live load">
              <Toggle label="HL-93 truck and tandem" value={inputs.liveLoad} onChange={set("liveLoad")} />
              {inputs.liveLoad && (
                <>
                  <Field label="Spread through fill (LLDF)" value={inputs.lldf} onChange={set("lldf")} step={0.05} />
                  <Field label="Multiple presence factor" value={inputs.mpf} onChange={set("mpf")} step={0.05} />
                </>
              )}
            </Section>
            <Section title="Reinforcement" open>
              <Field label="Top slab, inside" unit="in²/ft" value={inputs.steel.topIn} onChange={setSteel("topIn")} step={0.01} />
              <Field label="Top slab, outside" unit="in²/ft" value={inputs.steel.topOut} onChange={setSteel("topOut")} step={0.01} />
              <Field label="Bottom slab, inside" unit="in²/ft" value={inputs.steel.botIn} onChange={setSteel("botIn")} step={0.01} />
              <Field label="Bottom slab, outside" unit="in²/ft" value={inputs.steel.botOut} onChange={setSteel("botOut")} step={0.01} />
              <Field label="Exterior walls, inside" unit="in²/ft" value={inputs.steel.wallIn} onChange={setSteel("wallIn")} step={0.01} />
              <Field label="Exterior walls, outside" unit="in²/ft" value={inputs.steel.wallOut} onChange={setSteel("wallOut")} step={0.01} />
              {multi && <Field label="Interior walls, each face" unit="in²/ft" value={inputs.steel.intWall} onChange={setSteel("intWall")} step={0.01} />}
              <Field label="Clear cover" unit="in" value={inputs.cover} onChange={set("cover")} step={0.25} />
              <Field label="Wire diameter assumed for d" unit="in" value={inputs.dw} onChange={set("dw")} step={0.125} />
              <Field label="Wire spacing (crack control)" unit="in" value={inputs.spacing} onChange={set("spacing")} />
            </Section>
            <Section title="Concrete and steel">
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="fy (65 welded wire, 60 bars)" unit="ksi" value={inputs.fy} onChange={set("fy")} />
              <Field label="Concrete unit weight" unit="pcf" value={inputs.gammaC} scale={1000} onChange={set("gammaC")} />
              <Choice
                label="Exposure"
                value={inputs.gammaE}
                options={[
                  { value: 0.75, label: "Class 2 (γe 0.75)" },
                  { value: 1, label: "Class 1 (γe 1.00)" },
                ]}
                onChange={set("gammaE")}
              />
              <Field label="Maximum aggregate" unit="in" value={inputs.agg} onChange={set("agg")} step={0.125} />
            </Section>
            <Section title="Factors">
              <Field label="η on EV and EH (redundancy)" value={inputs.eta} onChange={set("eta")} step={0.05} />
              <Field label="Flexure φf (1.0 precast)" value={inputs.phiF} onChange={set("phiF")} step={0.05} />
              <Field label="Shear φv" value={inputs.phiV} onChange={set("phiV")} step={0.05} />
              <Field label="Compression φ" value={inputs.phiC} onChange={set("phiC")} step={0.05} />
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
                    <CbcSketch inputs={inputs} result={r} moments={moments} />
                    <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                      <input type="checkbox" checked={moments} onChange={(e) => setMoments(e.target.checked)} />
                      Factored moment envelope (Strength I, kip·in/ft, drawn on the tension side)
                    </label>
                  </CardContent>
                </Card>
                <SteelSummary r={r} />
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                <Working r={r} />
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** The steel each face needs, by what governs it. */
function SteelSummary({ r }: { r: CbcResult }) {
  return (
    <Card>
      <CardContent className="overflow-x-auto py-3 text-xs">
        <p className="pb-1 font-semibold">Steel (in²/ft)</p>
        <table className="w-full">
          <thead>
            <tr className="text-right text-muted-foreground">
              <th className="text-left font-normal">Face</th>
              <th className="font-normal">Flexure</th>
              <th className="font-normal">Crack control</th>
              <th className="font-normal">Minimum</th>
              <th className="font-normal">Needed</th>
              <th className="font-normal">Provided</th>
            </tr>
          </thead>
          <tbody>
            {r.governs.map((g) => {
              const flex = g.flex.flex.AsReq;
              const crack = g.crack?.crack?.AsReq ?? 0;
              const min = Math.max(0.002 * 12 * g.h, 0.06);
              const need = Math.max(flex, crack, min);
              return (
                <tr key={g.label} className="border-b border-border/40 text-right tabular-nums">
                  <td className="text-left">{g.label}</td>
                  <td className={need === flex ? "font-medium" : ""}>{fmt(flex)}</td>
                  <td className={need === crack ? "font-medium" : ""}>{g.crack ? fmt(crack) : "—"}</td>
                  <td className={need === min ? "font-medium" : ""}>{fmt(min)}</td>
                  <td>{fmt(need)}</td>
                  <td className={g.As + 1e-9 < need ? "text-red-600" : "text-emerald-600"}>{fmt(g.As)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** The working: loads, live load, and the frame's results at the design sections. */
function Working({ r }: { r: CbcResult }) {
  const L = r.loads;
  const stations = r.model.stations.map((s, m) => ({ s, m })).filter((x) => x.s.role !== "shear");
  const strength = (m: number, sign: 1 | -1) => r.variants[m].list.filter((v) => v.strength).reduce((w, v) => (sign * v.M > sign * w ? v.M : w), 0);
  const thrust = (m: number) => Math.max(...r.variants[m].list.filter((v) => v.strength).map((v) => v.N));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <KeyValues
        title="Loads"
        rows={[
          ["Top slab DC", `${fmt(L.DCtop)} klf`],
          ["Soil reaction to DC", `${fmt(L.DCbottom)} klf`],
          ["Fe (embankment)", fmt(L.Fe, 3)],
          ["EV on the top slab", `${fmt(L.EV)} klf`],
          ["EH max, top / bottom", `${fmt(L.EHtop.max)} / ${fmt(L.EHbot.max)} klf`],
          ["EH min, top / bottom", `${fmt(L.EHtop.min)} / ${fmt(L.EHbot.min)} klf`],
          ["heq top / bottom", `${fmt(L.heq1, 2)} / ${fmt(L.heq2, 2)} ft`],
          ["LS top / bottom", `${fmt(L.LStop)} / ${fmt(L.LSbot)} klf`],
          ["Water at the bottom", `${fmt(L.WAbot)} klf`],
        ]}
      />
      <KeyValues
        title="Live load"
        rows={[
          ["Dynamic load allowance IM", `${fmt(r.live.IM * 100, 1)}%`],
          ["Distribution", r.live.shallow ? "Strip method (fill < 2 ft)" : "Spread through the fill"],
          ["Footprint across / along the span (one axle)", `${fmt(r.live.Wp, 2)} / ${fmt(r.live.Lp, 2)} ft`],
          ...r.live.vehicles.map((v) => [v.name, `${fmt(v.w)} ksf over ${fmt(v.L, 2)} ft`] as [string, string]),
          ["Lane load", r.live.lane ? `${fmt(r.live.wLane)} ksf` : "No (span < 15 ft)"],
          ["Frame elements", String(r.model.elements.length)],
        ]}
      />
      <Card className="xl:col-span-2">
        <CardContent className="overflow-x-auto py-3 text-xs">
          <p className="pb-1 font-semibold">Unfactored moments (kip·in/ft; + tension inside) and the Strength I extremes</p>
          <table className="w-full">
            <thead>
              <tr className="text-right text-muted-foreground">
                <th className="text-left font-normal">Section</th>
                {CASES.map((c) => (
                  <th key={c.id} className="font-normal" title={c.name}>
                    {c.id}
                  </th>
                ))}
                <th className="font-normal">LL+IM +</th>
                <th className="font-normal">LL+IM −</th>
                <th className="font-normal">Mu +</th>
                <th className="font-normal">Mu −</th>
                <th className="font-normal">Pu kip</th>
              </tr>
            </thead>
            <tbody>
              {stations.map(({ s, m }) => (
                <tr key={s.id} className="border-b border-border/40 text-right tabular-nums">
                  <td className="text-left whitespace-nowrap">{s.name}</td>
                  {CASES.map((c) => (
                    <td key={c.id}>{(r.unfactored[c.id][m].M * 12).toFixed(2)}</td>
                  ))}
                  <td>{(r.env[m].pos.M * 12).toFixed(2)}</td>
                  <td>{(r.env[m].neg.M * 12).toFixed(2)}</td>
                  <td className="font-medium">{(strength(m, 1) * 12).toFixed(2)}</td>
                  <td className="font-medium">{(strength(m, -1) * 12).toFixed(2)}</td>
                  <td>{thrust(m).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
