"use client";

import { useCdot } from "./agency-context";
import { useState } from "react";
import { FileSpreadsheet, ListPlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createCalcFromDesign, pushDesignQuantities, saveDesignInputs } from "@/app/actions/design";
import { AGENCIES, agencyOf, payItemsFor, toolPayItems, type Agency, type QuantityRole } from "@/lib/design/rebar/cdot-items";
import { designPayLines, type PayLine } from "@/lib/design/rebar/pay-lines";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ftIn, unitWeight } from "@/lib/design/rebar/bars";
import { shapeDims, shapeName, type Schedule } from "@/lib/design/rebar/schedule";
import { fmt } from "./design-kit";

// A design's bar schedule and quantities, and the button that writes its quantity sheet to Calcs.
// Shared by the design tools: each passes its own schedule.

/** Whose pay items, the one chosen for each quantity, and the line items' heading the design went under. */
export type PayChoice = Partial<Record<QuantityRole, string>> & { agency?: Agency; headingId?: string | null };

const ROLE_LABEL: Record<QuantityRole, string> = {
  concrete: "Concrete",
  rebar: "Reinforcing steel",
  excavation: "Excavation",
  backfill: "Backfill",
  refill: "Backfill (rest of the excavation)",
  bedding: "Bedding",
  girder: "Girders",
  bearing: "Bearings",
  joint: "Joint",
  waterproofing: "Waterproofing",
  shaft: "Drilled shaft",
  facing: "Facing",
  "soil-reinforcement": "Reinforced soil",
  rail: "Bridge rail",
  removal: "Removal",
  sealant: "Joint sealant",
  pile: "Piling",
  "pile-tip": "Pile tips",
  prebore: "Prebored holes",
  testing: "Integrity testing",
  micropile: "Micropiles",
};

