"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { renameSheet, setProjectUnits, type SavedMarkup } from "@/app/actions/sheets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMeasure, measureMarkup, SCALE_PRESETS, type UnitSystem } from "@/lib/takeoff";
import { cn } from "@/lib/utils";
import type { SheetInfo } from "./sheet-workspace";

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#ca8a04", "#9333ea", "#0891b2", "#ea580c", "#475569"];

const KIND_LABELS: Record<SavedMarkup["kind"], string> = {
  length: "Length",
  area: "Area",
  count: "Count",
  note: "Note",
  arrow: "Arrow",
  cloud: "Cloud",
};

const selectClass = "h-8 w-full rounded-lg border border-input bg-card px-2 text-sm";

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-b p-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Text input that saves when it loses focus or Enter is pressed. */
function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    // The saved value changed underneath us (e.g. another markup was selected).
    setBase(value);
    setDraft(value);
  }
  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function MarkupPanel({
  projectId,
  sheet,
  onSheetChange,
  markups,
  selectedId,
  onSelect,
  onPatch,
  onDelete,
  unitSystem,
  onUnitSystemChange,
  onScale,
  onCalibrate,
}: {
  projectId: string;
  sheet: SheetInfo;
  onSheetChange: (s: SheetInfo) => void;
  markups: SavedMarkup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<SavedMarkup>) => void;
  onDelete: (id: string) => void;
  unitSystem: UnitSystem;
  onUnitSystemChange: (u: UnitSystem) => void;
  onScale: (metersPerPoint: number | null, label: string | null) => void;
  onCalibrate: () => void;
}) {
  const router = useRouter();
  const mpp = sheet.metersPerPoint;
  const selected = markups.find((m) => m.id === selectedId) ?? null;

  async function saveSheetField(field: "number" | "title", value: string) {
    onSheetChange({ ...sheet, [field]: value.trim() || null });
    try {
      await renameSheet(sheet.id, { [field]: value });
      router.refresh(); // sheet names appear in the navigator
    } catch {
      toast.error("Could not rename the sheet");
    }
  }

  async function changeUnits(next: UnitSystem) {
    onUnitSystemChange(next);
    try {
      await setProjectUnits(projectId, next);
    } catch {
      onUnitSystemChange(unitSystem);
      toast.error("Could not change units");
    }
  }

  // Totals across the sheet
  const totals = { length: 0, area: 0, volume: 0, count: 0 };
  for (const m of markups) {
    const v = measureMarkup(m, mpp);
    if (!v) continue;
    totals[v.kind] += v.value;
    if (v.kind === "volume") totals.area += v.area; // an area with depth still counts as area
  }
  const measurable = markups.filter((m) => ["length", "area", "count"].includes(m.kind));
  const presetValue = SCALE_PRESETS.flatMap((g) => g.presets).find((p) => p.label === sheet.scaleLabel)?.label ?? "";

  const numbered = new Map<string, number>();
  const nameOf = (m: SavedMarkup) => {
    if (m.label) return m.label;
    if (m.kind === "note") return m.text?.split("\n")[0] ?? "Note";
    const n = (numbered.get(m.kind) ?? 0) + 1;
    numbered.set(m.kind, n);
    return `${KIND_LABELS[m.kind]} ${n}`;
  };
  const names = new Map(markups.map((m) => [m.id, nameOf(m)]));

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-t bg-card lg:w-80 lg:border-t-0 lg:border-l">
      <Section title="Sheet">
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <CommitInput
            aria-label="Sheet number"
            placeholder={`P${sheet.pageIndex + 1}`}
            value={sheet.number ?? ""}
            onCommit={(v) => saveSheetField("number", v)}
          />
          <CommitInput
            aria-label="Sheet title"
            placeholder="Title, e.g. Site plan"
            value={sheet.title ?? ""}
            onCommit={(v) => saveSheetField("title", v)}
          />
        </div>
      </Section>

      <Section
        title="Scale"
        action={
          mpp ? (
            <Badge variant="success">{sheet.scaleLabel ?? "Calibrated"}</Badge>
          ) : (
            <Badge variant="warning">Not scaled</Badge>
          )
        }
      >
        <div className="flex gap-2">
          <select
            aria-label="Drawing scale"
            className={selectClass}
            value={presetValue}
            onChange={(e) => {
              const preset = SCALE_PRESETS.flatMap((g) => g.presets).find((p) => p.label === e.target.value);
              if (preset) onScale(preset.metersPerPoint, preset.label);
            }}
          >
            <option value="" disabled>
              {mpp && !presetValue ? "Calibrated" : "Choose a scale…"}
            </option>
            {SCALE_PRESETS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.presets.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button variant="outline" size="sm" className="h-8" onClick={onCalibrate}>
            Calibrate
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Printed scales only hold if the PDF is at full size. Calibrating against a known dimension is safer.
        </p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">Units (whole project)</span>
          <div className="flex rounded-md border p-0.5 text-xs">
            {(["imperial", "metric"] as const).map((u) => (
              <button
                key={u}
                onClick={() => u !== unitSystem && changeUnits(u)}
                className={cn(
                  "rounded px-2 py-0.5 capitalize",
                  u === unitSystem ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {selected && (
        <Section
          title={`Selected ${KIND_LABELS[selected.kind].toLowerCase()}`}
          action={
            <Button variant="ghost" size="icon-xs" onClick={() => onDelete(selected.id)} aria-label="Delete markup">
              <Trash2 className="text-destructive" />
            </Button>
          }
        >
          {(() => {
            const v = measureMarkup(selected, mpp);
            if (!v) return null;
            return (
              <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                <p className="text-lg font-semibold tabular-nums">{formatMeasure(v.value, v.kind, unitSystem)}</p>
                {"perimeter" in v && v.perimeter !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Perimeter {formatMeasure(v.perimeter, "length", unitSystem)}
                    {"area" in v && v.area !== undefined && ` · Area ${formatMeasure(v.area, "area", unitSystem)}`}
                  </p>
                )}
              </div>
            );
          })()}
          {selected.kind === "note" ? (
            <textarea
              key={selected.id}
              defaultValue={selected.text ?? ""}
              rows={3}
              onBlur={(e) => e.target.value !== selected.text && onPatch(selected.id, { text: e.target.value })}
              className="w-full rounded-lg border border-input bg-card px-2.5 py-2 text-sm"
              aria-label="Note text"
            />
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="markup-label" className="text-xs">
                Name
              </Label>
              <CommitInput
                id="markup-label"
                placeholder={names.get(selected.id)}
                value={selected.label ?? ""}
                onCommit={(v) => onPatch(selected.id, { label: v.trim() || null })}
              />
            </div>
          )}
          {selected.kind === "area" && (
            <div className="grid gap-1.5">
              <Label htmlFor="markup-depth" className="text-xs">
                Depth for volume ({unitSystem === "imperial" ? "inches" : "mm"})
              </Label>
              <CommitInput
                id="markup-depth"
                inputMode="decimal"
                placeholder={unitSystem === "imperial" ? "e.g. 4" : "e.g. 100"}
                value={
                  selected.depth
                    ? String(+(selected.depth / (unitSystem === "imperial" ? 0.0254 : 0.001)).toFixed(2))
                    : ""
                }
                onCommit={(v) => {
                  const n = Number(v);
                  if (v.trim() === "") return onPatch(selected.id, { depth: null });
                  if (!Number.isFinite(n) || n <= 0) return toast.error("Depth must be a positive number");
                  onPatch(selected.id, { depth: n * (unitSystem === "imperial" ? 0.0254 : 0.001) });
                }}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Color ${c}`}
                onClick={() => onPatch(selected.id, { color: c })}
                className={cn("size-6 rounded-full ring-offset-2 ring-offset-card", selected.color === c && "ring-2 ring-foreground")}
                style={{ background: c }}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Totals on this sheet">
        {measurable.length === 0 ? (
          <p className="text-sm text-muted-foreground">Measure with Length (L), Area (A) or Count (C).</p>
        ) : !mpp && totals.count === 0 ? (
          <p className="text-sm text-muted-foreground">Set the scale to see lengths and areas.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {(["length", "area", "volume", "count"] as const)
              .filter((k) => totals[k] > 0)
              .map((k) => (
                <div key={k} className="rounded-md bg-muted/60 px-3 py-2">
                  <dt className="text-xs text-muted-foreground capitalize">{k}</dt>
                  <dd className="font-semibold tabular-nums">{formatMeasure(totals[k], k, unitSystem)}</dd>
                </div>
              ))}
          </dl>
        )}
      </Section>

      <Section title={`Markups (${markups.length})`}>
        {markups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing drawn on this sheet yet.</p>
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {markups.map((m) => {
              const v = measureMarkup(m, mpp);
              return (
                <li key={m.id}>
                  <button
                    onClick={() => onSelect(m.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                      m.id === selectedId && "bg-accent text-accent-foreground hover:bg-accent",
                    )}
                  >
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: m.color }} />
                    <span className="min-w-0 flex-1 truncate">{names.get(m.id)}</span>
                    {v && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatMeasure(v.value, v.kind, unitSystem)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </aside>
  );
}
