"use client";

import { useEffect, useState } from "react";
import { ChevronUp, Compass, CornerDownRight, Grid3x3, Magnet, Moon, Sun, Target, TextCursorInput } from "lucide-react";
import type { Editor, Settings, Snapshot } from "@/lib/drafting/editor";
import { SNAP_KINDS, type SnapKind } from "@/lib/drafting/snaps";
import { cn } from "@/lib/utils";
import { Popover } from "./controls";

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

export function StatusBar({ editor, state, dark, onTheme }: { editor: Editor; state: Snapshot; dark: boolean; onTheme: (dark: boolean) => void }) {
  const s: Settings = state.settings;
  const toggleKind = (kind: SnapKind) =>
    editor.setSettings({ snapKinds: s.snapKinds.includes(kind) ? s.snapKinds.filter((k) => k !== kind) : [...s.snapKinds, kind] });

  return (
    <div className="flex h-8 items-center gap-1 border-t bg-muted/40 px-2 text-xs">
      <span className="rounded-t border-x border-b-2 border-b-primary bg-background px-3 py-0.5 font-medium">Model</span>
      <span className="ml-3">
        <Coordinates editor={editor} />
      </span>
      <div className="ml-auto flex items-center gap-0.5">
        <span className="mr-1 font-semibold tracking-wide text-muted-foreground">MODEL</span>
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
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-muted-foreground">{editor.doc.units === "mm" ? "Millimeters" : "Architectural"}</span>
        <button type="button" onClick={() => onTheme(!dark)} className="ml-1 rounded p-1 text-muted-foreground hover:bg-accent" title={dark ? "Light theme" : "Dark theme"}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </div>
  );
}
