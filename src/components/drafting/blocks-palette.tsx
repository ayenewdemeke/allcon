"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import { attributeDefs } from "@/lib/drafting/blocks";
import { InsertCommand } from "@/lib/drafting/commands-blocks";
import type { Editor, Snapshot } from "@/lib/drafting/editor";
import { emptyBox, extendBox, graphicsOf } from "@/lib/drafting/geometry";
import type { Block } from "@/lib/drafting/types";
import { PaletteFrame } from "./palettes";

// The Blocks palette (INSERT), as AutoCAD's: the drawing's blocks as pictures. Clicking one
// places it; the pencil opens it in the block editor.

/** A block drawn small, fitted to its tile. */
function Thumbnail({ block, dark }: { block: Block; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const [w, h] = [canvas.clientWidth, canvas.clientHeight];
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const drawings = block.entities.filter((e) => e.type !== "image").map(graphicsOf);
    const box = emptyBox();
    for (const g of drawings) for (const line of [...g.lines, ...g.fills]) line.forEach((p) => extendBox(box, p));
    if (!Number.isFinite(box.minX)) return;
    const scale = Math.min((w - 12) / Math.max(box.maxX - box.minX, 1e-9), (h - 12) / Math.max(box.maxY - box.minY, 1e-9));
    const at = (p: { x: number; y: number }) => [w / 2 + (p.x - (box.minX + box.maxX) / 2) * scale, h / 2 - (p.y - (box.minY + box.maxY) / 2) * scale] as const;
    const ink = dark ? "#e5e7eb" : "#111827";
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    for (const g of drawings) {
      for (const line of g.lines) {
        ctx.beginPath();
        line.forEach((p, i) => (i ? ctx.lineTo(...at(p)) : ctx.moveTo(...at(p))));
        ctx.stroke();
      }
      for (const fill of g.fills) {
        ctx.beginPath();
        fill.forEach((p, i) => (i ? ctx.lineTo(...at(p)) : ctx.moveTo(...at(p))));
        ctx.fill();
      }
    }
  }, [block, dark]);
  return <canvas ref={ref} className="h-16 w-full" />;
}

export function BlocksPalette({ editor, state, dark, onClose }: { editor: Editor; state: Snapshot; dark: boolean; onClose: () => void }) {
  const [filter, setFilter] = useState("");
  void state.version; // redrawn as blocks change
  const blocks = [...editor.doc.blocks.values()].filter((b) => b.name.toLowerCase().includes(filter.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <PaletteFrame title="Blocks" onClose={onClose}>
      <div className="flex items-center gap-1 border-b p-1.5">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" className="h-6 w-full rounded border bg-background pr-1 pl-5 text-xs outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <button type="button" title="Create a block (BLOCK)" onClick={() => editor.runCommand("BLOCK")} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="px-1.5 pt-1 text-[11px] font-semibold text-muted-foreground">Current Drawing Blocks</div>
      {!blocks.length ? (
        <p className="p-3 text-xs text-muted-foreground">{editor.doc.blocks.size ? "No blocks match." : "No blocks yet. Select objects and use Create Block (B) to make one."}</p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 p-1.5">
          {blocks.map((b) => {
            const attributes = attributeDefs(b).length;
            return (
              <div key={b.name} className="group relative rounded border bg-background hover:border-primary">
                <button type="button" title={b.description || `Insert ${b.name}`} onClick={() => editor.startCommand(new InsertCommand(editor, b.name))} className="block w-full p-1 text-left">
                  <Thumbnail block={b} dark={dark} />
                  <span className="block truncate px-0.5 text-[11px]">{b.name}</span>
                  {attributes > 0 && <span className="block px-0.5 text-[10px] text-muted-foreground">{attributes} attribute{attributes === 1 ? "" : "s"}</span>}
                </button>
                {!editor.blockEdit && (
                  <button
                    type="button"
                    title="Edit in the block editor (BEDIT)"
                    onClick={() => editor.editBlock(b.name)}
                    className="absolute top-1 right-1 hidden rounded bg-background/90 p-0.5 text-muted-foreground shadow-sm group-hover:block hover:text-foreground"
                  >
                    <Pencil className="size-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PaletteFrame>
  );
}
