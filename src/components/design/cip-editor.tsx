"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, Cloud, FileText, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createCalcFromDesign, renameDesign, saveDesignInputs, setDesignProject } from "@/app/actions/design";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BARS, COMBOS, DesignError, designCipWall, type Bars, type CipInputs, type Combo, type Factors } from "@/lib/design/walls/cip";
import { cn } from "@/lib/utils";
import { CipSketch } from "./wall-sketch";

// Designing a CIP cantilever wall: the inputs on the left, worked out as they change (sketch,
// checks, and the working) on the right, saved as you go. "Create calc" writes the calc package
// as a Calcs worksheet.

type Save = "saved" | "saving" | "unsaved" | "error";

function Field({ label, unit, value, onChange, step = 1, hint, scale = 1 }: { label: string; unit?: string; value: number; onChange: (v: number) => void; step?: number; hint?: string; scale?: number }) {
  const [text, setText] = useState(String(+(value * scale).toFixed(6)));
  const [last, setLast] = useState(value);
  if (value !== last) {
    // Changed from outside (e.g. reset): show it.
    setLast(value);
    setText(String(+(value * scale).toFixed(6)));
  }
  return (
    <label className="grid grid-cols-[1fr_7rem] items-center gap-2 py-0.5 text-xs" title={hint}>
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v)) {
              setLast(v / scale);
              onChange(v / scale);
            }
          }}
          className="h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-right tabular-nums outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="w-9 shrink-0 text-[11px] text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Section({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-b py-1.5 last:border-b-0">
      <summary className="cursor-pointer list-none py-1 text-xs font-semibold select-none">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="pb-1 pl-3">{children}</div>
    </details>
  );
}

