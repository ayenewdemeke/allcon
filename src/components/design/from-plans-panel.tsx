"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { inputGroup, inputLabel, PLAN_INPUTS, type FromPlans, type PlanStatus, type PlanValue } from "@/lib/design/girders/from-plans";
import { cn } from "@/lib/utils";

// A girder check started from uploaded plans: every value read off the sheets with a link to where
// it came from, the defaults used where the plans are silent, and the engineer's confirmation of
// each. Editing an input confirms it too (the editor marks it edited).

const STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  read: { label: "Read — to confirm", cls: "bg-sky-50 text-sky-800 border-sky-200" },
  unsure: { label: "Unsure", cls: "bg-amber-50 text-amber-900 border-amber-300" },
  default: { label: "Default", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  confirmed: { label: "Confirmed", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  edited: { label: "Edited", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
};

const n = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(3)));

/** A value as the engineer reads it. */
export function showValue(input: string, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (input === "spans" && Array.isArray(v)) return `${v.map((x) => n(x as number)).join(" + ")} ft`;
  if (input === "strands" && Array.isArray(v))
    return v.map((r: { y: number; count: number; debonded?: number; debondLength?: number }) => `${r.count} at ${n(r.y)} in${r.debonded ? ` (${r.debonded} debonded ${n(r.debondLength ?? 0)} ft)` : ""}`).join("; ");
  if (input === "stirrupsFromEnd" && Array.isArray(v))
    return v.map((z: { length: number; bar: number; legs: number; spacing: number }) => `#${z.bar} × ${z.legs} at ${n(z.spacing)} in${z.length > 0 ? ` for ${n(z.length)} ft` : " to midspan"}`).join("; ");
  if (input === "harped" && typeof v === "object") {
    const h = v as { count: number; yEnd: number; yHarp: number; harpPoint: number };
    return h.count ? `${h.count}, ${n(h.yEnd)} in at the ends → ${n(h.yHarp)} in at ${n(h.harpPoint)}·Lg` : "none";
  }
  if (input === "shape") return String(v).toUpperCase().replace("AASHTO-", "AASHTO Type ").replace("BT-", "BT-");
  if (typeof v === "number") {
    const unit = PLAN_INPUTS[input]?.hint.split(/[ ,(]/)[0];
    return `${n(v)}${unit && ["ft", "in", "ksi", "kcf", "klf", "psf", "kip", "degrees"].includes(unit) ? ` ${unit === "degrees" ? "°" : unit}` : ""}`;
  }
  if (typeof v === "object")
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => typeof x !== "object")
      .map(([k, x]) => `${k} ${typeof x === "number" ? n(x) : String(x)}`)
      .join(", ");
  return String(v);
}

export function FromPlansPanel({ fromPlans, projectId, onChange }: { fromPlans: FromPlans; projectId: string | null; onChange: (update: (f: FromPlans) => FromPlans) => void }) {
  const [open, setOpen] = useState(true);
  const values = fromPlans.values;
  const done = values.filter((v) => v.status === "confirmed" || v.status === "edited").length;
  const all = done === values.length;
  // From the latest state, so quick successive confirmations all land.
  const setStatus = (pred: (v: PlanValue) => boolean) => onChange((f) => ({ ...f, values: f.values.map((v) => (pred(v) && v.status !== "edited" ? { ...v, status: "confirmed" } : v)) }));
  const groups = [...new Set(values.map((v) => inputGroup(v.input)))];
  const link = (v: PlanValue) => (projectId && v.source ? `/projects/${projectId}/sheets/${v.source.sheetId}${v.source.box ? `?focus=${v.source.box.map((x) => Math.round(x)).join(",")}` : ""}` : null);

  return (
    <Card className={cn(all ? "border-emerald-200" : "border-amber-300")}>
      <CardContent className="space-y-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="flex items-center gap-1 text-sm font-semibold" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <FileText className="size-4" /> From plans{fromPlans.drawingSet ? `: ${fromPlans.drawingSet}` : ""}
          </button>
          <span className={cn("rounded-full border px-2 py-0.5 text-xs", all ? STATUS.confirmed.cls : STATUS.unsure.cls)}>
            {done} of {values.length} confirmed
          </span>
          {!all && (
            <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setStatus((v) => v.status === "read")}>
              <Check /> Confirm all values read clearly
            </Button>
          )}
        </div>
        {open && (
          <>
            <p className="text-xs text-muted-foreground">
              Check each value against its sheet (the link opens it with the source outlined), then confirm it, or change the input below, which confirms it. Unsure values and defaults need your own check. Until all are confirmed, the results are marked unconfirmed and the calc package is off.
            </p>
            {fromPlans.findings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-medium">Found in the plans</p>
                <ul className="list-disc pl-4">
                  {fromPlans.findings.map((f, k) => (
                    <li key={k}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {groups.map((grp) => {
              const rows = values.filter((v) => inputGroup(v.input) === grp);
              const left = rows.filter((v) => v.status !== "confirmed" && v.status !== "edited");
              return (
                <div key={grp} className="space-y-1">
                  <div className="flex items-center gap-2 border-b pb-1 text-xs font-semibold">
                    {grp}
                    {left.length > 0 && (
                      <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => setStatus((v) => inputGroup(v.input) === grp)}>
                        Confirm this group
                      </Button>
                    )}
                  </div>
                  {rows.map((v) => {
                    const href = link(v);
                    const st = STATUS[v.status];
                    return (
                      <div key={v.input} className="grid grid-cols-[minmax(140px,1fr)_minmax(160px,2fr)_auto] items-start gap-2 text-xs">
                        <span className="text-muted-foreground">{inputLabel(v.input)}</span>
                        <span>
                          <span className="font-medium">{showValue(v.input, v.value)}</span>
                          {v.source && (
                            <span className="block text-[11px] text-muted-foreground">
                              {href ? (
                                <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
                                  {v.source.sheet} <ExternalLink className="size-3" />
                                </a>
                              ) : (
                                v.source.sheet
                              )}
                              {v.source.lines ? `: “${v.source.lines.slice(0, 90)}${v.source.lines.length > 90 ? "…" : ""}”` : ""}
                            </span>
                          )}
                          {v.note && <span className={cn("block text-[11px]", v.status === "unsure" ? "text-amber-800" : "text-muted-foreground")}>{v.note}</span>}
                        </span>
                        <span className="flex flex-wrap items-center justify-end gap-1">
                          <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] whitespace-nowrap", st.cls)}>{st.label}</span>
                          {v.status !== "confirmed" && v.status !== "edited" && (
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setStatus((x) => x.input === v.input)}>
                              Confirm
                            </Button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
