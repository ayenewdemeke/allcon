"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { SectionalResult } from "@/lib/design/stm/sectional";
import { ChecksTable, fmt, Toggle } from "./design-kit";

// Where a standard cap needs the strut-and-tie method and where the sectional method suits it
// (AASHTO 5.8.2.1, 5.5.1.2.1), and, when asked for, the sectional checks of its B-Regions.

export function StmSectionalCard({ sec, on, onToggle }: { sec: SectionalResult; on: boolean; onToggle: (v: boolean) => void }) {
  const loaded = sec.regions.filter((g) => g.kind !== "none");
  const bCount = loaded.filter((g) => g.kind === "B").length;
  return (
    <Card>
      <CardContent className="space-y-2 py-3 text-xs">
        <p className="font-semibold">
          Strut-and-tie or sectional <span className="font-normal text-muted-foreground">(AASHTO 5.8.2.1, 5.5.1.2.1)</span>
        </p>
        <table className="w-full">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="font-normal">Region</th>
              <th className="text-right font-normal">Nearest load to a column face</th>
              <th className="pl-2 font-normal">Method</th>
            </tr>
          </thead>
          <tbody>
            {loaded.map((g) => (
              <tr key={g.label} className="border-b border-border/40">
                <td>{g.label}</td>
                <td className="text-right tabular-nums">{fmt(g.ratio!, 2)} h</td>
                <td className={g.kind === "B" ? "pl-2 text-emerald-700 dark:text-emerald-400" : "pl-2"}>{g.kind === "B" ? "B-Region: sectional suits it" : "D-Region: strut-and-tie"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground">
          {sec.allB
            ? "Every load is two depths or more from the column faces: the cap is a B-Region, and the sectional method (5.6, 5.7) is satisfactory; the strut-and-tie model isn't needed."
            : bCount
              ? "Some regions have loads within two depths of a column face: those need the strut-and-tie model; the others may be checked by the sectional method."
              : "Every region has a load within two depths of a column face: the strut-and-tie model governs."}
        </p>
        {bCount > 0 && <Toggle label="Check the B-Regions by the sectional method (5.6, 5.7)" value={on} onChange={onToggle} />}
        {on && bCount > 0 && (
          <>
            <ChecksTable checks={sec.checks} groupOf={(id) => sec.regions.find((g) => id.startsWith(`sec-${g.label.toLowerCase().replace(/\s+/g, "-")}-`))?.label ?? "Sectional"} />
            {sec.notes.map((n) => (
              <p key={n} className="text-muted-foreground">
                {n}
              </p>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
