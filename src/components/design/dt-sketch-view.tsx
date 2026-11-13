"use client";

import { useState } from "react";
import { ExternalLink, Maximize2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { DtSketch } from "@/lib/design/rating/double-tee";
import { cn } from "@/lib/utils";
import { sketchUrl } from "./dt-files";

// The inspection sketch attached to a rating, beside ALLCON's drawing of the section: its pages, and
// a full-size view to read the dimensions (fit the window, or actual size and scroll).

export function SketchView({ designId, sketch, onRemove, onReadCallouts }: { designId: string; sketch: DtSketch; onRemove: () => void; onReadCallouts?: () => void }) {
  const [page, setPage] = useState(0);
  const [big, setBig] = useState(false);
  const [actual, setActual] = useState(false);
  const p = sketch.pages[Math.min(page, sketch.pages.length - 1)];
  if (!p) return null;
  const url = sketchUrl(designId, p.key);
  return (
    <Card>
      <CardContent className="space-y-2 py-3">
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="truncate font-semibold" title={sketch.name}>
            Inspection sketch: {sketch.name}
          </span>
          {sketch.pages.length > 1 &&
            sketch.pages.map((_, k) => (
              <Button key={k} size="xs" variant={k === page ? "secondary" : "ghost"} onClick={() => setPage(k)}>
                Page {k + 1}
              </Button>
            ))}
          <span className="ml-auto flex items-center gap-0.5">
            {onReadCallouts && (
              <Button size="xs" variant="ghost" onClick={onReadCallouts} title="Read the sketch's labeled callouts (units, deck, flange, asphalt, span, widths)">
                Read callouts
              </Button>
            )}
            <Button size="icon-xs" variant="ghost" aria-label="Full size" title="Full size" onClick={() => setBig(true)}>
              <Maximize2 />
            </Button>
            <a href={url} target="_blank" rel="noreferrer" aria-label="Open in a new tab" title="Open in a new tab" className="inline-flex size-6 items-center justify-center rounded-md hover:bg-muted">
              <ExternalLink className="size-3" />
            </a>
            <Button size="icon-xs" variant="ghost" aria-label="Remove the sketch" title="Remove the sketch" onClick={onRemove}>
              <Trash2 />
            </Button>
          </span>
        </div>
        <button type="button" className="block w-full cursor-zoom-in" onClick={() => setBig(true)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored picture behind a signed redirect */}
          <img src={url} alt={`${sketch.name}, page ${page + 1}`} className="max-h-[520px] w-full rounded border object-contain" />
        </button>
      </CardContent>
      {big && (
        <Dialog open onOpenChange={(o) => !o && setBig(false)}>
          <DialogContent className="flex h-[92vh] max-w-[96vw] flex-col gap-2 sm:max-w-[96vw]">
            <div className="flex items-center gap-2 pr-8 text-xs">
              <DialogTitle className="text-sm">{sketch.name}</DialogTitle>
              <Button size="xs" variant="outline" onClick={() => setActual((a) => !a)}>
                {actual ? "Fit to window" : "Actual size"}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded border bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element -- a stored picture behind a signed redirect */}
              <img src={url} alt={`${sketch.name}, page ${page + 1}`} className={cn(actual ? "max-w-none" : "h-full w-full object-contain")} style={actual ? { width: p.width, height: p.height } : undefined} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
