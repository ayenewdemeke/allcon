"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type CulvertWingwall, defaultWingwall, m60120Wingwall } from "@/lib/design/culverts/m601-20";
import { Choice, Field, fmt, Toggle } from "./design-kit";

// A box culvert's wingwalls by CDOT M-601-20: entered as the plans tabulate them (m, k, L, θ),
// looked up in the standard's tables rather than designed.

const NAMES = ["NE", "NW", "SE", "SW"];

export function WingwallInputs({ walls, rise, onChange }: { walls: CulvertWingwall[]; rise: number; onChange: (w: CulvertWingwall[]) => void }) {
  const set = (n: number, patch: Partial<CulvertWingwall>) => onChange(walls.map((w, i) => (i === n ? { ...w, ...patch } : w)));
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">CDOT M-601-20: the c-bars and steel from Sheet 2&apos;s table, the footing and concrete from Sheet 1. m defaults to the rise + 1&apos;-4&quot;.</p>
      {walls.map((w, n) => (
        <div key={n} className="rounded-md border p-2">
          <div className="flex items-center justify-between gap-2 pb-1 text-xs">
            <input className="w-24 rounded border bg-background px-1.5 py-0.5 text-xs font-medium" value={w.name} aria-label="Wingwall name" onChange={(e) => set(n, { name: e.target.value })} />
            <button type="button" className="text-muted-foreground hover:text-red-600" onClick={() => onChange(walls.filter((_, i) => i !== n))}>
              Remove
            </button>
          </div>
          <Field label="m, height at the barrel" unit="ft" value={w.m} onChange={(v) => set(n, { m: v })} step={0.1} />
          <Field label="k, height at the tip" unit="ft" value={w.k} onChange={(v) => set(n, { k: v })} step={0.1} />
          <Field label="L, length" unit="ft" value={w.L} onChange={(v) => set(n, { L: v })} step={0.1} />
          <Field label="θ, from the barrel" unit="deg" value={w.theta} onChange={(v) => set(n, { theta: v })} hint="Layout only: the tables don't depend on it" />
          <Choice
            label="At the culvert's"
            value={w.end ?? (n < 2 ? "inlet" : "outlet")}
            options={[
              { value: "inlet", label: "Inlet" },
              { value: "outlet", label: "Outlet" },
            ]}
            onChange={(v) => set(n, { end: v })}
          />
          <Toggle label="Toe wall" value={w.toeWall} onChange={(v) => set(n, { toeWall: v })} />
        </div>
      ))}
      <div className="flex gap-2 text-xs">
        <button type="button" className="rounded border px-2 py-1 hover:bg-muted" onClick={() => onChange([...walls, defaultWingwall(NAMES[walls.length] ?? `W${walls.length + 1}`, rise)])}>
          Add wingwall
        </button>
        {walls.length === 0 && (
          <button type="button" className="rounded border px-2 py-1 hover:bg-muted" onClick={() => onChange(NAMES.map((name) => defaultWingwall(name, rise)))}>
            Add four
          </button>
        )}
      </div>
    </div>
  );
}

/** Each wingwall's lookup and quantities. */
export function WingwallResults({ walls }: { walls: CulvertWingwall[] }) {
  if (!walls.length) return null;
  const rows = walls.map((w) => ({ w, r: m60120Wingwall(w) }));
  const tot = rows.reduce((s, { r }) => ({ cy: s.cy + r.concrete + (r.toe?.cy ?? 0), lb: s.lb + r.rebar + (r.toe?.lb ?? 0) }), { cy: 0, lb: 0 });
  return (
    <Card>
      <CardContent className="overflow-x-auto py-3 text-xs">
        <p className="pb-1 font-semibold">Wingwalls (CDOT M-601-20)</p>
        <table className="w-full">
          <thead>
            <tr className="text-right text-muted-foreground">
              <th className="text-left font-normal">Wall</th>
              <th className="font-normal">m / k (table)</th>
              <th className="font-normal">L / m</th>
              <th className="font-normal">Column</th>
              <th className="font-normal">c-bars</th>
              <th className="font-normal">lb/LF</th>
              <th className="font-normal">Steel lb</th>
              <th className="font-normal">Concrete CY</th>
              <th className="font-normal">Footing at barrel</th>
              <th className="font-normal">Toe wall</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ w, r }, n) => (
              <tr key={n} className="border-b border-border/40 text-right tabular-nums">
                <td className={cn("text-left font-medium", r.inTable ? "" : "text-red-600")}>{w.name}</td>
                <td>
                  {fmt(w.m, 3)} / {fmt(w.k, 3)} ({r.mR} / {r.kR})
                </td>
                <td>{r.ratio.toFixed(2)}</td>
                <td className="whitespace-nowrap">{r.colLabel}</td>
                <td className="whitespace-nowrap">{r.cell ? `#${r.cell.cBars.bar} @ ${r.cell.cBars.spacing}"` : "—"}</td>
                <td>{r.cell ? r.cell.lbPerLf.toFixed(2) : "—"}</td>
                <td>{r.cell ? r.rebar.toFixed(0) : "—"}</td>
                <td>{r.concrete.toFixed(2)}</td>
                <td className="whitespace-nowrap">{r.footing ? `h ${r.footing.h}: a ${r.footing.a}, b ${r.footing.b}, w ${r.footing.w}, d #${r.footing.d.replace("@", ' @ ')}"` : "—"}</td>
                <td className="whitespace-nowrap">{r.toe ? `${r.toe.cy.toFixed(2)} CY, ${r.toe.lb.toFixed(0)} lb` : "None"}</td>
              </tr>
            ))}
            <tr className="text-right font-medium tabular-nums">
              <td className="text-left">Total, with toe walls</td>
              <td colSpan={5} />
              <td>{tot.lb.toFixed(0)}</td>
              <td>{tot.cy.toFixed(2)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
        {rows.flatMap(({ w, r }) => [
          ...r.issues.map((t) => (
            <p key={`${w.name}-${t}`} className="pt-1 text-red-600">
              {w.name}: {t}
            </p>
          )),
          ...(r.drain ? [<p key={`${w.name}-drain`} className="pt-1 text-muted-foreground">{w.name}: m ≥ 12 ft, drainage behind the wall required (note 6).</p>] : []),
        ])}
        <p className="pt-2 text-muted-foreground">Sheet 2: m and k rounded to the nearest foot, L/m up to the next column; steel = lb/LF × L (stem and footing). Concrete by Sheet 1&apos;s CY/LF, stepped by h along the wall. Toe wall 0.049 CY and 5.1 lb per foot.</p>
      </CardContent>
    </Card>
  );
}
