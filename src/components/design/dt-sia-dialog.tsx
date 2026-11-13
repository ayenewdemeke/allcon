"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DtInputs } from "@/lib/design/rating/double-tee";
import { currentSiaValue, type SiaReading, type SiaValue } from "@/lib/design/rating/sia";
import { cn } from "@/lib/utils";

// The values read off an SIA beside the current inputs: the engineer picks which to use. Values that
// change an input start picked, except those the SIA can't give exactly (they say to take them from
// the sketch).

const UNIT: Partial<Record<SiaValue["input"], string>> = {
  span: "ft",
  structureLength: "ft",
  skew: "°",
  "roadway.railToRail": "ft",
  "roadway.curbToCurb": "ft",
  "roadway.curbFaceOffset": "in",
  "roadway.railFaceOffset": "in",
  "loads.asphalt": "in",
  "units.spacing": "in",
  "units.flangeWidth": "in",
  "units.flangeThk": "in",
  "deck.thk": "in",
  "loads.diaphragmKip": "kip",
};

function show(input: SiaValue["input"], v: SiaValue["value"]) {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    if (!v.length) return input === "units.layout" ? "All alike" : "None";
    return v.map((s) => ("flangeWidth" in s ? `${s.flangeWidth}` : `${s.width} ft × ${s.thk} in`)).join(", ") + ("flangeWidth" in v[0] ? " in flanges" : "");
  }
  if (typeof v === "number") return `${+v.toFixed(3)}${UNIT[input] ? ` ${UNIT[input]}` : ""}`;
  return v || "—";
}

const same = (a: SiaValue["value"] | null, b: SiaValue["value"] | null) => b !== null && JSON.stringify(a) === JSON.stringify(b);
/** The input's value now, or null while it has no source (it shows empty in the form). */
const nowOf = (i: DtInputs, input: SiaValue["input"]) => (i.sources[input] || !i.blankStart ? currentSiaValue(i, input) : null);
const picked = (v: SiaValue, i: DtInputs) => !same(v.value, nowOf(i, v.input)) && !/take the (span|girder length) from the sketch/i.test(v.note ?? "");

export function SiaDialog({ reading, file, inputs, onApply, onClose }: { reading: SiaReading; file: string; inputs: DtInputs; onApply: (chosen: SiaValue[]) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState(() => new Set(reading.values.filter((v) => picked(v, inputs)).map((v) => v.input)));
  const toggle = (k: SiaValue["input"]) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const otherBridge = inputs.bridge.id && reading.structure && inputs.bridge.id.replace(/\s/g, "") !== reading.structure.replace(/\s/g, "");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{reading.format === "sketch" ? `From the sketch's callouts${reading.structure ? `: ${reading.structure}` : ""}` : `From the SIA: ${reading.structure}`}</DialogTitle>
          <DialogDescription>
            {reading.format === "sketch"
              ? `${file}: the labeled callouts only. Bare dimensions (stem depth, stem spacing, stem widths) aren't read; enter them from the sketch. Pick the values to use; each is noted with its callout.`
              : `${file}, inspected ${reading.date} (${reading.format === "snbi" ? "SNBI items" : "NBI items"}). Pick the values to use; each is noted with its item as the source.`}
          </DialogDescription>
        </DialogHeader>
        {(otherBridge || reading.findings.length > 0) && (
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {otherBridge && (
              <p className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> This SIA is for {reading.structure}, but this rating is for {inputs.bridge.id}.
              </p>
            )}
            {reading.findings.map((f, k) => (
              <p key={k} className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {f}
              </p>
            ))}
          </div>
        )}
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-6 py-1 font-normal" />
              <th className="font-normal">Input</th>
              <th className="font-normal">{reading.format === "sketch" ? "From the sketch" : "From the SIA"}</th>
              <th className="font-normal">Now</th>
            </tr>
          </thead>
          <tbody>
            {reading.values.map((v) => {
              const now = nowOf(inputs, v.input);
              const unchanged = same(v.value, now) && !!inputs.sources[v.input];
              return (
                <tr key={v.input} className={cn("border-b border-border/50 align-top", unchanged && "text-muted-foreground")}>
                  <td className="py-1.5">
                    <input type="checkbox" aria-label={`Use the SIA's ${v.label.toLowerCase()}`} checked={chosen.has(v.input)} disabled={unchanged} onChange={() => toggle(v.input)} />
                  </td>
                  <td className="py-1.5 pr-2">{v.label}</td>
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">{show(v.input, v.value)}</span>
                    <span className="block text-[11px] text-muted-foreground">{v.source}</span>
                    {v.note && <span className="block text-[11px] text-amber-800 dark:text-amber-300">{v.note}</span>}
                  </td>
                  <td className="py-1.5">{unchanged ? "Same" : now === null ? "—" : show(v.input, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(reading.values.filter((v) => chosen.has(v.input)))} disabled={!chosen.size}>
            Use {chosen.size} value{chosen.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
