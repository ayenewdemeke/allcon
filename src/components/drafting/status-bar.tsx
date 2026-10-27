"use client";

import { useEffect, useState } from "react";
import { ChevronUp, Compass, Lock, CornerDownRight, Grid3x3, Magnet, Moon, Sun, Target, TextCursorInput } from "lucide-react";
import type { Editor, Settings, Snapshot } from "@/lib/drafting/editor";
import { SNAP_KINDS, type SnapKind } from "@/lib/drafting/snaps";
import { cn } from "@/lib/utils";
import { setViewportScale } from "@/lib/drafting/commands-layout";
import { VIEWPORT_SCALES, viewportScaleName } from "@/lib/drafting/layouts";
import type { ViewportEntity } from "@/lib/drafting/types";
import { Popover } from "./controls";
import { LayoutTabs } from "./layout-tabs";

// The status bar: Model tab, the cursor's coordinates, and the drafting aids with their
// function keys, as in AutoCAD's status bar.

function Coordinates({ editor }: { editor: Editor }) {
  const [text, setText] = useState("");
  useEffect(
    () =>
      editor.onPointer(() => {
        const p = editor.cursorScreen ? editor.point : null;
        setText(p ? `${editor.formatLength(p.x)}, ${editor.formatLength(p.y)}, 0` : "");
      }),
    [editor],
  );
  return <span className="w-56 truncate font-mono tabular-nums text-muted-foreground">{text}</span>;
}

