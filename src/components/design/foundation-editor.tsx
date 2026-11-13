"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FOUNDATION_INFO, type FoundationKind } from "@/lib/design/foundations/kinds";
import { runFoundation } from "@/lib/design/foundations/run";
import { DesignError, type Bars } from "@/lib/design/walls/cip";
import { BarsField, ChecksBanner, ChecksTable, Choice, DesignErrorCard, DesignHeader, Field, KeyValues, Section, Toggle } from "./design-kit";
import { CRITERIA, type Criteria } from "@/lib/design/agency-checks";
import { useCdot } from "./agency-context";
import { FOUNDATION_SPECS, type FieldSpec } from "./foundation-specs";
import { FoundationSketch, LateralPlot } from "./foundation-sketch";
import { TakeoffPanel } from "./takeoff-panel";

// The editor shared by the foundation tools and the abutment: the fields their spec lists on the left
// (worked out as they change, saved as you go), the sketch, the checks, the lateral analysis, the
// summary values and the details and quantities on the right.

type Inputs = Record<string, unknown>;

const get = (o: Inputs, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Inputs)[k] : undefined), o);
function setPath(o: Inputs, path: string, v: unknown): Inputs {
  const [k, ...rest] = path.split(".");
  return { ...o, [k]: rest.length ? setPath((o[k] as Inputs) ?? {}, rest.join("."), v) : v };
}

export function ListField({ spec, value, onChange }: { spec: Extract<FieldSpec, { type: "list" }>; value: Inputs[]; onChange: (v: Inputs[]) => void }) {
  const cell = "h-6 w-full min-w-0 rounded border border-input bg-transparent px-1 text-xs";
  return (
    <div className="space-y-1 py-1 text-xs">
      <div className="text-muted-foreground">{spec.label}</div>
      {spec.note && <p className="text-[11px] text-muted-foreground">{spec.note}</p>}
      <div className="overflow-x-auto">
        <table className="w-max border-separate border-spacing-x-1">
          <thead>
            <tr className="text-[10px] text-muted-foreground">
              {spec.columns.map((c) => (
                <th key={c.key} className="text-left font-normal" style={{ minWidth: c.width ?? "3.5rem" }}>
                  {c.label}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {value.map((row, k) => (
              <tr key={k}>
                {spec.columns.map((c) => (
                  <td key={c.key}>
                    {c.kind === "choice" ? (
                      <select className={cell} value={String(row[c.key])} onChange={(e) => onChange(value.map((r, j) => (j === k ? { ...r, [c.key]: e.target.value } : r)))} aria-label={c.label}>
                        {c.options!.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : c.kind === "text" ? (
                      <input className={cell} value={String(row[c.key] ?? "")} onChange={(e) => onChange(value.map((r, j) => (j === k ? { ...r, [c.key]: e.target.value } : r)))} aria-label={c.label} />
                    ) : (
                      <input type="number" className={`${cell} text-right tabular-nums`} value={Number(row[c.key] ?? 0)} onChange={(e) => onChange(value.map((r, j) => (j === k ? { ...r, [c.key]: Number(e.target.value) || 0 } : r)))} aria-label={c.label} />
                    )}
                  </td>
                ))}
                <td>
                  <Button size="icon-sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== k))} aria-label="Remove">
                    <X />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button size="sm" variant="outline" onClick={() => onChange([...value, { ...spec.blank }])}>
        <Plus /> Add
      </Button>
    </div>
  );
}

export function FieldView({ spec, inputs, set }: { spec: FieldSpec; inputs: Inputs; set: (path: string, v: unknown) => void }) {
  if (spec.show && !spec.show(inputs)) return null;
  const v = get(inputs, spec.key);
  switch (spec.type) {
    case "number":
      return <Field label={spec.label} unit={spec.unit} value={Number(v ?? 0)} step={spec.step} hint={spec.hint} onChange={(x) => set(spec.key, x)} />;
    case "choice":
      return <Choice label={spec.label} value={v as string | number} options={spec.options} onChange={(x) => set(spec.key, x)} />;
    case "toggle":
      return <Toggle label={spec.label} value={!!v} onChange={(x) => set(spec.key, x)} />;
    case "bars":
      return <BarsField label={spec.label} value={v as Bars} onChange={(x) => set(spec.key, x)} />;
    case "list":
      return <ListField spec={spec} value={(v as Inputs[]) ?? []} onChange={(x) => set(spec.key, x)} />;
  }
}

export function FoundationEditor({ kind, design, projects }: { kind: FoundationKind; design: { id: string; name: string; projectId: string | null; inputs: object }; projects: { id: string; name: string }[] }) {
  const [inputs, setInputs] = useState(design.inputs as Inputs);
  const set = (path: string, v: unknown) => setInputs((s) => setPath(s, path, v));
  const info = FOUNDATION_INFO[kind];
  const outcome = useMemo(() => {
    try {
      return { r: runFoundation(kind, inputs), error: null };
    } catch (err) {
      return { r: null, error: err instanceof DesignError ? err.message : "These inputs can't be worked out" };
    }
  }, [kind, inputs]);
  const r = outcome.r;
  const groupOf = (id: string) => r?.groups.find((g) => g.of(id))?.title ?? "Other";
  // An agency's criteria are offered with its rules on (or where the design already uses them).
  const cdot = useCdot();
  const criteria = ((inputs as { criteria?: Criteria }).criteria ?? "aashto") as Criteria;
  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label={`${info.name} · AASHTO LRFD 10th, FHWA${criteria === "cdot" ? ", CDOT BDM" : ""}`} canMakeCalc={!!r} />
      <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            {(cdot || criteria === "cdot") && <Choice label="Design criteria" value={criteria} options={CRITERIA} onChange={(v) => set("criteria", v)} />}
            {FOUNDATION_SPECS[kind].map((sec) => (
              <Section key={sec.title} title={sec.title} open={sec.open}>
                {sec.fields.map((f, k) => (
                  <FieldView key={`${f.key}-${k}`} spec={f} inputs={inputs} set={set} />
                ))}
              </Section>
            ))}
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
                    <FoundationSketch kind={kind} inputs={inputs} />
                  </CardContent>
                </Card>
                <ChecksTable checks={r.checks} groupOf={groupOf} />
                {r.lateral && (
                  <Card>
                    <CardContent className="py-3">
                      <LateralPlot title={`Lateral analysis (p–y): ${r.lateral.title}`} r={r.lateral.r} />
                    </CardContent>
                  </Card>
                )}
                <TakeoffPanel kind={kind} design={design} inputs={inputs} ok={r.checks.every((c) => c.advisory || c.ok)} onSettings={(t) => setInputs((s) => ({ ...s, takeoff: t }))} />
                <div className="grid gap-4 xl:grid-cols-2">
                  {r.summary.map((s) => (
                    <KeyValues key={s.title} title={s.title} rows={s.rows} />
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
