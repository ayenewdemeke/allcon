"use client";

import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DtInputs } from "@/lib/design/rating/double-tee";
import { checkStandard, DT_STANDARD_NAME, standardStrandCount, type DtStandardRow } from "@/lib/design/rating/dt-standard";
import { cn } from "@/lib/utils";

/**
 * Whether the bridge was built to the 1982 double-tee standard (its year, span, width, units and
 * section against Dwg. B-3): if so, its prestress can be taken from the standard instead of back-calculated.
 */
export function DtStandardPanel({ i, onApply, onBackCalculate }: { i: DtInputs; onApply: (r: DtStandardRow) => void; onBackCalculate: () => void }) {
  const c = checkStandard(i);
  const inUse = i.prestress.mode === "known" && !!i.prestress.harp;
  return (
    <div className="my-2 rounded-md border bg-muted/30 p-2 text-xs">
      <p className="font-medium">Standard plans: {DT_STANDARD_NAME}</p>
      <p className={cn("mt-1", c.applies ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{c.summary}</p>
      <table className="mt-1.5 w-full">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="font-normal" />
            <th className="font-normal">This bridge</th>
            <th className="font-normal">Standard</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {c.items.map((x) => (
            <tr key={x.label} className="border-t border-border/40">
              <td className="py-0.5 pr-2 text-muted-foreground">{x.label}</td>
              <td className="pr-2 tabular-nums">{x.bridge}</td>
              <td className="pr-2 tabular-nums">{x.standard}</td>
              <td>{x.ok ? <Check className="size-3.5 text-emerald-600" /> : <X className="size-3.5 text-red-600" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.applies && c.row && !inUse && (
        <Button size="sm" className="mt-2" onClick={() => onApply(c.row!)}>
          Use the standard&apos;s prestress ({standardStrandCount(c.row)} strands, Fi {c.row.Fi} kip)
        </Button>
      )}
      {inUse && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-emerald-700 dark:text-emerald-400">The prestress is taken from the standard (strands harped, Dwg. B-7).</span>
          <Button size="sm" variant="outline" onClick={onBackCalculate}>
            Back-calculate instead
          </Button>
        </div>
      )}
    </div>
  );
}
