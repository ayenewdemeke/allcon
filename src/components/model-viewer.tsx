"use client";

import { useEffect, useRef, useState } from "react";
import { initViewerRuntime } from "@/lib/aps/viewer-runtime";

export function ModelViewer({ urn }: { urn: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let viewer: Autodesk.Viewing.GuiViewer3D | undefined;
    let cancelled = false;

    initViewerRuntime()
      .then(() => {
        if (cancelled || !container.current) return;
        viewer = new Autodesk.Viewing.GuiViewer3D(container.current);
        if (viewer.start() > 0) {
          setError("Your browser could not start the 3D viewer (WebGL unavailable).");
          return;
        }
        Autodesk.Viewing.Document.load(
          `urn:${urn}`,
          (doc) => viewer?.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry()),
          (code, message) => setError(`Could not load model (${code}): ${message}`),
        );
      })
      .catch((e: Error) => setError(e.message));

    return () => {
      cancelled = true;
      viewer?.finish();
    };
  }, [urn]);

  return (
    <div className="relative min-h-[500px] w-full flex-1 overflow-hidden rounded-lg border">
      <div ref={container} className="absolute inset-0" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-6 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
