"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Box, ClipboardList, Download, Info, ListTree, Loader2, Maximize, Maximize2, Minimize, Ruler, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteIfcModel } from "@/app/actions/models3d";
import type { ModelCanvasHandle, TreeNode } from "@/components/models/model-canvas";
import { OrientationCube } from "@/components/models/orientation-cube";
import { FloatingPanel, ModelBrowser, PropertiesPanel, Rows, Section } from "@/components/models/viewer-panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import type { ElementDetails, Row } from "@/lib/ifc/element-properties";
import { cn } from "@/lib/utils";

// A model built from drawings, in 3D: a header with the model's actions, the model filling
// the page, and floating tools over it (view cube, toolbar, browser, properties, details).

const ModelCanvas = dynamic(() => import("@/components/models/model-canvas"), { ssr: false });

export type ModelSummary = {
  elements: number;
  totalVolumeM3: number;
  units: string;
  byType: { type: string; count: number; volumeM3: number | null }[];
  rooms: { id: string; number: string | null; name: string; area: number; areaM2: number }[];
  totalRoomAreaM2: number;
  byMaterial: { material: string; count: number; volumeM3: number }[];
  extents: { size: number[] } | null;
  warnings: string[];
};

type LeftPanel = "browser" | "details" | null;

const num = (n: number, digits = 1) => n.toLocaleString("en-US", { maximumFractionDigits: digits });
const label = (type: string) => type.replace(/^Ifc/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Metres as the model's own units would read them. */
function distance(m: number, units: string) {
  if (units === "ft" || units === "in") {
    const inches = Math.round(m / 0.0254);
    return `${Math.floor(inches / 12)}′ ${inches % 12}″ (${num(m, 3)} m)`;
  }
  return units === "mm" ? `${num(m * 1000, 0)} mm` : `${num(m, 3)} m`;
}

export function IfcViewer({
  projectId,
  model,
  summary,
}: {
  projectId: string;
  model: { id: string; name: string; description: string | null; revision: number; updated: string; detailed?: boolean; cached: boolean };
  summary: ModelSummary;
}) {
  const router = useRouter();
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<ModelCanvasHandle>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [left, setLeft] = useState<LeftPanel>("details");
  const [showProps, setShowProps] = useState(false);
  const [selected, setSelected] = useState<{ id: number | null; details: ElementDetails | null }>({ id: null, details: null });
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [tool, setTool] = useState<"select" | "measure">("select");
  const [measured, setMeasured] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const ready = tree !== null;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.fullscreenElement) return;
      if (tool === "measure") {
        canvas.current?.clearMeasure();
        setTool("select");
      } else canvas.current?.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);

  const updateHidden = (next: Set<number>) => {
    setHidden(next);
    canvas.current?.setHidden([...next]);
  };

  const toggleMeasure = () => {
    if (tool === "measure") canvas.current?.clearMeasure();
    setTool(tool === "measure" ? "select" : "measure");
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${model.name}" and its revisions?`)) return;
    try {
      await deleteIfcModel(model.id);
      router.push(`/projects/${projectId}/models`);
    } catch {
      toast.error("Could not delete the model");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100svh-3.5rem)] lg:flex-none">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <LinkButton href={`/projects/${projectId}/models`} variant="ghost" size="icon-sm" aria-label="Back to models">
            <ArrowLeft />
          </LinkButton>
          <h1 className="truncate text-base font-semibold">{model.name}</h1>
          <Badge variant="outline">IFC</Badge>
          <Badge variant="secondary" title={`Updated ${model.updated}`}>
            r{model.revision}
          </Badge>
          {model.detailed && <Badge variant="info">Detailed</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <LinkButton href={`/api/ifc-models/${model.id}/ifc?download=1`} variant="outline" size="sm" prefetch={false}>
            <Download /> Download IFC
          </LinkButton>
          <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={remove} title="Delete model" aria-label="Delete model">
            <Trash2 />
          </Button>
        </div>
      </header>

      <div ref={frame} className="relative min-h-[70svh] flex-1 overflow-hidden bg-gradient-to-b from-muted/70 to-background lg:min-h-0">
        <ModelCanvas
          ref={canvas}
          modelId={model.id}
          revision={model.revision}
          cached={model.cached}
          tool={tool}
          onLoaded={(t) => {
            setTree(t);
            if (window.innerWidth < 640) setLeft(null); // panels would cover the model on a phone
          }}
          onProgress={setProgress}
          onError={setError}
          onSelect={(id, details) => {
            setSelected({ id, details });
            if (id !== null) setShowProps(true);
          }}
          onMeasure={setMeasured}
        />

        {!ready && !error && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <div className="space-y-3 text-center">
              <Loader2 className="mx-auto size-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading model… {progress > 0 && `${progress}%`}</p>
              <div className="mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <div className="max-w-sm space-y-2 px-4 text-center">
              <AlertCircle className="mx-auto size-8 text-destructive" />
              <p className="text-sm text-destructive">Could not show this model.</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        )}

        {ready && (
          <div className="absolute top-3 right-3 z-10 flex flex-col items-center gap-2">
            <OrientationCube onOrient={(d) => canvas.current?.orient(d)} onRotate={(deg) => canvas.current?.rotate(deg)} />
            <div className="flex flex-col gap-1 rounded-lg border bg-background/90 p-1 shadow-md backdrop-blur-sm">
              <Tool icon={ListTree} title="Model browser" active={left === "browser"} onClick={() => setLeft(left === "browser" ? null : "browser")} />
              <Tool icon={ClipboardList} title="Model details" active={left === "details"} onClick={() => setLeft(left === "details" ? null : "details")} />
              <Tool icon={Info} title="Properties" active={showProps} onClick={() => setShowProps(!showProps)} />
              <div className="my-0.5 h-px bg-border" />
              <Tool icon={Maximize2} title="Fit to view" onClick={() => canvas.current?.fit()} />
              <Tool icon={Ruler} title="Measure distance" active={tool === "measure"} onClick={toggleMeasure} />
              <div className="my-0.5 h-px bg-border" />
              <Tool
                icon={fullscreen ? Minimize : Maximize}
                title={fullscreen ? "Exit full screen" : "Full screen"}
                onClick={() => (fullscreen ? document.exitFullscreen() : frame.current?.requestFullscreen())}
              />
            </div>
          </div>
        )}

        {ready && left === "browser" && (
          <ModelBrowser
            tree={tree}
            hidden={hidden}
            selected={selected.id}
            onSelect={(id) => canvas.current?.select(id, true)}
            onToggle={(ids, show) => {
              const next = new Set(hidden);
              for (const id of ids) {
                if (show) next.delete(id);
                else next.add(id);
              }
              updateHidden(next);
            }}
            onShowAll={() => updateHidden(new Set())}
            onClose={() => setLeft(null)}
          />
        )}
        {ready && left === "details" && <ModelDetails model={model} summary={summary} onClose={() => setLeft(null)} />}
        {ready && showProps && <PropertiesPanel element={selected.details} onClose={() => setShowProps(false)} />}

        {ready && tool === "measure" && (
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-md bg-foreground/85 px-4 py-2 text-sm text-background shadow-lg">
            {measured === null ? (
              <span>Click two points to measure</span>
            ) : (
              <>
                <span className="font-mono">{distance(measured, summary.units)}</span>
                <button type="button" className="text-xs underline opacity-70 hover:opacity-100" onClick={() => canvas.current?.clearMeasure()}>
                  Clear
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Tool({ icon: Icon, title, active, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; active?: boolean; onClick: () => void }) {
  return (
    <Button variant={active ? "default" : "ghost"} size="icon" title={title} aria-label={title} aria-pressed={active} onClick={onClick}>
      <Icon className="size-4" />
    </Button>
  );
}

/** What the model holds, in collapsible sections: overview, elements by kind, rooms, materials, checks. */
function ModelDetails({ model, summary, onClose }: { model: { description: string | null; revision: number; updated: string; detailed?: boolean }; summary: ModelSummary; onClose: () => void }) {
  const size = summary.extents?.size.map((n) => num(n)).join(" × ");
  const overview: Row[] = [
    { label: "Revision", value: `${model.revision} · ${model.updated}` },
    { label: "Elements", value: num(summary.elements, 0) },
  ];
  if (summary.totalVolumeM3) overview.push({ label: "Total volume", value: `${num(summary.totalVolumeM3)} m³` });
  if (size) overview.push({ label: "Overall size", value: `${size} ${summary.units}` });
  if (summary.rooms.length) overview.push({ label: "Room area", value: `${num(summary.totalRoomAreaM2)} m²` });

  return (
    <FloatingPanel title="Model details" onClose={onClose} className="top-3 left-3 w-80 max-sm:right-3 max-sm:w-auto">
      <div className="space-y-3 p-3">
        {model.description && <p className="text-xs whitespace-pre-line text-muted-foreground">{model.description}</p>}
        <Section name="Overview" defaultOpen>
          <Rows rows={overview} />
        </Section>
        {summary.byType.length > 0 && (
          <Section name={model.detailed ? "IFC classes" : "Elements by kind"} count={summary.byType.length}>
            <Rows
              rows={summary.byType.map((t) => ({
                label: label(t.type),
                value: `${t.count}${t.volumeM3 ? ` · ${num(t.volumeM3)} m³` : ""}`,
              }))}
            />
          </Section>
        )}
        {summary.rooms.length > 0 && (
          <Section name="Rooms" count={summary.rooms.length}>
            <Rows
              rows={summary.rooms.map((r) => ({
                label: [r.number, r.name].filter(Boolean).join(" "),
                value: `${num(r.areaM2)} m²${summary.units === "ft" ? ` · ${Math.round(r.area)} sf` : ""}`,
              }))}
            />
          </Section>
        )}
        {summary.byMaterial.length > 0 && (
          <Section name="Materials" count={summary.byMaterial.length}>
            <Rows rows={summary.byMaterial.map((m) => ({ label: m.material, value: `${num(m.volumeM3, 2)} m³` }))} />
          </Section>
        )}
        {summary.warnings.length > 0 && (
          <Section name="Checks" count={<Badge variant="warning">{summary.warnings.length}</Badge>}>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {summary.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Section>
        )}
        <p className={cn("flex gap-1.5 border-t pt-2 text-[11px] leading-snug text-muted-foreground")}>
          <Box className="mt-0.5 size-3 shrink-0" />
          Built by an AI app from the drawings: check key dimensions before relying on it. Ask the app to change it, or undo a change from Connections.
        </p>
      </div>
    </FloatingPanel>
  );
}
