"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { designZone1, ZONE1_DEFAULTS, type Column, type Support, type Zone1Inputs } from "@/lib/design/seismic/zone1";
import { BARS, DesignError } from "@/lib/design/walls/cip";
import { ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, fmt, Section, Toggle } from "./design-kit";

// A bridge's Seismic Zone 1 requirements: the hazard, its supports and columns on the left; the
// zone, connection forces, support lengths and confinement on the right, saved as you go.

const groupOf = (id: string) => (id === "zone" ? "Seismic zone" : id.startsWith("conn") ? "Connection forces" : id.startsWith("supp") ? "Support lengths" : "Confinement");

export function Zone1Editor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: Zone1Inputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof Zone1Inputs>(key: K) => (v: Zone1Inputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const setSupport = (k: number, patch: Partial<Support>) => setInputs((s) => ({ ...s, supports: s.supports.map((x, j) => (j === k ? { ...x, ...patch } : x)) }));
  const setColumn = (k: number, patch: Partial<Column>) => setInputs((s) => ({ ...s, columns: s.columns.map((x, j) => (j === k ? { ...x, ...patch } : x)) }));

  const outcome = useMemo(() => {
    try {
      return { result: designZone1(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Seismic Zone 1 · AASHTO LRFD" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Seismic hazard (from the geotechnical report)" open>
              <Field label="As = Fpga PGA" value={inputs.As} onChange={set("As")} step={0.005} />
              <Field label="SDS" value={inputs.SDS} onChange={set("SDS")} step={0.005} />
              <Field label="SD1" value={inputs.SD1} onChange={set("SD1")} step={0.005} />
              <Field label="Live load factor γEQ (T. 3.4.1-1)" value={inputs.gammaEQ} onChange={set("gammaEQ")} step={0.25} />
            </Section>
            <Section title="Supports" open>
              {inputs.supports.map((s, k) => (
                <div key={k} className="mb-2 rounded-md border p-2">
                  <div className="flex items-center gap-2 pb-1">
                    <input value={s.name} onChange={(e) => setSupport(k, { name: e.target.value })} className="h-6 flex-1 rounded border bg-transparent px-1 text-xs font-medium" aria-label="Support name" />
                    <Button variant="ghost" size="icon-xs" aria-label={`Remove ${s.name}`} onClick={() => setInputs((x) => ({ ...x, supports: x.supports.filter((_, j) => j !== k) }))}>
                      <Trash2 />
                    </Button>
                  </div>
                  <Field label="Permanent reaction (total)" unit="kip" value={s.DL} onChange={(v) => setSupport(k, { DL: v })} />
                  <Field label="Live load during the quake" unit="kip" value={s.LL} onChange={(v) => setSupport(k, { LL: v })} />
                  <Field label="Bearings" value={s.bearings} onChange={(v) => setSupport(k, { bearings: Math.max(1, Math.round(v)) })} />
                  <Toggle label="Restrained longitudinally" value={s.fixedLong} onChange={(v) => setSupport(k, { fixedLong: v })} />
                  <Toggle label="Restrained transversely" value={s.fixedTrans} onChange={(v) => setSupport(k, { fixedTrans: v })} />
                  {!s.fixedLong && (
                    <>
                      <Field label="Support length provided" unit="in" value={s.provided} onChange={(v) => setSupport(k, { provided: v })} />
                      <Field label="Deck length to the next joint L" unit="ft" value={s.L} onChange={(v) => setSupport(k, { L: v })} />
                      <Field label="Average column height H" unit="ft" value={s.H} onChange={(v) => setSupport(k, { H: v })} />
                      <Field label="Skew" unit="deg" value={s.skew} onChange={(v) => setSupport(k, { skew: v })} />
                    </>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setInputs((x) => ({ ...x, supports: [...x.supports, { ...ZONE1_DEFAULTS.supports[0], name: `Support ${x.supports.length + 1}` }] }))}>
                <Plus /> Add support
              </Button>
            </Section>
            <Section title="Columns (circular, spirals)">
              {inputs.columns.map((c, k) => (
                <div key={k} className="mb-2 rounded-md border p-2">
                  <div className="flex items-center gap-2 pb-1">
                    <input value={c.name} onChange={(e) => setColumn(k, { name: e.target.value })} className="h-6 flex-1 rounded border bg-transparent px-1 text-xs font-medium" aria-label="Column name" />
                    <Button variant="ghost" size="icon-xs" aria-label={`Remove ${c.name}`} onClick={() => setInputs((x) => ({ ...x, columns: x.columns.filter((_, j) => j !== k) }))}>
                      <Trash2 />
                    </Button>
                  </div>
                  <Field label="Diameter" unit="in" value={c.D} onChange={(v) => setColumn(k, { D: v })} />
                  <Field label="Clear cover to the spiral" unit="in" value={c.cover} onChange={(v) => setColumn(k, { cover: v })} step={0.25} />
                  <Field label="f'c" unit="ksi" value={c.fc} onChange={(v) => setColumn(k, { fc: v })} step={0.5} />
                  <Field label="fy" unit="ksi" value={c.fy} onChange={(v) => setColumn(k, { fy: v })} />
                  <Choice label="Spiral bar" value={c.bar} options={[3, 4, 5, 6].map((b) => ({ value: b, label: `#${b}` }))} onChange={(v) => setColumn(k, { bar: Number(v) })} />
                  <Field label="Pitch" unit="in" value={c.pitch} onChange={(v) => setColumn(k, { pitch: v })} step={0.25} />
                  <Field label="Bending height" unit="ft" value={c.height} onChange={(v) => setColumn(k, { height: v })} hint="Clear height, plus depth to fixity for a shaft" />
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setInputs((x) => ({ ...x, columns: [...x.columns, { ...ZONE1_DEFAULTS.columns[0], name: `Column ${x.columns.length + 1}` }] }))}>
                <Plus /> Add column
              </Button>
            </Section>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {outcome.error ? (
            <DesignErrorCard message={outcome.error} />
          ) : (
            r && (
              <>
                <ChecksBanner checks={r.checks} extra={<span className="ml-auto text-xs">Seismic Zone {r.zone}</span>} />
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                <Card>
                  <CardContent className="overflow-x-auto py-3 text-xs">
                    <p className="pb-1 font-semibold">Horizontal design connection forces, {r.factor} × the reaction (3.10.9.2)</p>
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="font-normal">Support</th>
                          <th className="text-right font-normal">Reaction kip</th>
                          <th className="text-right font-normal">Longitudinal kip</th>
                          <th className="text-right font-normal">per bearing</th>
                          <th className="text-right font-normal">Transverse kip</th>
                          <th className="text-right font-normal">per bearing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.connections.map((c) => (
                          <tr key={c.name} className="border-b border-border/40">
                            <td>{c.name}</td>
                            <td className="text-right tabular-nums">{fmt(c.reaction, 1)}</td>
                            <td className="text-right tabular-nums">{c.long ? fmt(c.long, 1) : "—"}</td>
                            <td className="text-right tabular-nums">{c.long ? fmt(c.longPerBearing, 2) : "—"}</td>
                            <td className="text-right tabular-nums">{c.trans ? fmt(c.trans, 1) : "—"}</td>
                            <td className="text-right tabular-nums">{c.trans ? fmt(c.transPerBearing, 2) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {r.confine && r.columns.length > 0 && (
                      <>
                        <p className="pt-4 pb-1 font-semibold">Confinement (SD1 &gt; 0.10)</p>
                        <table className="w-full">
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              <th className="font-normal">Column</th>
                              <th className="text-right font-normal">ρs 5.6.4.6</th>
                              <th className="text-right font-normal">ρs 5.11.4.1.4</th>
                              <th className="text-right font-normal">Provided</th>
                              <th className="text-right font-normal">Spiral area needed</th>
                              <th className="text-right font-normal">Confined length each end</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.columns.map((c, k) => (
                              <tr key={k} className="border-b border-border/40">
                                <td>{c.name}</td>
                                <td className="text-right tabular-nums">{fmt(c.rho1, 4)}</td>
                                <td className="text-right tabular-nums">{fmt(c.rho2, 4)}</td>
                                <td className="text-right tabular-nums">{fmt(c.rho, 4)}</td>
                                <td className="text-right tabular-nums">
                                  {fmt(c.AspReq, 3)} in² (#{inputs.columns[k].bar}: {BARS[inputs.columns[k].bar].area})
                                </td>
                                <td className="text-right tabular-nums">{fmt(c.length, 2)} ft</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </CardContent>
                </Card>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
