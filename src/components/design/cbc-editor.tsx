"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CASES, checkGroup, designCbc, PHI_BOX, type CbcInputs, type CbcResult, type Face } from "@/lib/design/culverts/cbc";
import { DesignError } from "@/lib/design/walls/cip";
import { BarsField, ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, KeyValues, Section, Toggle } from "./design-kit";
import { TakeoffPanel } from "./takeoff-panel";
import { WingwallInputs, WingwallResults } from "./culvert-wingwalls";
import { CbcSketch } from "./wall-sketch";

// Designing a box culvert: the inputs on the left, worked out as they change (section and moment
// diagram, checks, the steel each face needs and the frame's results) on the right, saved as you go.

const FACES: { key: Face; label: string }[] = [
  { key: "topIn", label: "Top slab, inside" },
  { key: "topOut", label: "Top slab, outside" },
  { key: "botIn", label: "Bottom slab, inside" },
  { key: "botOut", label: "Bottom slab, outside" },
  { key: "wallIn", label: "Exterior walls, inside" },
  { key: "wallOut", label: "Exterior walls, outside" },
  { key: "intWall", label: "Interior walls, each face" },
];


export function CbcEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: CbcInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const [moments, setMoments] = useState(true);
  const set = <K extends keyof CbcInputs>(key: K) => (v: CbcInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const setSteel = (key: Face) => (v: number) => setInputs((s) => ({ ...s, steel: { ...s.steel, [key]: v } }));
  const setBars = (key: Face) => (v: CbcInputs["bars"][Face]) => setInputs((s) => ({ ...s, bars: { ...s.bars, [key]: v } }));

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
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Box Culvert · AASHTO LRFD" canMakeCalc={!!r} />

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
              <Choice
                label="Type"
                value={inputs.reinf}
                options={[
                  { value: "bars", label: "Rebars" },
                  { value: "wwr", label: "Welded wire" },
                ]}
                // fy follows the type while it's at the usual value for the other one.
                onChange={(v) => setInputs((s) => ({ ...s, reinf: v, fy: v === "wwr" && s.fy === 60 ? 65 : v === "bars" && s.fy === 65 ? 60 : s.fy }))}
              />
              {FACES.filter((f) => multi || f.key !== "intWall").map((f) =>
                inputs.reinf === "bars" ? (
                  <BarsField key={f.key} label={f.label} value={inputs.bars[f.key]} onChange={setBars(f.key)} />
                ) : (
                  <Field key={f.key} label={f.label} unit="in²/ft" value={inputs.steel[f.key]} onChange={setSteel(f.key)} step={0.01} />
                ),
              )}
              <Field label="Clear cover" unit="in" value={inputs.cover} onChange={set("cover")} step={0.25} />
              {inputs.reinf === "bars" && (
                <>
                  <Toggle label="Corner bars c1/c2 bent into the slabs (M-601-1)" value={!!inputs.cornerBars} onChange={set("cornerBars")} />
                  {inputs.cornerBars && <p className="pb-1 text-[11px] text-muted-foreground">The walls&apos; outside bars bend into the slabs and lap t1/b1: a slab&apos;s outside face at an exterior wall has both. Their legs come from M-601-1 Sheet 2, where the box is in its table.</p>}
                </>
              )}
              {inputs.reinf === "wwr" && (
                <>
                  <Field label="Wire diameter" unit="in" value={inputs.dw} onChange={set("dw")} step={0.125} />
                  <Field label="Wire spacing" unit="in" value={inputs.spacing} onChange={set("spacing")} />
                </>
              )}
            </Section>
            <Section title="Concrete and steel">
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
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
            <Section title="Extension of an existing barrel" open={(inputs.extension?.pieces.length ?? 0) > 0}>
              <p className="pb-1 text-[11px] text-muted-foreground">
                {(inputs.extension?.pieces.length ?? 0) > 0
                  ? "Each piece is new barrel with a joint to the existing barrel (dowels) at one end and a new headwall at the other. Their lengths are the take-off's barrel."
                  : "None: a new culvert, a headwall at each end. Add the extension's pieces (one at each end extended)."}
              </p>
              {(inputs.extension?.pieces ?? []).map((p, k) => (
                <div key={k} className="flex items-center gap-2">
                  <input className="w-20 rounded border bg-background px-1.5 py-0.5 text-xs" value={p.name} aria-label="Piece name" onChange={(e) => setInputs((s) => ({ ...s, extension: { ...s.extension!, pieces: s.extension!.pieces.map((q, j) => (j === k ? { ...q, name: e.target.value } : q)) } }))} />
                  <div className="flex-1">
                    <Field label="Length" unit="ft" value={p.length} step={0.5} onChange={(v) => setInputs((s) => ({ ...s, extension: { ...s.extension!, pieces: s.extension!.pieces.map((q, j) => (j === k ? { ...q, length: v } : q)) } }))} />
                  </div>
                  <button type="button" className="text-xs text-muted-foreground hover:text-red-600" onClick={() => setInputs((s) => ({ ...s, extension: { ...s.extension!, pieces: s.extension!.pieces.filter((_, j) => j !== k) } }))}>
                    Remove
                  </button>
                </div>
              ))}
              {(inputs.extension?.pieces.length ?? 0) < 2 && (
                <button
                  type="button"
                  className="my-1 rounded border px-2 py-1 text-xs hover:bg-muted"
                  onClick={() => setInputs((s) => {
                    const e = s.extension ?? { pieces: [], bar: 5, length: 36, spacing: 12 };
                    return { ...s, extension: { ...e, pieces: [...e.pieces, { name: e.pieces.some((p) => p.name === "Inlet") ? "Outlet" : "Inlet", length: 10 }] } };
                  })}
                >
                  Add piece
                </button>
              )}
              {(inputs.extension?.pieces.length ?? 0) > 0 && inputs.extension && (
                <>
                  <Choice label="Dowel bar" value={inputs.extension.bar} options={[4, 5, 6, 7, 8].map((b) => ({ value: b, label: `#${b}` }))} onChange={(v) => setInputs((s) => ({ ...s, extension: { ...s.extension!, bar: v } }))} />
                  <Field label="Dowel length" unit="in" value={inputs.extension.length} onChange={(v) => setInputs((s) => ({ ...s, extension: { ...s.extension!, length: v } }))} hint="Half drilled and epoxy grouted into the existing barrel" />
                  <Field label="Dowel spacing" unit="in" value={inputs.extension.spacing} onChange={(v) => setInputs((s) => ({ ...s, extension: { ...s.extension!, spacing: v } }))} />
                  <Field label="Backfill where existing wingwalls come out" unit="CY" value={inputs.extension.removalBackfill ?? 0} step={0.1} hint="From the plans' removal limits (their excavation is paid with the removal)" onChange={(v) => setInputs((s) => ({ ...s, extension: { ...s.extension!, removalBackfill: v } }))} />
                  <Toggle label="Waterproof the top and the joints" value={!!inputs.extension.waterproofJoints} onChange={(v) => setInputs((s) => ({ ...s, extension: { ...s.extension!, waterproofJoints: v } }))} />
                </>
              )}
            </Section>
            <Section title="Excavation (M-206-1)" open={inputs.excavation?.to != null || (inputs.excavation?.depth ?? 0) > 0}>
              <p className="pb-1 text-[11px] text-muted-foreground">M-206-1 measures the trench to the box&apos;s bottom. Where the plans dig deeper under the barrel (a set depth, or to bedrock), give it: it&apos;s excavated and refilled with structure backfill.</p>
              <Choice
                label="Below the box"
                value={inputs.excavation?.to != null ? "elevation" : (inputs.excavation?.depth ?? 0) > 0 ? "depth" : "none"}
                options={[
                  { value: "none", label: "None" },
                  { value: "depth", label: "A depth" },
                  { value: "elevation", label: "To an elevation" },
                ]}
                onChange={(v) => setInputs((s) => ({ ...s, excavation: { inletInvert: null, outletInvert: null, wingwalls: true, ...s.excavation, to: v === "elevation" ? (s.excavation?.to ?? 0) : null, depth: v === "depth" ? (s.excavation?.depth || 0.5) : null } }))}
              />
              {inputs.excavation?.to == null && (inputs.excavation?.depth ?? 0) > 0 && (
                <Field label="Depth below the box" unit="ft" value={inputs.excavation!.depth!} step={0.25} onChange={(v) => setInputs((s) => ({ ...s, excavation: { ...s.excavation!, depth: v } }))} />
              )}
              {inputs.excavation?.to != null && (
                <>
                  <Field label="To elevation (e.g. bedrock)" unit="ft" value={inputs.excavation.to} step={0.1} onChange={(v) => setInputs((s) => ({ ...s, excavation: { ...s.excavation!, to: v } }))} />
                  <Field label="Invert at the inlet" unit="ft" value={inputs.excavation.inletInvert ?? 0} step={0.01} hint="The box's flowline (top of the bottom slab); its bottom is this less the slab" onChange={(v) => setInputs((s) => ({ ...s, excavation: { ...s.excavation!, inletInvert: v } }))} />
                  <Field label="Invert at the outlet" unit="ft" value={inputs.excavation.outletInvert ?? 0} step={0.01} onChange={(v) => setInputs((s) => ({ ...s, excavation: { ...s.excavation!, outletInvert: v } }))} />
                </>
              )}
              {(inputs.wingwalls ?? []).length > 0 && (
                <Toggle label="Wingwalls' excavation (M-206-1 Sheet 2)" value={inputs.excavation?.wingwalls ?? true} onChange={(v) => setInputs((s) => ({ ...s, excavation: { to: null, inletInvert: null, outletInvert: null, ...s.excavation, wingwalls: v } }))} />
              )}
            </Section>
            <Section title="Wingwalls (M-601-20)" open={(inputs.wingwalls ?? []).length > 0}>
              <WingwallInputs walls={inputs.wingwalls ?? []} rise={inputs.rise} onChange={set("wingwalls")} />
            </Section>
            <Section title="Factors">
              <Choice
                label="Box"
                value={inputs.construction}
                options={[
                  { value: "cip", label: "Cast in place" },
                  { value: "precast", label: "Precast" },
                ]}
                // φ from AASHTO Table 12.5.5-1.
                onChange={(v) => setInputs((s) => ({ ...s, construction: v, ...PHI_BOX[v] }))}
              />
              <Field label="η on EV and EH (redundancy)" value={inputs.eta} onChange={set("eta")} step={0.05} />
              <Field label="Flexure φf" value={inputs.phiF} onChange={set("phiF")} step={0.05} />
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
                <ChecksTable checks={r.checks} groupOf={checkGroup} />
                <WingwallResults walls={inputs.wingwalls ?? []} />
                <TakeoffPanel kind="box-culvert" design={design} inputs={inputs} ok={r.checks.every((c) => c.advisory || c.ok)} onSettings={(t) => setInputs((s) => ({ ...s, takeoff: t }))} />
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
              const min = 0.002 * 12 * g.h;
              const need = Math.max(flex, crack, min);
              return (
                <tr key={g.label} className="border-b border-border/40 text-right tabular-nums">
                  <td className="text-left">{g.label}</td>
                  <td className={need === flex ? "font-medium" : ""}>{fmt(flex)}</td>
                  <td className={need === crack ? "font-medium" : ""}>{g.crack ? fmt(crack) : "—"}</td>
                  <td className={need === min ? "font-medium" : ""}>{fmt(min)}</td>
                  <td>{fmt(need)}</td>
                  <td className={cn("whitespace-nowrap", g.As + 1e-9 < need ? "text-red-600" : "text-emerald-600")}>
                    {g.steel.bars && (
                      <span className="pr-1 text-muted-foreground">
                        #{g.steel.bars.bar} @ {g.steel.bars.spacing}&quot;{g.steel.corner && ` + c #${g.steel.corner.bar} @ ${g.steel.corner.spacing}"`}
                      </span>
                    )}
                    {fmt(g.As)}
                  </td>
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
          ["Lane load", r.live.lane ? `${fmt(r.live.wLane)} ksf` : "No (span 15 ft or less)"],
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
