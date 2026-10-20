"use client";

import { useEffect, useRef, useState } from "react";
import { Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { initViewerRuntime } from "@/lib/aps/viewer-runtime";
import { cn } from "@/lib/utils";
import { useBoqTerms } from "@/components/line-items/boq-terms";

export type MappingColors = { mapped: number[]; unmapped: number[]; missing: number[] };

const COLORS = {
  mapped: [0.09, 0.64, 0.29], // green: priced
  unmapped: [0.96, 0.55, 0.1], // orange: not linked to any line item yet
  missing: [0.58, 0.62, 0.68], // grey: no usable quantity in the model
} as const;

export function ModelViewer({
  urn,
  isolate,
  isolateLabel,
  colors,
}: {
  urn: string;
  /** Viewer ids to isolate and zoom to, e.g. one element group from the mapping page. */
  isolate?: number[];
  isolateLabel?: string;
  colors?: MappingColors;
}) {
  const terms = useBoqTerms();
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Autodesk.Viewing.GuiViewer3D | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorOn, setColorOn] = useState(false);
  const [isolating, setIsolating] = useState(Boolean(isolate?.length));

  useEffect(() => {
    let cancelled = false;
    initViewerRuntime()
      .then(() => {
        if (cancelled || !container.current) return;
        const viewer = new Autodesk.Viewing.GuiViewer3D(container.current);
        viewerRef.current = viewer;
        if (viewer.start() > 0) {
          setError("Your browser could not start the 3D viewer (WebGL unavailable).");
          return;
        }
        viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, () => !cancelled && setLoaded(true), { once: true });
        Autodesk.Viewing.Document.load(
          `urn:${urn}`,
          (doc) => viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry()),
          (code, message) => setError(`Could not load model (${code}): ${message}`),
        );
      })
      .catch((e: Error) => setError(e.message));

    return () => {
      cancelled = true;
      viewerRef.current?.finish();
      viewerRef.current = null;
    };
  }, [urn]);

  // Isolate a group of elements and zoom to it.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!loaded || !viewer) return;
    if (isolating && isolate?.length) {
      viewer.isolate(isolate);
      viewer.fitToView(isolate);
    } else {
      viewer.isolate([]);
    }
  }, [loaded, isolating, isolate]);

  // Colour elements by mapping state.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!loaded || !viewer || !colors) return;
    const model = viewer.model;
    viewer.clearThemingColors(model);
    if (!colorOn) return;
    const THREE_ = (window as unknown as { THREE: typeof THREE }).THREE;
    for (const state of ["mapped", "unmapped", "missing"] as const) {
      const [r, g, b] = COLORS[state];
      const color = new THREE_.Vector4(r, g, b, 1);
      for (const id of colors[state]) viewer.setThemingColor(id, color, model);
    }
  }, [loaded, colorOn, colors]);

  return (
    <div className="relative min-h-[500px] w-full flex-1 overflow-hidden rounded-lg border">
      <div ref={container} className="absolute inset-0" />

      {loaded && (colors || isolate?.length) && (
        <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-2">
          {colors && (
            <Button size="sm" variant={colorOn ? "default" : "outline"} className={cn("shadow-sm", !colorOn && "bg-card")} onClick={() => setColorOn((v) => !v)}>
              <Palette /> Colour by mapping
            </Button>
          )}
          {colorOn && colors && (
            <div className="space-y-1 rounded-md bg-card/95 px-3 py-2 text-xs shadow-sm">
              {(
                [
                  ["mapped", `Mapped to ${terms.anItem}`],
                  ["unmapped", "Not mapped yet"],
                  ["missing", "No quantity in model"],
                ] as const
              ).map(([state, label]) => (
                <p key={state} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm" style={{ background: `rgb(${COLORS[state].map((c) => c * 255).join(",")})` }} />
                  {label} <span className="text-muted-foreground tabular-nums">({colors[state].length.toLocaleString()})</span>
                </p>
              ))}
            </div>
          )}
          {isolate?.length ? (
            <div className={cn("flex items-center gap-1 rounded-md bg-card/95 py-1 pr-1 pl-3 text-xs shadow-sm", !isolating && "opacity-80")}>
              {isolating ? `Showing ${isolateLabel ?? `${isolate.length} elements`}` : "Showing everything"}
              <Button variant="ghost" size="xs" onClick={() => setIsolating((v) => !v)}>
                {isolating ? <X /> : null}
                {isolating ? "Show all" : "Isolate again"}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-6 text-sm text-destructive">{error}</div>
      )}
    </div>
  );
}
