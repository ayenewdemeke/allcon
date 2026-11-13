"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { takeoffFor, takeoffPayLines, type TakeoffSettings } from "@/lib/design/takeoff";
import { cn } from "@/lib/utils";
import { DetailSketch } from "./detail-sketch";
import { Field } from "./design-kit";
import { RebarScheduleTab } from "./rebar-schedule-tab";

// A design tool's reinforcement details and quantities, below its checks: the bars as detailed
// (views), the bar schedule and quantities with the quantity sheet and the project's line
// items, and the length the per-foot design covers. The settings are saved with the design's inputs.

export function TakeoffPanel<T extends object>({ kind, design, inputs, onSettings, ok }: { kind: string; design: { id: string; projectId: string | null }; inputs: T; onSettings: (s: TakeoffSettings) => void; ok?: boolean }) {
  const settings = (inputs as { takeoff?: TakeoffSettings }).takeoff ?? {};
  const [tab, setTab] = useState<"details" | "schedule" | null>(null);
  const take = useMemo(() => {
    try {
      return takeoffFor(kind, inputs, (inputs as { takeoff?: TakeoffSettings }).takeoff);
    } catch {
      return null;
    }
  }, [kind, inputs]);
  if (!take) return null;
  const lines = takeoffPayLines(kind, take, settings.items ?? {}, inputs, settings.agency);
  const tabs = [...(take.views.length ? [["details", "Reinforcement details"] as const] : []), ["schedule", take.schedule.groups.length ? "Bar schedule & quantities" : "Quantities"] as const];
  return (
    <Card>
      <CardContent className="space-y-3 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">Details and quantities</p>
          <div className="ml-auto flex gap-1 rounded-lg bg-muted p-[3px]" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(tab === k ? null : k)} className={cn("rounded-md px-2 py-0.5 font-medium text-foreground/60 hover:text-foreground", tab === k && "bg-background text-foreground shadow-sm")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {(take.length || take.fields?.length) && (
          <div className="grid max-w-xl gap-x-4 sm:grid-cols-2">
            {take.length && <Field label={take.length.label} unit={take.length.unit === "ft" ? "ft" : "ea"} value={take.length.value} onChange={(v) => onSettings({ ...settings, length: v })} step={1} />}
            {take.fields?.map((f) => <Field key={f.key} label={f.label} unit={f.unit} value={f.value} hint={f.hint} onChange={(v) => onSettings({ ...settings, [f.key]: v })} step={f.step ?? 1} />)}
          </div>
        )}
        {tab && ok === false && <p className="text-amber-800 dark:text-amber-300">The design has failing checks: these details show the bars as given, not yet a passing design.</p>}
        {tab === "details" &&
          take.views.map((v) => (
            <div key={v.title}>
              <DetailSketch view={v} schedule={take.schedule} />
            </div>
          ))}
        {tab === "details" && take.notes.length > 0 && (
          <div className="space-y-1 text-muted-foreground">
            {take.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        )}
        {tab === "schedule" && (
          <RebarScheduleTab
            design={design}
            inputs={inputs}
            schedule={take.schedule}
            notes={take.notes}
            pay={{ kind, lines, value: { ...(settings.items ?? {}), agency: settings.agency, headingId: settings.headingId }, onChange: (v) => {
              const { headingId, agency, ...items } = v;
              onSettings({ ...settings, items, agency: agency ?? settings.agency, headingId: headingId ?? settings.headingId ?? null });
            } }}
          />
        )}
      </CardContent>
    </Card>
  );
}
