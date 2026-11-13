"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DtInputs } from "@/lib/design/rating/double-tee";
import { getPath, SOURCE_LABEL } from "@/lib/design/rating/sources";
import { cn } from "@/lib/utils";

// A rating's bridge inputs with their sources: each shows where its value came from (SIA, sketch, BRM
// table, bridge file, entered, assumed). One without a source is needed: empty in a design started
// blank, or (saved before sources were kept) its old starting value, to confirm or change.

/** The source under an input: its kind and note, or what's needed. */
export function SourceLine({ i, path, onConfirm }: { i: DtInputs; path: string; onConfirm?: () => void }) {
  const src = i.sources[path];
  if (src)
    return (
      <span className="block truncate text-[10.5px] leading-tight text-muted-foreground" title={src.note ? `${SOURCE_LABEL[src.kind]}: ${src.note}` : SOURCE_LABEL[src.kind]}>
        {SOURCE_LABEL[src.kind]}
        {src.note ? `: ${src.note}` : ""}
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-[10.5px] leading-tight text-amber-700 dark:text-amber-400">
      {i.blankStart ? "Needed: from the SIA, the sketch or your entry" : "Still a starting value: confirm or change"}
      {!i.blankStart && onConfirm && (
        <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[10.5px]" onClick={onConfirm} title="This value is this bridge's">
          <Check /> Confirm
        </Button>
      )}
    </span>
  );
}

/** A number input of the bridge, with its source. */
export function SrcField({ i, path, label, unit, step = 1, hint, onSet, onConfirm, transform }: { i: DtInputs; path: string; label: string; unit?: string; step?: number; hint?: string; onSet: (path: string, v: number) => void; onConfirm: (path: string) => void; transform?: (v: number) => number }) {
  const value = Number(getPath(i, path));
  const needed = !i.sources[path];
  const blank = needed && i.blankStart;
  const shown = blank ? "" : String(+value.toFixed(6));
  const [text, setText] = useState(shown);
  const [last, setLast] = useState(shown);
  if (shown !== last) {
    // Changed from outside (the SIA, the sketch, a file): show it.
    setLast(shown);
    setText(shown);
  }
  return (
    <div className="py-0.5 text-xs" title={hint}>
      <label className="grid grid-cols-[1fr_7rem] items-center gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            step={step}
            value={text}
            placeholder="needed"
            onChange={(e) => {
              setText(e.target.value);
              const v = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(v)) {
                const t = transform ? transform(v) : v;
                setLast(String(+t.toFixed(6)));
                onSet(path, t);
              }
            }}
            className={cn("h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-right tabular-nums outline-none focus:ring-1 focus:ring-primary", needed ? "border-amber-400 placeholder:text-amber-600/70" : "border-input")}
          />
          <span className="w-9 shrink-0 text-[11px] text-muted-foreground">{unit}</span>
        </span>
      </label>
      <SourceLine i={i} path={path} onConfirm={() => onConfirm(path)} />
    </div>
  );
}

/** A yes/no fact of the bridge, with its source: needed until answered. */
export function SrcYesNo({ i, path, label, onSet, onConfirm }: { i: DtInputs; path: string; label: string; onSet: (path: string, v: boolean) => void; onConfirm: (path: string) => void }) {
  const value = Boolean(getPath(i, path));
  const needed = !i.sources[path];
  return (
    <div className="py-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex gap-1">
          {[true, false].map((v) => (
            <Button key={String(v)} size="xs" variant={!(needed && i.blankStart) && value === v ? "secondary" : "outline"} className={cn("h-6 px-2", needed && "border-amber-400")} onClick={() => onSet(path, v)}>
              {v ? "Yes" : "No"}
            </Button>
          ))}
        </span>
      </div>
      <SourceLine i={i} path={path} onConfirm={() => onConfirm(path)} />
    </div>
  );
}