function BarsField({ label, value, onChange }: { label: string; value: Bars; onChange: (b: Bars) => void }) {
  return (
    <div className="grid grid-cols-[1fr_7rem] items-center gap-2 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <select value={value.bar} onChange={(e) => onChange({ ...value, bar: Number(e.target.value) })} className="h-7 rounded-md border border-input bg-transparent px-1" aria-label={`${label} bar`}>
          {Object.keys(BARS).map((b) => (
            <option key={b} value={b}>
              #{b}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">@</span>
        <input type="number" value={value.spacing} min={3} step={1} onChange={(e) => Number(e.target.value) > 0 && onChange({ ...value, spacing: Number(e.target.value) })} className="h-7 w-12 rounded-md border border-input bg-transparent px-1 text-right tabular-nums" aria-label={`${label} spacing`} />
        <span className="text-[11px] text-muted-foreground">in</span>
      </span>
    </div>
  );
}

const fmt = (v: number, d = 3) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Number(v.toFixed(d)).toString());

export function CipEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: CipInputs }; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [inputs, setInputs] = useState(design.inputs);
  const [name, setName] = useState(design.name);
  const [projectId, setProjectId] = useState(design.projectId);
  const [save, setSave] = useState<Save>("saved");
  const [making, setMaking] = useState(false);
  const set = <K extends keyof CipInputs>(key: K) => (v: CipInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));
  const setFactor = (combo: Combo, key: keyof Factors, v: number) => setInputs((s) => ({ ...s, factors: { ...s.factors, [combo]: { ...s.factors[combo], [key]: v } } }));

  const outcome = useMemo(() => {
    try {
      return { result: designCipWall(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;

  // Saved as you go.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave("unsaved");
    const timer = setTimeout(() => {
      setSave("saving");
      saveDesignInputs(design.id, inputs)
        .then(() => setSave("saved"))
        .catch(() => setSave("error"));
    }, 700);
    return () => clearTimeout(timer);
  }, [inputs, design.id]);

  const makeCalc = async () => {
    setMaking(true);
    try {
      await saveDesignInputs(design.id, inputs);
      const { calcId } = await createCalcFromDesign(design.id);
      toast.success("Calc package created in Calcs", { action: { label: "Open", onClick: () => router.push(`/calcs/${calcId}`) } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the calc package");
    } finally {
      setMaking(false);
    }
  };

  const failing = r?.checks.filter((c) => !c.ok) ?? [];
  const groupOf = (id: string) => (/^(ecc|brg|slide)/.test(id) ? "Stability" : id.startsWith("stem") ? "Stem" : id.startsWith("heel") ? "Heel" : id.startsWith("toe") ? "Toe" : "Shear key");

  return (
    <div className="space-y-4">
      {/* The design's name, project, save status and the calc package. */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== design.name && renameDesign(design.id, name).catch(() => toast.error("Could not rename the design"))}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold outline-none hover:border-input focus:border-input"
          aria-label="Design name"
        />
        <span className="text-xs text-muted-foreground">CIP Cantilever Wall · AASHTO LRFD</span>
        {projects.length > 0 && (
          <select
            value={projectId ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              setProjectId(id);
              setDesignProject(design.id, id).catch(() => toast.error("Could not file the design under that project"));
            }}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs"
            aria-label="Project"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground" title={save === "saved" ? "All changes saved" : save === "error" ? "Not saved" : "Saving"}>
          {save === "saved" ? <Check className="size-3.5" /> : save === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : save === "error" ? <AlertCircle className="size-3.5 text-destructive" /> : <Cloud className="size-3.5" />}
        </span>
        <Button size="sm" onClick={() => void makeCalc()} disabled={making || !r}>
          {making ? <Loader2 className="animate-spin" /> : <FileText />}
          Create calc package
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        {/* Inputs */}
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Geometry" open>
              <Field label="Exposed height He" unit="ft" value={inputs.He} onChange={set("He")} step={0.25} />
              <Field label="Footing cover Df (to footing bottom)" unit="ft" value={inputs.Df} onChange={set("Df")} step={0.25} />
              <Field label="Footing thickness D" unit="in" value={inputs.D} onChange={set("D")} />
              <Field label="Footing width B" unit="in" value={inputs.B} onChange={set("B")} />
              <Field label="Toe A" unit="in" value={inputs.A} onChange={set("A")} />
              <Field label="Stem thickness at top" unit="in" value={inputs.Tt} onChange={set("Tt")} />
              <Field label="Front batter" unit="in/ft" value={inputs.frontBatter} onChange={set("frontBatter")} step={0.125} />
              <Field label="Back batter" unit="in/ft" value={inputs.backBatter} onChange={set("backBatter")} step={0.125} />
              <Field label="Backslope (H:1V, 0 = level)" unit="H:1V" value={inputs.backslope} onChange={set("backslope")} step={0.5} />
              <Toggle label="Shear key" value={inputs.shearKey} onChange={set("shearKey")} />
              {inputs.shearKey && (
                <>
                  <Field label="Key depth below footing" unit="in" value={inputs.keyDepth} onChange={set("keyDepth")} />
                  <Field label="Key width" unit="in" value={inputs.keyWidth} onChange={set("keyWidth")} />
                </>
              )}
            </Section>
            <Section title="Backfill and subgrade" open>
              <Field label="Backfill unit weight γs" unit="pcf" value={inputs.gammaS} scale={1000} onChange={set("gammaS")} />
              <Field label="Backfill friction angle φ" unit="deg" value={inputs.phi} onChange={set("phi")} />
              <Toggle label="Wall–backfill friction δ = 2/3 φ" value={inputs.delta === null} onChange={(auto) => set("delta")(auto ? null : (2 * inputs.phi) / 3)} />
              {inputs.delta !== null && <Field label="Wall–backfill friction δ" unit="deg" value={inputs.delta} onChange={set("delta")} />}
              <Toggle label="Kp from AASHTO Fig. 3.11.5.4-1 (else Coulomb)" value={inputs.kpOverride !== null} onChange={(fig) => set("kpOverride")(fig ? 9 : null)} />
              {inputs.kpOverride !== null && <Field label="Passive coefficient Kp" value={inputs.kpOverride} onChange={set("kpOverride")} step={0.1} />}
              <Field label="Minimum active EFW" unit="pcf" value={inputs.efwMin} scale={1000} onChange={set("efwMin")} />
              <Field label="Nominal bearing resistance qn" unit="ksf" value={inputs.qn} onChange={set("qn")} step={0.1} />
              <Field label="Subgrade friction angle φsub" unit="deg" value={inputs.phiSub} onChange={set("phiSub")} />
            </Section>
            <Section title="Live load and pavement">
              <Toggle label="Live load surcharge" value={inputs.liveLoad} onChange={set("liveLoad")} />
              {inputs.liveLoad && <Field label="Wall back face to edge of traffic" unit="ft" value={inputs.trafficDistance} onChange={set("trafficDistance")} />}
              <Field label="Pavement thickness" unit="in" value={inputs.pavementThickness} onChange={set("pavementThickness")} />
              <Field label="Pavement unit weight" unit="pcf" value={inputs.gammaPavement} scale={1000} onChange={set("gammaPavement")} />
            </Section>
            <Section title="Concrete and steel">
              <Field label="f'c" unit="ksi" value={inputs.fc} onChange={set("fc")} step={0.5} />
              <Field label="Concrete unit weight γc" unit="pcf" value={inputs.gammaC} scale={1000} onChange={set("gammaC")} />
              <Field label="fy" unit="ksi" value={inputs.fy} onChange={set("fy")} />
              <Field label="Es" unit="ksi" value={inputs.Es} onChange={set("Es")} step={100} />
            </Section>
            <Section title="Reinforcement">
              <BarsField label="Stem, back face (vertical)" value={inputs.stemBars} onChange={set("stemBars")} />
              <BarsField label="Stem, shrinkage & temp." value={inputs.stemTemp} onChange={set("stemTemp")} />
              <BarsField label="Heel, top" value={inputs.heelBars} onChange={set("heelBars")} />
              <BarsField label="Heel, shrinkage & temp." value={inputs.heelTemp} onChange={set("heelTemp")} />
              <BarsField label="Toe, bottom" value={inputs.toeBars} onChange={set("toeBars")} />
              <BarsField label="Toe, shrinkage & temp." value={inputs.toeTemp} onChange={set("toeTemp")} />
              {inputs.shearKey && <BarsField label="Shear key U bars" value={inputs.keyBars} onChange={set("keyBars")} />}
              {inputs.shearKey && <BarsField label="Shear key, shrinkage & temp." value={inputs.keyTemp} onChange={set("keyTemp")} />}
              <Field label="Cover, stem" unit="in" value={inputs.coverStem} onChange={set("coverStem")} step={0.25} />
              <Field label="Cover, heel" unit="in" value={inputs.coverHeel} onChange={set("coverHeel")} step={0.25} />
              <Field label="Cover, toe (cast against soil)" unit="in" value={inputs.coverToe} onChange={set("coverToe")} step={0.25} />
              <Field label="Cover, shear key" unit="in" value={inputs.coverKey} onChange={set("coverKey")} step={0.25} />
              <Field label="Exposure class, stem (1 or 2)" value={inputs.exposureStem} onChange={(v) => set("exposureStem")(v >= 1.5 ? 2 : 1)} />
              <Field label="Exposure class, footing (1 or 2)" value={inputs.exposureFooting} onChange={(v) => set("exposureFooting")(v >= 1.5 ? 2 : 1)} />
            </Section>
            <Section title="Resistance factors">
              <Field label="Bearing φb" value={inputs.phiB} onChange={set("phiB")} step={0.05} />
              <Field label="Sliding, concrete on soil φτ" value={inputs.phiT} onChange={set("phiT")} step={0.05} />
              <Field label="Sliding, soil on soil φτ" value={inputs.phiTss} onChange={set("phiTss")} step={0.05} />
              <Field label="Passive pressure φep" value={inputs.phiEp} onChange={set("phiEp")} step={0.05} />
              <Field label="Extreme event φ" value={inputs.phiEE} onChange={set("phiEE")} step={0.05} />
              <Field label="Flexure φf" value={inputs.phiF} onChange={set("phiF")} step={0.05} />
              <Field label="Shear φv" value={inputs.phiV} onChange={set("phiV")} step={0.05} />
            </Section>
            <Section title="Load factors">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-normal">Group</th>
                    {(["dc", "ev", "lsv", "lsh", "eh"] as const).map((k) => (
                      <th key={k} className="font-normal">
                        γ{k.toUpperCase().replace("LSV", "LS,V").replace("LSH", "LS,H")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMBOS.map((c) => (
                    <tr key={c.id} title={c.use}>
                      <td className="pr-1 whitespace-nowrap">{c.name}</td>
                      {(["dc", "ev", "lsv", "lsh", "eh"] as const).map((k) => (
                        <td key={k}>
                          <input type="number" step={0.05} value={inputs.factors[c.id][k]} onChange={(e) => e.target.value !== "" && setFactor(c.id, k, Number(e.target.value))} className="h-6 w-full rounded border border-input bg-transparent px-0.5 text-right tabular-nums" aria-label={`${c.name} ${k}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="min-w-0 space-y-4">
          {outcome.error ? (
            <Card>
              <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
                <AlertCircle className="size-4" /> {outcome.error}
              </CardContent>
            </Card>
          ) : (
            r && (
              <>
                <div className={cn("flex items-center gap-2 rounded-lg border px-4 py-3 text-sm", r.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200")}>
                  {r.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                  {r.ok ? `All ${r.checks.length} checks pass.` : `${failing.length} of ${r.checks.length} checks fail: ${failing.map((c) => c.name).join("; ")}.`}
                  {r.stability.keyNeeded && <span className="ml-auto text-xs">Sliding needs {inputs.shearKey ? "the" : "a"} shear key</span>}
                </div>
                <Card>
                  <CardContent className="py-3">
                    <CipSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="overflow-x-auto py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-1.5 font-normal">Check</th>
                          <th className="text-right font-normal">Demand</th>
                          <th className="text-right font-normal">Capacity</th>
                          <th className="pl-3 text-left font-normal">Ratio</th>
                          <th className="font-normal" />
                          <th className="pl-3 text-left font-normal">Reference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.checks.map((c, idx) => {
                          const ratio = c.capacity > 0 ? c.demand / c.capacity : Infinity;
                          const head = idx === 0 || groupOf(r.checks[idx - 1].id) !== groupOf(c.id);
                          return [
                            head && (
                              <tr key={`${c.id}-h`}>
                                <td colSpan={6} className="pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                                  {groupOf(c.id)}
                                </td>
                              </tr>
                            ),
                            <tr key={c.id} className="border-b border-border/50">
                              <td className="py-1 pr-2">{c.name}</td>
                              <td className="text-right tabular-nums">{fmt(c.demand)}</td>
                              <td className="text-right whitespace-nowrap tabular-nums">
                                {fmt(c.capacity)} <span className="text-muted-foreground">{c.unit}</span>
                              </td>
                              <td className="pl-3">
                                <span className="flex items-center gap-1.5">
                                  <span className="h-1.5 w-16 overflow-hidden rounded bg-muted">
                                    <span className={cn("block h-full", c.ok ? "bg-emerald-500" : "bg-red-500")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                                  </span>
                                  <span className="tabular-nums">{Number.isFinite(ratio) ? ratio.toFixed(2) : "—"}</span>
                                </span>
                              </td>
                              <td className={cn("px-2 font-medium", c.ok ? "text-emerald-600" : "text-red-600")}>{c.ok ? "OK" : "NG"}</td>
                              <td className="pl-3 whitespace-nowrap text-muted-foreground">{c.ref}</td>
                            </tr>,
                          ];
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
                <Working r={r} />
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** The working: soil, loads and load groups, for checking by hand. */
function Working({ r }: { r: NonNullable<ReturnType<typeof designCipWall>> }) {
  const loads = [...Object.values(r.loads.vertical), ...Object.values(r.loads.horizontal)].filter((l) => Math.abs(l.force) > 1e-12);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardContent className="space-y-1 py-3 text-xs">
          <p className="pb-1 font-semibold">Soil and geometry</p>
          {[
            ["Ka (Coulomb, Eq. 3.11.5.3-1)", fmt(r.soil.Ka, 4)],
            ["Kp", `${fmt(r.soil.Kp, 3)}${r.soil.Kp !== r.soil.KpCoulomb ? ` (Coulomb ${fmt(r.soil.KpCoulomb, 3)})` : ""}`],
            ["δ", `${fmt(r.soil.delta, 2)}°`],
            ["Active EFW", `${fmt(r.soil.efwA * 1000, 1)} pcf`],
            ["Passive EFW", `${fmt(r.soil.efwP * 1000, 1)} pcf`],
            ["μn = tan φsub", fmt(r.soil.mu, 3)],
            ["Design height H", `${fmt(r.geometry.H, 3)} ft`],
            ["Retained height at the heel h", `${fmt(r.geometry.h, 3)} ft`],
            ["Heel C", `${fmt(r.geometry.C * 12, 2)} in`],
            ["Pa = ½ EFW h²", `${fmt(r.loads.Pa, 3)} kip/ft`],
            ...(r.geometry.heq ? [["Live load surcharge heq", `${fmt(r.geometry.heq, 2)} ft`]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
              <span className="text-muted-foreground">{k}</span>
              <span className="tabular-nums">{v}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto py-3 text-xs">
          <p className="pb-1 font-semibold">Unfactored loads (about the toe)</p>
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-normal">Load</th>
                <th className="text-right font-normal">kip/ft</th>
                <th className="text-right font-normal">Arm ft</th>
                <th className="text-right font-normal">kip·ft/ft</th>
              </tr>
            </thead>
            <tbody>
              {loads.map((l) => (
                <tr key={l.id} className="border-b border-border/40" title={l.desc}>
                  <td>
                    {l.id} <span className="text-muted-foreground">{l.desc}</span>
                  </td>
                  <td className="text-right tabular-nums">{fmt(l.force)}</td>
                  <td className="text-right tabular-nums">{fmt(l.arm)}</td>
                  <td className="text-right tabular-nums">{fmt(l.moment)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardContent className="overflow-x-auto py-3 text-xs">
          <p className="pb-1 font-semibold">Load groups</p>
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-normal">Group</th>
                <th className="text-right font-normal">ΣV kip/ft</th>
                <th className="text-right font-normal">ΣMV kip·ft/ft</th>
                <th className="text-right font-normal">ΣH kip/ft</th>
                <th className="text-right font-normal">ΣMH kip·ft/ft</th>
                <th className="text-right font-normal">e ft</th>
                <th className="text-right font-normal">σV ksf</th>
              </tr>
            </thead>
            <tbody>
              {COMBOS.map((c) => {
                const g = r.groups[c.id];
                const X = (g.MV - g.MH) / g.V;
                const e = Math.abs(r.geometry.B / 2 - X);
                return (
                  <tr key={c.id} className="border-b border-border/40" title={c.use}>
                    <td>{c.name}</td>
                    <td className="text-right tabular-nums">{fmt(g.V)}</td>
                    <td className="text-right tabular-nums">{fmt(g.MV)}</td>
                    <td className="text-right tabular-nums">{fmt(g.H)}</td>
                    <td className="text-right tabular-nums">{fmt(g.MH)}</td>
                    <td className="text-right tabular-nums">{fmt(e)}</td>
                    <td className="text-right tabular-nums">{fmt(g.V / (r.geometry.B - 2 * e))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