function Toggle({ on, label, keyName, icon: Icon, onClick }: { on: boolean; label: string; keyName: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} (${keyName}): ${on ? "on" : "off"}`}
      aria-pressed={on}
      className={cn("flex h-6 items-center rounded px-1.5 hover:bg-accent", on ? "text-primary" : "text-muted-foreground")}
    >
      <Icon className="size-4" />
    </button>
  );
}

const POLAR_ANGLES = [90, 45, 30, 22.5, 18, 15, 10, 5];

/** AutoCAD's annotation scale list: the size new text, dimension styles and hatches are made for. */
const ANNO_SCALES = {
  architectural: [
    ['1/16" = 1\'-0"', 192],
    ['3/32" = 1\'-0"', 128],
    ['1/8" = 1\'-0"', 96],
    ['3/16" = 1\'-0"', 64],
    ['1/4" = 1\'-0"', 48],
    ['3/8" = 1\'-0"', 32],
    ['1/2" = 1\'-0"', 24],
    ['3/4" = 1\'-0"', 16],
    ['1" = 1\'-0"', 12],
    ['1 1/2" = 1\'-0"', 8],
    ['3" = 1\'-0"', 4],
    ["1:1", 1],
  ],
  mm: [
    ["1:1", 1],
    ["1:2", 2],
    ["1:5", 5],
    ["1:10", 10],
    ["1:20", 20],
    ["1:25", 25],
    ["1:50", 50],
    ["1:100", 100],
    ["1:200", 200],
    ["1:500", 500],
    ["1:1000", 1000],
  ],
} as const;

function scaleName(units: "architectural" | "mm", factor: number) {
  return ANNO_SCALES[units].find(([, f]) => f === factor)?.[0] ?? `1:${factor}`;
}

export function StatusBar({ editor, state, dark, onTheme }: { editor: Editor; state: Snapshot; dark: boolean; onTheme: (dark: boolean) => void }) {
  const s: Settings = state.settings;
  const toggleKind = (kind: SnapKind) =>
    editor.setSettings({ snapKinds: s.snapKinds.includes(kind) ? s.snapKinds.filter((k) => k !== kind) : [...s.snapKinds, kind] });

  return (
    <div className="flex h-8 items-center gap-1 border-t bg-muted/40 px-2 text-xs">
      <LayoutTabs editor={editor} state={state} />
      <span className="ml-3 shrink-0">
        <Coordinates editor={editor} />
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {state.layout ? (
          <button
            type="button"
            onClick={() => (state.viewport ? editor.exitViewport() : editor.runCommand("MSPACE"))}
            className="mr-1 rounded px-1 font-semibold tracking-wide text-muted-foreground hover:bg-accent"
            title={state.viewport ? "Working through a viewport: click for the paper (PS)" : "On the paper: click to work through a viewport (MS)"}
          >
            {state.viewport ? "MODEL" : "PAPER"}
          </button>
        ) : (
          <span className="mr-1 font-semibold tracking-wide text-muted-foreground">MODEL</span>
        )}
        <Toggle on={s.grid} label="Grid" keyName="F7" icon={Grid3x3} onClick={() => editor.toggle("grid")} />
        <Toggle on={s.snap} label="Snap to grid" keyName="F9" icon={Magnet} onClick={() => editor.toggle("snap")} />
        <Toggle on={s.ortho} label="Ortho" keyName="F8" icon={CornerDownRight} onClick={() => editor.toggle("ortho")} />
        <Toggle on={s.polar} label="Polar tracking" keyName="F10" icon={Compass} onClick={() => editor.toggle("polar")} />
        <Popover
          align="right"
          side="top"
          trigger={(_, toggle) => (
            <button type="button" onClick={toggle} className="-ml-1 h-6 rounded px-0.5 text-muted-foreground hover:bg-accent" aria-label="Polar angles">
              <ChevronUp className="size-3" />
            </button>
          )}
        >
          {(close) => (
            <div className="w-40">
              <p className="px-2 py-1 text-[10px] text-muted-foreground uppercase">Track every</p>
              {POLAR_ANGLES.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={cn("block w-full rounded px-2 py-1 text-left hover:bg-muted", s.polarAngle === a && "bg-muted font-medium")}
                  onClick={() => {
                    close();
                    editor.setSettings({ polarAngle: a, polar: true, ortho: false });
                  }}
                >
                  {a}°
                </button>
              ))}
            </div>
          )}
        </Popover>
        <Toggle on={s.osnap} label="Object snap" keyName="F3" icon={Target} onClick={() => editor.toggle("osnap")} />
        <Popover
          align="right"
          side="top"
          trigger={(_, toggle) => (
            <button type="button" onClick={toggle} className="-ml-1 h-6 rounded px-0.5 text-muted-foreground hover:bg-accent" aria-label="Object snaps">
              <ChevronUp className="size-3" />
            </button>
          )}
        >
          {() => (
            <div className="w-44">
              {SNAP_KINDS.map(({ kind, label }) => (
                <label key={kind} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted">
                  <input type="checkbox" checked={s.snapKinds.includes(kind)} onChange={() => toggleKind(kind)} className="accent-primary" />
                  {label}
                </label>
              ))}
            </div>
          )}
        </Popover>
        <Toggle on={s.dynamic} label="Dynamic input" keyName="F12" icon={TextCursorInput} onClick={() => editor.toggle("dynamic")} />
        <Toggle on={s.lineweights} label="Show lineweights" keyName="LWT" icon={LineweightIcon} onClick={() => editor.toggle("lineweights")} />
        <span className="mx-1 h-4 w-px bg-border" />
        {state.layout ? <ViewportScale editor={editor} state={state} /> : <Popover
          align="right"
          side="top"
          trigger={(_, toggle) => (
            <button type="button" onClick={toggle} className="flex h-6 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-accent" title="Annotation scale: the size new text and hatches are made for">
              {scaleName(editor.doc.units, editor.doc.annoScale)}
              <ChevronUp className="size-3" />
            </button>
          )}
        >
          {(close) => (
            <div className="w-40">
              <p className="px-2 py-1 text-[10px] text-muted-foreground uppercase">Annotation scale</p>
              {ANNO_SCALES[editor.doc.units].map(([label, factor]) => (
                <button
                  key={label}
                  type="button"
                  className={cn("block w-full rounded px-2 py-1 text-left hover:bg-muted", editor.doc.annoScale === factor && "bg-muted font-medium")}
                  onClick={() => {
                    close();
                    editor.doc.setSetting("annoScale", factor);
                    editor.remember("textHeight", undefined);
                    editor.remember("hatchScale", undefined);
                    editor.print(`Annotation scale: ${label}. New text and hatches are sized for it; dimension sizes are set in the dimension style.`, "info");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </Popover>}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-muted-foreground">{editor.doc.units === "mm" ? "Millimeters" : "Architectural"}</span>
        <button type="button" onClick={() => onTheme(!dark)} className="ml-1 rounded p-1 text-muted-foreground hover:bg-accent" title={dark ? "Light theme" : "Dark theme"}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function LineweightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeLinecap="round">
      <path d="M2 4h12" strokeWidth={0.8} />
      <path d="M2 8h12" strokeWidth={1.6} />
      <path d="M2 12.5h12" strokeWidth={2.6} />
    </svg>
  );
}

/** On a layout: the scale of the viewport worked through (or the one selected), as AutoCAD's
 * status bar shows it. */
function ViewportScale({ editor, state }: { editor: Editor; state: Snapshot }) {
  void state.version;
  const layout = state.layout!;
  const main = editor.drawing;
  const vp = (state.viewport ? main.entitiesIn(layout).get(state.viewport) : editor.selected().find((e) => e.type === "viewport")) as ViewportEntity | undefined;
  const units = main.units;
  if (!vp) return <span className="px-1.5 text-muted-foreground" title="Select a viewport, or double-click inside one, to see its scale">Viewport scale</span>;
  return (
    <Popover
      align="right"
      side="top"
      trigger={(_, toggle) => (
        <button type="button" onClick={toggle} className="flex h-6 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-accent" title={vp.locked ? "Viewport scale (the viewport is locked)" : "Viewport scale"}>
          {viewportScaleName(vp.scale, units)}
          {vp.locked && <Lock className="size-3" />}
          <ChevronUp className="size-3" />
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-80 w-44 overflow-y-auto">
          <p className="px-2 py-1 text-[10px] text-muted-foreground uppercase">Viewport scale</p>
          {VIEWPORT_SCALES[units].map(([label, k]) => (
            <button
              key={label}
              type="button"
              className={cn("block w-full rounded px-2 py-1 text-left hover:bg-muted", Math.abs(vp.scale - k) < 1e-9 * k && "bg-muted font-medium")}
              onClick={() => {
                close();
                setViewportScale(editor, k);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
