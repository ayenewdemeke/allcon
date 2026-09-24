"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { getDrawingDocument } from "@/lib/pdf/client";

const THUMB_WIDTH = 320; // device pixels; cards display at ~160-240 CSS px

// Render thumbnails two at a time so a long set doesn't flood the browser.
let running = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(task: () => Promise<T>) {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Renders a page preview once the card scrolls into view. */
export function SheetThumbnail({
  drawingSetId,
  pageIndex,
  width,
  height,
}: {
  drawingSetId: string;
  pageIndex: number;
  width: number;
  height: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"idle" | "done" | "error">("idle");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        void withSlot(async () => {
          if (cancelled) return;
          const doc = await getDrawingDocument(drawingSetId);
          const page = await doc.getPage(pageIndex + 1);
          const viewport = page.getViewport({ scale: THUMB_WIDTH / page.getViewport({ scale: 1 }).width });
          const c = canvas.current;
          if (cancelled || !c) return;
          c.width = Math.round(viewport.width);
          c.height = Math.round(viewport.height);
          await page.render({ canvas: c, viewport }).promise;
          page.cleanup();
          if (!cancelled) setState("done");
        }).catch(() => !cancelled && setState("error"));
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [drawingSetId, pageIndex]);

  return (
    <div
      ref={box}
      className="relative flex w-full items-center justify-center overflow-hidden bg-white"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <canvas ref={canvas} className="h-full w-full object-contain" />
      {state !== "done" && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40 text-muted-foreground">
          <FileText className={state === "idle" ? "size-6 animate-pulse" : "size-6"} />
        </div>
      )}
    </div>
  );
}