/** The design's quantities into its project's line items, under generic or the agency's pay items. */
function PushToLineItems({ design, inputs, kind, lines, value, onChange }: { design: { id: string; projectId: string | null }; inputs: unknown; kind: string; lines: PayLine[]; value: PayChoice; onChange: (v: PayChoice) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const push = async () => {
    setBusy(true);
    try {
      await saveDesignInputs(design.id, inputs);
      const chosen: Partial<Record<QuantityRole, string>> = Object.fromEntries(lines.map((l) => [l.role, l.code]));
      const r = await pushDesignQuantities(design.id, chosen);
      onChange({ ...value, headingId: r.headingId });
      const projectId = design.projectId;
      toast.success(`${r.lines.length} pay items ${value.headingId ? "updated" : "added"} in the project's line items`, projectId ? { action: { label: "Open", onClick: () => router.push(`/projects/${projectId}/line-items`) } } : undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not push the quantities");
    } finally {
      setBusy(false);
    }
  };
  const agency = agencyOf(value.agency);
  const cdot = useCdot(); // CDOT's pay items, with its rules on (or where the design already uses them)
  // A new agency starts from its own defaults: the old choices are another agency's items.
  const roles = Object.keys(toolPayItems(kind, agency)) as QuantityRole[];
  const setAgency = (a: Agency) => onChange({ ...Object.fromEntries(Object.entries(value).filter(([k]) => !roles.includes(k as QuantityRole))), agency: a, headingId: value.headingId });
  const select = (role: QuantityRole, current: string) => (
    <select value={current} onChange={(e) => onChange({ ...value, [role]: e.target.value })} className="h-7 w-full rounded-md border border-input bg-transparent px-1 text-xs" aria-label={`${ROLE_LABEL[role]} pay item`}>
      {payItemsFor(kind, role, agency).map((p) => (
        <option key={p.code} value={p.code}>
          {p.code} {p.description} ({p.unit})
        </option>
      ))}
    </select>
  );
  return (
    <Card>
      <CardContent className="space-y-2 py-3 text-xs">
        <div className="flex items-center gap-2">
          <p className="font-semibold">Project line items</p>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void push()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <ListPlus />} {value.headingId ? "Update line items" : "Push to line items"}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(cdot || agency === "cdot") && <label className="space-y-1">
            <span className="text-muted-foreground">Pay items</span>
            <select value={agency} onChange={(e) => setAgency(agencyOf(e.target.value))} className="h-7 w-full rounded-md border border-input bg-transparent px-1 text-xs" aria-label="Pay items">
              {AGENCIES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>}
          {lines
            .filter((l) => payItemsFor(kind, l.role, agency).length > 1)
            .map((l) => (
              <label key={l.role} className="space-y-1">
                <span className="text-muted-foreground">{ROLE_LABEL[l.role]} pay item</span>
                {select(l.role, l.code)}
              </label>
            ))}
        </div>
        <table className="w-full">
          <tbody>
            {lines.map((l) => (
              <tr key={l.code} className="border-b border-border/40">
                <td className="pr-2 tabular-nums">{l.code}</td>
                <td>{l.description}</td>
                <td className="text-right tabular-nums">{l.unit === "LB" ? fmt(l.quantity, 0) : fmt(l.quantity, 1)}</td>
                <td className="pl-1">{l.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground">{agency === "cdot" ? "CDOT item numbers, descriptions and pay units (Master Item Code Book)." : "Generic pay items: CSI MasterFormat sections, one per quantity."} The lines go under a heading for this design in its project&apos;s line items; pushing again updates them, keeping their rates.</p>
      </CardContent>
    </Card>
  );
}

export function RebarScheduleTab({ design, inputs, schedule, notes, pay }: { design: { id: string; projectId: string | null }; inputs: unknown; schedule: Schedule; notes?: string[]; pay?: { kind: string; value: PayChoice; onChange: (v: PayChoice) => void; lines?: PayLine[] } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      await saveDesignInputs(design.id, inputs);
      const { calcId } = await createCalcFromDesign(design.id, "quantities");
      toast.success("Quantity sheet created in Calcs", { action: { label: "Open", onClick: () => router.push(`/calcs/${calcId}`) } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the quantity sheet");
    } finally {
      setBusy(false);
    }
  };
  const s = schedule;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="overflow-x-auto py-3 text-xs">
          <div className="flex items-center gap-2 pb-2">
            <p className="font-semibold">Bar schedule</p>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => void make()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Create quantity sheet
            </Button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-normal">Size</th>
                <th className="text-right font-normal">No.</th>
                <th className="text-right font-normal">Length</th>
                <th className="pl-2 font-normal">Shape</th>
                <th className="font-normal">Use</th>
                <th className="text-right font-normal">Weight lb</th>
              </tr>
            </thead>
            <tbody>
              {s.groups.map((g) => (
                <tr key={g.mark} className="border-b border-border/40 align-top">
                  <td className="font-medium">#{g.size}</td>
                  <td className="text-right tabular-nums">{g.count}</td>
                  <td className="text-right tabular-nums">
                    {g.series && <span className="text-muted-foreground">avg. </span>}
                    {ftIn(g.length)}
                  </td>
                  <td className="pl-2">
                    {shapeName(g.shape)}
                    {g.series && " series"}
                    <span className="block text-[11px] text-muted-foreground">{shapeDims(g.shape, g.series)}</span>
                  </td>
                  <td>
                    {g.use}
                    {g.where && <span className="text-muted-foreground"> ({g.where})</span>}
                    <span className="block text-[11px] text-muted-foreground">{g.callout}</span>
                    {g.splice && <span className="block text-[11px] text-muted-foreground">{g.splice}</span>}
                    {g.paid && <span className="block text-[11px] text-muted-foreground">Paid under {g.paid}</span>}
                  </td>
                  <td className="text-right tabular-nums">{fmt(((g.count * g.length) / 12) * unitWeight(g.size), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-4 py-3 text-xs sm:grid-cols-2">
          <div>
            <p className="pb-1 font-semibold">Reinforcing steel</p>
            <table className="w-full">
              <tbody>
                {s.bySize.map((b) => (
                  <tr key={b.size} className="border-b border-border/40">
                    <td>#{b.size}</td>
                    <td className="text-right tabular-nums">{fmt(b.length, 0)} ft</td>
                    <td className="text-right tabular-nums">{fmt(b.weight, 0)} lb</td>
                  </tr>
                ))}
                {(s.extra ?? []).map((e) => (
                  <tr key={e.label} className="border-b border-border/40" title={e.basis}>
                    <td colSpan={2}>{e.label} (tabulated)</td>
                    <td className="text-right tabular-nums">{fmt(e.weight, 0)} lb</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td>Total</td>
                  <td />
                  <td className="text-right tabular-nums">{fmt(s.total, 0)} lb</td>
                </tr>
                {(s.elsewhere ?? []).map((e) => (
                  <tr key={e.label} className="text-muted-foreground">
                    <td colSpan={2}>In {e.label}</td>
                    <td className="text-right tabular-nums">{fmt(e.weight, 0)} lb</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="pb-1 font-semibold">Concrete</p>
            <table className="w-full">
              <tbody>
                {s.concrete.map((c) => (
                  <tr key={c.label} className="border-b border-border/40" title={c.basis}>
                    <td>{c.label}</td>
                    <td className="text-right tabular-nums">{fmt(c.cy, 2)} CY</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="text-right tabular-nums">{fmt(s.concreteTotal, 2)} CY</td>
                </tr>
              </tbody>
            </table>
            {s.concreteTotal > 0 && <p className="pt-1 text-muted-foreground">{fmt(s.total / s.concreteTotal, 0)} lb of bars per CY.</p>}
          </div>
        </CardContent>
      </Card>
      {pay && <PushToLineItems design={design} inputs={inputs} kind={pay.kind} lines={pay.lines ?? designPayLines(s, pay.value, toolPayItems(pay.kind, agencyOf(pay.value.agency)))} value={pay.value} onChange={pay.onChange} />}
      {notes && notes.length > 0 && (
        <Card>
          <CardContent className="space-y-1 py-3 text-xs text-muted-foreground">
            {notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
