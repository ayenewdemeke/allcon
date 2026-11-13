"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, Cloud, FileText, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createCalcFromDesign, renameDesign, saveDesignInputs, setDesignProject } from "@/app/actions/design";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MAX_DECIMALS, showNum } from "@/lib/design/calc-style";
import { BARS, type Bars, type Check as DesignCheck } from "@/lib/design/walls/cip";
import { cn } from "@/lib/utils";

// What every design editor shares: input fields, the header (name, project, saved-as-you-go, calc
// package) and the checks.

/** A design output: at most three decimals, small values in powers of ten (calc-style's rule). */
export const fmt = (v: number, d = MAX_DECIMALS) => showNum(v, d);

export function Field({ label, unit, value, onChange, step = 1, hint, scale = 1 }: { label: string; unit?: string; value: number; onChange: (v: number) => void; step?: number; hint?: string; scale?: number }) {
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

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-2 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select value={String(value)} onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)} className="h-7 rounded-md border border-input bg-transparent px-1">
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
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

export function BarsField({ label, value, onChange }: { label: string; value: Bars; onChange: (b: Bars) => void }) {
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

type Save = "saved" | "saving" | "unsaved" | "error";

/** The design's name, project, save status (saved as you go) and the calc package button. */
export function DesignHeader<T>({ design, projects, inputs, label, canMakeCalc }: { design: { id: string; name: string; projectId: string | null }; projects: { id: string; name: string }[]; inputs: T; label: string; canMakeCalc: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(design.name);
  const [projectId, setProjectId] = useState(design.projectId);
  const [save, setSave] = useState<Save>("saved");
  const [making, setMaking] = useState(false);

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

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== design.name && renameDesign(design.id, name).catch(() => toast.error("Could not rename the design"))}
        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold outline-none hover:border-input focus:border-input"
        aria-label="Design name"
      />
      <span className="text-xs text-muted-foreground">{label}</span>
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
      <Button size="sm" onClick={() => void makeCalc()} disabled={making || !canMakeCalc}>
        {making ? <Loader2 className="animate-spin" /> : <FileText />}
        Create calc package
      </Button>
    </div>
  );
}

export function DesignErrorCard({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0" /> <span className="flex-1">{message}</span>
        {action}
      </CardContent>
    </Card>
  );
}

/** All checks pass, or which fail. */
export function ChecksBanner({ checks, extra }: { checks: DesignCheck[]; extra?: React.ReactNode }) {
  const required = checks.filter((c) => !c.advisory);
  const failing = required.filter((c) => !c.ok);
  const info = checks.length - required.length;
  const exceeded = checks.filter((c) => c.advisory && !c.ok).length;
  const ok = failing.length === 0;
  const infoText = info ? ` ${info} for information${exceeded ? `, ${exceeded} over its limit` : ""}.` : "";
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-4 py-3 text-sm", ok ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200")}>
      {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      {ok ? `All ${required.length} checks pass.${infoText}` : `${failing.length} of ${required.length} checks fail: ${failing.map((c) => c.name).join("; ")}.${infoText}`}
      {extra}
    </div>
  );
}

/** The checks, grouped, with demand, capacity and ratio. */
export function ChecksTable({ checks, groupOf }: { checks: DesignCheck[]; groupOf: (id: string) => string }) {
  return (
    <Card>
      <CardContent className="overflow-x-auto py-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 font-normal">Check</th>
              <th className="text-right font-normal">Demand</th>
              <th className="pl-4 text-right font-normal">Capacity</th>
              <th className="pl-3 text-left font-normal">Ratio</th>
              <th className="font-normal" />
              <th className="pl-3 text-left font-normal">Reference</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c, idx) => {
              const ratio = c.capacity > 0 ? c.demand / c.capacity : Infinity;
              const head = idx === 0 || groupOf(checks[idx - 1].id) !== groupOf(c.id);
              return [
                head && (
                  <tr key={`${c.id}-h`}>
                    <td colSpan={6} className="pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {groupOf(c.id)}
                    </td>
                  </tr>
                ),
                <tr key={c.id} className="border-b border-border/50" title={c.note}>
                  <td className="py-1 pr-2">{c.name}</td>
                  <td className="pl-2 text-right tabular-nums">{fmt(c.demand)}</td>
                  <td className="pl-4 text-right whitespace-nowrap tabular-nums">
                    {fmt(c.capacity)} <span className="text-muted-foreground">{c.unit}</span>
                  </td>
                  <td className="pl-3">
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-16 overflow-hidden rounded bg-muted">
                        <span className={cn("block h-full", c.ok ? "bg-emerald-500" : c.advisory ? "bg-amber-500" : "bg-red-500")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                      </span>
                      <span className="tabular-nums">{Number.isFinite(ratio) ? ratio.toFixed(2) : "—"}</span>
                    </span>
                  </td>
                  <td className={cn("px-2 font-medium", c.ok ? "text-emerald-600" : c.advisory ? "text-amber-600" : "text-red-600")} title={c.advisory ? "For information: someone else's design (see the note)" : undefined}>
                    {c.advisory ? (c.ok ? "Info" : "Info ↑") : c.ok ? "OK" : "NG"}
                  </td>
                  <td className="pl-3 whitespace-nowrap text-muted-foreground">{c.ref}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** Key–value rows for the working. */
export function KeyValues({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-3 text-xs">
        <p className="pb-1 font-semibold">{title}</p>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
            <span className="text-muted-foreground">{k}</span>
            <span className="tabular-nums">{v}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
