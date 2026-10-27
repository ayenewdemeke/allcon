"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { deleteLayout, renameLayout } from "@/lib/drafting/commands-layout";
import type { Editor, Snapshot } from "@/lib/drafting/editor";
import { cn } from "@/lib/utils";

// The Model and layout tabs at the bottom left, as AutoCAD's: click to switch, double-click to
// rename, right-click for the layout menu, and + for a new layout.

export function LayoutTabs({ editor, state }: { editor: Editor; state: Snapshot }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number } | null>(null);
  const tab = "h-6 rounded-t border-x border-t px-3 whitespace-nowrap";
  const active = "border-b-2 border-b-primary bg-background font-medium text-foreground";

  const finishRename = (id: string, name: string) => {
    setRenaming(null);
    if (name.trim() && !renameLayout(editor, id, name)) editor.print(`Couldn't rename: "${name.trim()}" is taken.`, "error");
  };

  return (
    <div className="relative flex min-w-0 items-end gap-0.5 self-end overflow-x-auto" onClick={() => setMenu(null)}>
      <button type="button" onClick={() => editor.setLayout(null)} className={cn(tab, !state.layout ? active : "border-transparent text-muted-foreground hover:text-foreground")}>
        Model
      </button>
      {state.layouts.map((l) =>
        renaming === l.id ? (
          <input
            key={l.id}
            defaultValue={l.name}
            autoFocus
            onFocus={(e) => e.target.select()}
            onBlur={(e) => finishRename(l.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishRename(l.id, (e.target as HTMLInputElement).value);
              if (e.key === "Escape") setRenaming(null);
            }}
            className="h-6 w-28 rounded-t border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
        ) : (
          <button
            key={l.id}
            type="button"
            onClick={() => editor.setLayout(l.id)}
            onDoubleClick={() => setRenaming(l.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: l.id, x: (e.currentTarget as HTMLElement).offsetLeft });
            }}
            className={cn(tab, state.layout === l.id ? active : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {l.name}
          </button>
        ),
      )}
      <button type="button" onClick={() => editor.newLayout()} className="mb-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="New layout" aria-label="New layout">
        <Plus className="size-3.5" />
      </button>
      {menu && (
        <div className="fixed z-50 w-44 rounded-md border bg-popover p-1 text-xs shadow-lg" style={{ left: menu.x + 8, bottom: 34 }} onMouseLeave={() => setMenu(null)}>
          {[
            ["Rename", () => setRenaming(menu.id)],
            ["Page Setup…", () => {
              editor.setLayout(menu.id);
              editor.openDialog({ kind: "page-setup", layout: menu.id, done: () => {} });
            }],
            ["Plot…", () => {
              editor.setLayout(menu.id);
              editor.openDialog({ kind: "plot", done: () => {} });
            }],
            ["New Layout", () => editor.newLayout()],
            ["Delete", () => {
              const name = state.layouts.find((x) => x.id === menu.id)?.name;
              if (window.confirm(`Delete layout "${name}" and everything on it?`)) deleteLayout(editor, menu.id);
            }],
          ].map(([label, run]) => (
            <button
              key={label as string}
              type="button"
              className="block w-full rounded px-2 py-1 text-left hover:bg-muted"
              onClick={() => {
                setMenu(null);
                (run as () => void)();
              }}
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
