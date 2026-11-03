"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { designStripSeal, type StripSealInputs } from "@/lib/design/joints/strip-seal";
import { DesignError } from "@/lib/design/walls/cip";
import { cn } from "@/lib/utils";
import { ChecksBanner, ChecksTable, DesignErrorCard, DesignHeader, Field, fmt, Section } from "./design-kit";
import { StripSealSketch } from "./strip-seal-sketch";

// A strip seal joint: the inputs on the left, worked out as they change (section, checks and the
// table of settings) on the right, saved as you go.

const NOTE: Record<string, string> = { ok: "", wait: "Wait to cool: under the installation opening", "too small": "Seal too small from here", outside: "Outside the design temperatures (structure colder or hotter than designed for)" };

export function StripSealEditor({ design, projects }: { design: { id: string; name: string; projectId: string | null; inputs: StripSealInputs }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs);
  const set = <K extends keyof StripSealInputs>(key: K) => (v: StripSealInputs[K]) => setInputs((s) => ({ ...s, [key]: v }));

  const outcome = useMemo(() => {
    try {
      return { result: designStripSeal(inputs), error: null };
    } catch (err) {
      return { result: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [inputs]);
  const r = outcome.result;

  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Strip Seal Expansion Joint · AASHTO LRFD" canMakeCalc={!!r} />

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            <Section title="Superstructure" open>
              <Field label="Expansion length to the joint" unit="ft" value={inputs.L} onChange={set("L")} />
              <Field label="Skew" unit="deg" value={inputs.skew} onChange={set("skew")} />
              <Field label="Thermal coefficient" unit="×10⁻⁶/°F" value={inputs.alpha} scale={1e6} onChange={set("alpha")} step={0.5} />
              <Field label="Creep and shrinkage strain to come" unit="×10⁻⁶" value={inputs.creepShrink} scale={1e6} onChange={set("creepShrink")} step={10} />
              <Field label="Maximum design temperature (3.12.2)" unit="°F" value={inputs.Tmax} onChange={set("Tmax")} />
              <Field label="Minimum design temperature" unit="°F" value={inputs.Tmin} onChange={set("Tmin")} />
              <Field label="Load factor γTU" value={inputs.gammaTU} onChange={set("gammaTU")} step={0.05} />
            </Section>
            <Section title="Seal (manufacturer's)" open>
              <Field label="Largest opening" unit="in" value={inputs.maxOpening} onChange={set("maxOpening")} step={0.25} />
              <Field label="Smallest opening" unit="in" value={inputs.minOpening} onChange={set("minOpening")} step={0.25} />
              <Field label="Least opening to place the gland" unit="in" value={inputs.installMin} onChange={set("installMin")} step={0.25} />
              <Field label="Rail width, each" unit="in" value={inputs.rail} onChange={set("rail")} step={0.25} />
            </Section>
            <Section title="Installation" open>
              <Field label="Planned installation temperature" unit="°F" value={inputs.Ti} onChange={set("Ti")} />
              <Field label="Table from" unit="°F" value={inputs.tableFrom} onChange={set("tableFrom")} />
              <Field label="Table to" unit="°F" value={inputs.tableTo} onChange={set("tableTo")} />
              <Field label="Table step" unit="°F" value={inputs.tableStep} onChange={set("tableStep")} />
            </Section>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {outcome.error ? (
            <DesignErrorCard message={outcome.error} />
          ) : (
            r && (
              <>
                <ChecksBanner checks={r.checks} extra={<span className="ml-auto text-xs">Total movement {fmt(r.total, 3)} in</span>} />
                <Card>
                  <CardContent className="py-3">
                    <StripSealSketch inputs={inputs} result={r} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={(id) => (id === "range" ? "Movement" : "Setting")} />
                <Card>
                  <CardContent className="overflow-x-auto py-3 text-xs">
                    <p className="pb-1 font-semibold">Settings by installation temperature</p>
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="font-normal">Temperature</th>
                          <th className="text-right font-normal">Amax in</th>
                          <th className="text-right font-normal">Amin in</th>
                          <th className="text-right font-normal">A in</th>
                          <th className="text-right font-normal">W in</th>
                          <th className="pl-3 font-normal" />
                        </tr>
                      </thead>
                      <tbody>
                        {r.table.map((row) => (
                          <tr key={row.Ti} className={cn("border-b border-border/40", row.status !== "ok" && "text-muted-foreground")}>
                            <td>{row.Ti}°F</td>
                            <td className="text-right tabular-nums">{fmt(row.Amax, 3)}</td>
                            <td className="text-right tabular-nums">{fmt(row.Amin, 3)}</td>
                            <td className="text-right tabular-nums">{row.status !== "too small" ? fmt(row.A, 3) : "—"}</td>
                            <td className="text-right tabular-nums">{row.status !== "too small" ? fmt(row.W, 3) : "—"}</td>
                            <td className={cn("pl-3", row.status === "wait" && "text-amber-600", (row.status === "too small" || row.status === "outside") && "text-red-600")}>{NOTE[row.status]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
