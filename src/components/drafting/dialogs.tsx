"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";
import type { Unused } from "@/lib/drafting/document";
import { MODEL } from "@/lib/drafting/document";
import type { DialogRequest, Editor, SaveAsRequest } from "@/lib/drafting/editor";
import { layoutSheet, modelSheet, sheetFacts, VIEWPORT_SCALES } from "@/lib/drafting/layouts";
import { FIELD_CODES, hasFields } from "@/lib/drafting/fields";
import { shownText } from "@/lib/drafting/graphics";
import { DEFAULT_PDF_IMPORT, type PdfImportSettings } from "@/lib/drafting/pdf-import";
import { plotPdf } from "@/lib/drafting/plot";
import { PAPER_SIZES, type Paper } from "@/lib/drafting/types";
import { downloadPdf, pictureLoader, publishToSheets } from "./plotting";

// The dialogs commands open, as AutoCAD's: Block Definition, Edit Attributes, the block
// editor's save question, Purge, Page Setup, Plot and Publish. Each passes its answer back to
// the editor.

type Of<K extends DialogRequest["kind"]> = Extract<DialogRequest, { kind: K }>;

/** What plotting and publishing need from the page: the drawing, and the projects to publish to. */
export type PlotContext = { drawingId: string; drawingName: string; projects: { id: string; name: string }[] };

export function DraftingDialog({ editor, request, context }: { editor: Editor; request: DialogRequest; context: PlotContext }) {
  const close = <T,>(result: T | null) => editor.closeDialog(result);
  const wide = request.kind === "plot" || request.kind === "publish" || request.kind === "page-setup" || request.kind === "pdf-import";
  return (
    <Dialog open onOpenChange={(open) => !open && close(null)}>
      <DialogContent className={wide ? "sm:max-w-lg" : "sm:max-w-md"} onKeyDown={(e) => e.stopPropagation()}>
        {request.kind === "block" && <BlockDefinition editor={editor} request={request} />}
        {request.kind === "attributes" && <EditAttributes editor={editor} request={request} />}
        {request.kind === "save-block" && <SaveBlock editor={editor} request={request} />}
        {request.kind === "purge" && <Purge editor={editor} />}
        {request.kind === "page-setup" && <PageSetup editor={editor} request={request} />}
        {request.kind === "plot" && <Plot editor={editor} context={context} />}
        {request.kind === "publish" && <Publish editor={editor} context={context} />}
        {request.kind === "pdf-import" && <ImportPdf editor={editor} request={request} />}
        {request.kind === "save-as" && <SaveAs editor={editor} request={request} />}
      </DialogContent>
    </Dialog>
  );
}

/** Save Drawing As: a name and a type (drawing, drawing template, DXF); a template also gets
 * the description AutoCAD's Template Options asks for. */
function SaveAs({ editor, request }: { editor: Editor; request: Of<"save-as"> }) {
  const [name, setName] = useState(`${request.name} copy`);
  const [type, setType] = useState<SaveAsRequest["type"]>("drawing");
  const [description, setDescription] = useState("");
  const trimmed = name.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed || type === "dxf") editor.closeDialog({ name: trimmed, type, description: description.trim() });
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>Save Drawing As</DialogTitle>
        <DialogDescription>
          {type === "template"
            ? "New drawings can start from a template: its layers, styles, layouts, title block, notes and details come along."
            : type === "dxf"
              ? "Downloads the drawing as a DXF for AutoCAD and other CAD programs."
              : "A copy under a new name, which opens for you to go on working in."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="save-as-type">Files of type</Label>
        <select id="save-as-type" value={type} onChange={(e) => setType(e.target.value as SaveAsRequest["type"])} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="drawing">Drawing</option>
          <option value="template">Drawing Template</option>
          <option value="dxf">DXF (download)</option>
        </select>
      </div>
      {type !== "dxf" && (
        <div className="grid gap-1.5">
          <Label htmlFor="save-as-name">{type === "template" ? "Template name" : "Name"}</Label>
          <Input id="save-as-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={200} />
        </div>
      )}
      {type === "template" && (
        <div className="grid gap-1.5">
          <Label htmlFor="save-as-description">Description</Label>
          <Input id="save-as-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="e.g. 11x17 sheet with title block and general notes" />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => editor.closeDialog(null)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed && type !== "dxf"}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** AutoCAD's Import PDF dialog: the page, what to bring in, the layers, and where it goes. */
function ImportPdf({ editor, request }: { editor: Editor; request: Of<"pdf-import"> }) {
  const [s, setS] = useState<PdfImportSettings>({ ...DEFAULT_PDF_IMPORT, page: 1, onScreen: true, scale: 1, rotation: 0 });
  const set = <K extends keyof PdfImportSettings>(key: K, value: PdfImportSettings[K]) => setS((v) => ({ ...v, [key]: value }));
  const check = (key: "geometry" | "fills" | "text" | "images" | "recognizeText" | "join" | "lineweights", label: string, disabled = false) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={s[key]} disabled={disabled} onChange={(e) => set(key, e.target.checked)} />
      {label}
    </label>
  );
  const valid = s.page >= 1 && s.page <= request.pages && s.scale > 0 && Number.isFinite(s.rotation);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) editor.closeDialog(s);
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>Import PDF</DialogTitle>
        <DialogDescription>
          {request.file}: its lines, text, fills and pictures become objects you can edit. A scale of 1 keeps the page&apos;s paper size.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-3 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="pdf-page">Page (of {request.pages})</Label>
          <Input id="pdf-page" type="number" min={1} max={request.pages} value={s.page} onChange={(e) => set("page", Math.round(Number(e.target.value)))} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pdf-scale">Scale</Label>
          <Input id="pdf-scale" type="number" min={0} step="any" value={s.scale} onChange={(e) => set("scale", Number(e.target.value))} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pdf-rotation">Rotation (°)</Label>
          <Input id="pdf-rotation" type="number" step="any" value={s.rotation} onChange={(e) => set("rotation", Number(e.target.value))} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.onScreen} onChange={(e) => set("onScreen", e.target.checked)} />
        Specify insertion point on-screen (otherwise at 0,0)
      </label>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <fieldset className="grid gap-1">
          <legend className="mb-1 font-medium">PDF data to import</legend>
          {check("geometry", "Vector geometry")}
          {check("fills", "Solid fills")}
          {check("text", "Text")}
          {check("recognizeText", "Text drawn as lines (searchable PDFs)", !s.text)}
          {check("images", "Raster images")}
        </fieldset>
        <div className="grid content-start gap-4">
          <fieldset className="grid gap-1">
            <legend className="mb-1 font-medium">Layers</legend>
            {(
              [
                ["pdf", "Use PDF layers"],
                ["object", "Create object layers"],
                ["current", "Current layer"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="pdf-layers" checked={s.layers === value} onChange={() => set("layers", value)} />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="grid gap-1">
            <legend className="mb-1 font-medium">Import options</legend>
            {check("join", "Join line and arc segments")}
            {check("lineweights", "Apply lineweight properties")}
          </fieldset>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => editor.closeDialog(null)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid}>
          OK
        </Button>
      </DialogFooter>
    </form>
  );
}

function BlockDefinition({ editor, request }: { editor: Editor; request: Of<"block"> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"convert" | "retain" | "delete">("convert");
  const trimmed = name.trim();
  const exists = editor.doc.blocks.has(trimmed);
  const invalid = /[<>/\\":;?*|,=`]/.test(trimmed);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (trimmed && !invalid) editor.closeDialog({ name: trimmed, description: description.trim(), mode });
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Block Definition</DialogTitle>
        <DialogDescription>
          {request.count} object{request.count === 1 ? "" : "s"} selected, about the base point you picked.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="block-name">Name</Label>
        <Input id="block-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus list="block-names" placeholder="e.g. Door 36, North arrow" />
        <datalist id="block-names">
          {[...editor.doc.blocks.keys()].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {invalid && <p className="text-xs text-destructive">{"Names can't contain < > / \\ \" : ; ? * | , = `"}</p>}
        {exists && !invalid && <p className="text-xs text-amber-600 dark:text-amber-400">&quot;{trimmed}&quot; is already defined: it will be redefined, and every reference to it updated.</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="block-description">Description</Label>
        <Input id="block-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 text-sm font-medium">Objects</legend>
        {(
          [
            ["convert", "Convert to block"],
            ["retain", "Retain"],
            ["delete", "Delete"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="block-mode" checked={mode === value} onChange={() => setMode(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => editor.closeDialog(null)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed || invalid}>
          OK
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditAttributes({ editor, request }: { editor: Editor; request: Of<"attributes"> }) {
  const [values, setValues] = useState(() => Object.fromEntries(request.rows.map((r) => [r.tag, r.value])));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        editor.closeDialog(values);
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>Edit Attributes</DialogTitle>
        <DialogDescription>Block: {request.block}</DialogDescription>
      </DialogHeader>
      <div className="-mx-1 grid max-h-[60vh] gap-3 overflow-y-auto px-1">
        {request.rows.map((r, i) => (
          <div key={r.tag} className="grid gap-1.5">
            <Label htmlFor={`attr-${r.tag}`}>
              {r.prompt} <span className="font-mono text-xs text-muted-foreground">{r.tag}</span>
            </Label>
            <div className="flex gap-1.5">
              <Input id={`attr-${r.tag}`} value={values[r.tag]} autoFocus={i === 0} onChange={(e) => setValues((v) => ({ ...v, [r.tag]: e.target.value }))} />
              {/* AutoCAD's Insert Field: a value that fills itself in. */}
              <select
                aria-label={`Insert a field into ${r.prompt}`}
                title="Insert field"
                value=""
                onChange={(e) => {
                  const code = FIELD_CODES[e.target.value as keyof typeof FIELD_CODES];
                  if (code) setValues((v) => ({ ...v, [r.tag]: code }));
                }}
                className="h-8 w-24 shrink-0 rounded-lg border border-input bg-transparent px-1.5 text-xs text-muted-foreground"
              >
                <option value="">Field…</option>
                <option value="Filename">File name</option>
                <option value="PlotDate">Plot date</option>
                <option value="Date">Date</option>
                <option value="Layout">Layout name</option>
              </select>
            </div>
            {hasFields(values[r.tag] ?? "") && <p className="text-xs text-muted-foreground">Shows: {shownText(values[r.tag])}</p>}
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => editor.closeDialog(null)}>
          Cancel
        </Button>
        <Button type="submit">OK</Button>
      </DialogFooter>
    </form>
  );
}

function SaveBlock({ editor, request }: { editor: Editor; request: Of<"save-block"> }) {
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Block - Changes Not Saved</DialogTitle>
        <DialogDescription>You changed block &quot;{request.name}&quot;. What do you want to do?</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Button autoFocus onClick={() => editor.closeDialog("save")}>
          Save the changes to {request.name}
        </Button>
        <Button variant="outline" onClick={() => editor.closeDialog("discard")}>
          Discard the changes and close the block editor
        </Button>
      </div>
    </div>
  );
}

const PURGE_GROUPS: [keyof Unused, string][] = [
  ["blocks", "Blocks"],
  ["layers", "Layers"],
  ["textStyles", "Text styles"],
  ["dimStyles", "Dimension styles"],
];

function Purge({ editor }: { editor: Editor }) {
  const [unused, setUnused] = useState(() => editor.doc.unused());
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const total = PURGE_GROUPS.reduce((n, [key]) => n + unused[key].length, 0);
  const purge = (items: Partial<Unused>) => {
    editor.doc.begin("PURGE");
    editor.doc.purge(items);
    editor.doc.commit();
    setUnused(editor.doc.unused());
    setChecked(new Set());
  };
  const checkedItems = () => Object.fromEntries(PURGE_GROUPS.map(([key]) => [key, unused[key].filter((n) => checked.has(`${key}:${n}`))])) as Unused;
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Purge</DialogTitle>
        <DialogDescription>Unused named items, which nothing in the drawing refers to. Purging a block can leave more items unused.</DialogDescription>
      </DialogHeader>
      <div className="max-h-72 overflow-y-auto rounded border text-sm">
        {total === 0 ? (
          <p className="p-3 text-muted-foreground">Nothing to purge.</p>
        ) : (
          PURGE_GROUPS.filter(([key]) => unused[key].length).map(([key, label]) => (
            <div key={key}>
              <div className="bg-muted/50 px-2 py-1 text-xs font-semibold">
                {label} ({unused[key].length})
              </div>
              {unused[key].map((name) => {
                const id = `${key}:${name}`;
                return (
                  <label key={id} className="flex items-center gap-2 px-3 py-0.5">
                    <input
                      type="checkbox"
                      checked={checked.has(id)}
                      onChange={() =>
                        setChecked((s) => {
                          const next = new Set(s);
                          if (!next.delete(id)) next.add(id);
                          return next;
                        })
                      }
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          ))
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => editor.closeDialog(null)}>
          Close
        </Button>
        <Button variant="outline" disabled={!checked.size} onClick={() => purge(checkedItems())}>
          Purge Checked Items
        </Button>
        <Button disabled={!total} onClick={() => purge(unused)}>
          Purge All
        </Button>
      </DialogFooter>
    </div>
  );
}

// --- page setup, plot and publish -------------------------------------------------------------

const select = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Paper sizes listed, with a layout's own size if it isn't one of them (an imported one). */
function paperChoices(editor: Editor, current?: Paper) {
  const sizes = PAPER_SIZES[editor.drawing.units];
  const flat = (p: Paper) => ({ ...p, width: Math.max(p.width, p.height), height: Math.min(p.width, p.height) });
  return current && !sizes.some((p) => p.name === current.name) ? [flat(current), ...sizes] : sizes;
}

function PaperFields({ editor, paper, onChange }: { editor: Editor; paper: Paper; onChange: (p: Paper) => void }) {
  const choices = paperChoices(editor, paper);
  const landscape = paper.width >= paper.height;
  const orient = (p: Paper, land: boolean) => {
    const [a, b] = [Math.max(p.width, p.height), Math.min(p.width, p.height)];
    return { ...p, width: land ? a : b, height: land ? b : a };
  };
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="paper-size">Paper size</Label>
        <select id="paper-size" className={select} value={paper.name} onChange={(e) => onChange(orient(choices.find((p) => p.name === e.target.value)!, landscape))}>
          {choices.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </div>
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 text-sm font-medium">Orientation</legend>
        {(["Landscape", "Portrait"] as const).map((o) => (
          <label key={o} className="flex items-center gap-2">
            <input type="radio" checked={(o === "Landscape") === landscape} onChange={() => onChange(orient(paper, o === "Landscape"))} />
            {o}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function StyleFields({ monochrome, lineweights, onChange }: { monochrome: boolean; lineweights: boolean; onChange: (v: { monochrome: boolean; lineweights: boolean }) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="plot-style">Plot style table</Label>
        <select id="plot-style" className={select} value={monochrome ? "mono" : "color"} onChange={(e) => onChange({ monochrome: e.target.value === "mono", lineweights })}>
          <option value="mono">monochrome.ctb (black)</option>
          <option value="color">None (in colour)</option>
        </select>
      </div>
      <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
        <input type="checkbox" checked={lineweights} onChange={(e) => onChange({ monochrome, lineweights: e.target.checked })} />
        Plot object lineweights
      </label>
    </div>
  );
}

/** PAGESETUP: a layout's paper and how it plots. */
function PageSetup({ editor, request }: { editor: Editor; request: Of<"page-setup"> }) {
  const main = editor.drawing;
  const layout = main.layouts.get(request.layout)!;
  const [paper, setPaper] = useState(layout.paper);
  const [plot, setPlot] = useState(layout.plot);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        main.begin("PAGESETUP");
        main.updateLayout({ ...layout, paper, plot });
        main.commit();
        editor.closeDialog(null);
      }}
    >
      <DialogHeader>
        <DialogTitle>Page Setup - {layout.name}</DialogTitle>
        <DialogDescription>Plotter: DWG To PDF. The layout&apos;s paper is drawn 1:1; viewports and the title block stay where they are.</DialogDescription>
      </DialogHeader>
      <PaperFields editor={editor} paper={paper} onChange={setPaper} />
      <StyleFields {...plot} onChange={setPlot} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => editor.closeDialog(null)}>
          Cancel
        </Button>
        <Button type="submit">OK</Button>
      </DialogFooter>
    </form>
  );
}

/** PLOT: the layout on screen, or the model at a scale, to a PDF (DWG To PDF). */
function Plot({ editor, context }: { editor: Editor; context: PlotContext }) {
  const main = editor.drawing;
  const layout = editor.layoutId ? main.layouts.get(editor.layoutId) : null;
  const units = main.units;
  const [paper, setPaper] = useState<Paper>(layout?.paper ?? PAPER_SIZES[units][units === "mm" ? 3 : 8]);
  const [plot, setPlot] = useState(layout?.plot ?? { monochrome: true, lineweights: true });
  const [area, setArea] = useState<"extents" | "display">("extents");
  const [scale, setScale] = useState<string>("fit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      let sheet;
      if (layout) {
        sheet = { ...layoutSheet(main, layout.id), plot };
      } else {
        const box =
          area === "display"
            ? (() => {
                const a = editor.toWorld({ x: 0, y: editor.size.h });
                const b = editor.toWorld({ x: editor.size.w, y: 0 });
                return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
              })()
            : main.extents(true, MODEL);
        if (!Number.isFinite(box.minX)) throw new Error("There's nothing to plot yet.");
        sheet = modelSheet(main, { paper, plot, area: box, scale: scale === "fit" ? "fit" : Number(scale) });
      }
      const bytes = await plotPdf(main, [sheet], { title: context.drawingName, loadPicture: pictureLoader(context.drawingId) });
      downloadPdf(bytes, `${context.drawingName} - ${layout?.name ?? "Model"}`);
      editor.print(`Plotted ${layout ? `layout "${layout.name}"` : "the model"} to PDF.`, "info");
      editor.closeDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not plot");
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Plot - {layout?.name ?? "Model"}</DialogTitle>
        <DialogDescription>Printer/plotter: DWG To PDF. The PDF is vector: lines, text and fills stay sharp at any zoom.</DialogDescription>
      </DialogHeader>
      {layout ? (
        <p className="text-sm">
          Paper: <span className="font-medium">{layout.paper.name}</span> ({layout.paper.width >= layout.paper.height ? "landscape" : "portrait"}), plotted 1:1.{" "}
          <button type="button" className="text-primary hover:underline" onClick={() => editor.openDialog({ kind: "page-setup", layout: layout.id, done: () => {} })}>
            Page Setup…
          </button>
        </p>
      ) : (
        <>
          <PaperFields editor={editor} paper={paper} onChange={setPaper} />
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="plot-area">What to plot</Label>
              <select id="plot-area" className={select} value={area} onChange={(e) => setArea(e.target.value as "extents" | "display")}>
                <option value="extents">Extents</option>
                <option value="display">Display</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plot-scale">Plot scale</Label>
              <select id="plot-scale" className={select} value={scale} onChange={(e) => setScale(e.target.value)}>
                <option value="fit">Fit to paper</option>
                {VIEWPORT_SCALES[units].map(([label, k]) => (
                  <option key={label} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
      <StyleFields {...plot} onChange={setPlot} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => editor.closeDialog(null)}>
          Cancel
        </Button>
        <Button onClick={() => void run()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {busy ? "Plotting…" : "Plot"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** PUBLISH: layouts as one multi-sheet PDF, or straight into a project's Sheets. */
function Publish({ editor, context }: { editor: Editor; context: PlotContext }) {
  const main = editor.drawing;
  const layouts = [...main.layouts.values()];
  const [chosen, setChosen] = useState(() => new Set(layouts.map((l) => l.id)));
  const [target, setTarget] = useState<"sheets" | "pdf">(context.projects.length ? "sheets" : "pdf");
  const [projectId, setProjectId] = useState(context.projects[0]?.id ?? "");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ projectId: string; count: number } | null>(null);

  if (!layouts.length)
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Publish</DialogTitle>
          <DialogDescription>Publishing plots layouts, and this drawing has none yet. A layout is a sheet: a title block and viewports onto the model.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => editor.closeDialog(null)}>
            Close
          </Button>
          <Button
            onClick={() => {
              editor.closeDialog(null);
              editor.newLayout();
            }}
          >
            New Layout
          </Button>
        </DialogFooter>
      </div>
    );

  if (done)
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Published</DialogTitle>
          <DialogDescription>
            {done.count} sheet{done.count === 1 ? "" : "s"} added to {context.projects.find((p) => p.id === done.projectId)?.name}, numbered and to scale: measuring works without calibrating.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => editor.closeDialog(null)}>
            Close
          </Button>
          <LinkButton href={`/projects/${done.projectId}/sheets`} target="_blank">
            Open Sheets
          </LinkButton>
        </DialogFooter>
      </div>
    );

  const run = async () => {
    const ids = layouts.filter((l) => chosen.has(l.id)).map((l) => l.id);
    if (!ids.length) return;
    setError(null);
    try {
      setProgress("Plotting…");
      const bytes = await plotPdf(main, ids.map((id) => layoutSheet(main, id)), { title: context.drawingName, loadPicture: pictureLoader(context.drawingId) });
      if (target === "pdf") {
        downloadPdf(bytes, context.drawingName);
        editor.print(`Published ${ids.length} layout${ids.length === 1 ? "" : "s"} to PDF.`, "info");
        return editor.closeDialog(null);
      }
      const pages = ids.map((id) => {
        const { width, height, number, title, metersPerPoint, scaleLabel } = sheetFacts(main, id);
        return { width, height, number, title, metersPerPoint, scaleLabel };
      });
      await publishToSheets(projectId, context.drawingName, bytes, pages, (p) => setProgress(`Uploading ${p}%`));
      editor.print(`Published ${ids.length} sheet${ids.length === 1 ? "" : "s"} to ${context.projects.find((p) => p.id === projectId)?.name}.`, "info");
      setDone({ projectId, count: ids.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Publish</DialogTitle>
        <DialogDescription>Each layout is a sheet, numbered from its title block (or its name) and scaled from its main viewport.</DialogDescription>
      </DialogHeader>
      <div className="max-h-56 overflow-y-auto rounded border text-sm">
        <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 bg-muted/50 px-2 py-1 text-xs font-semibold">
          <input
            type="checkbox"
            aria-label="All"
            checked={chosen.size === layouts.length}
            onChange={(e) => setChosen(new Set(e.target.checked ? layouts.map((l) => l.id) : []))}
          />
          <span>Sheet</span>
          <span>Number</span>
          <span>Scale</span>
        </div>
        {layouts.map((l) => {
          const facts = sheetFacts(main, l.id);
          return (
            <label key={l.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 px-2 py-1">
              <input
                type="checkbox"
                checked={chosen.has(l.id)}
                onChange={() =>
                  setChosen((s) => {
                    const next = new Set(s);
                    if (!next.delete(l.id)) next.add(l.id);
                    return next;
                  })
                }
              />
              <span className="truncate">
                {facts.title ?? l.name} <span className="text-xs text-muted-foreground">({l.paper.name.split(" (")[0]})</span>
              </span>
              <span className="font-mono text-xs">{facts.number ?? "–"}</span>
              <span className="text-xs text-muted-foreground">{facts.scaleLabel ?? "–"}</span>
            </label>
          );
        })}
      </div>
      <fieldset className="grid gap-2 text-sm">
        <legend className="mb-1 text-sm font-medium">Publish to</legend>
        <label className="flex items-center gap-2">
          <input type="radio" checked={target === "sheets"} disabled={!context.projects.length} onChange={() => setTarget("sheets")} />
          Sheets in project
          <select className="h-7 min-w-0 flex-1 rounded border bg-transparent px-2 text-sm" value={projectId} disabled={target !== "sheets"} onChange={(e) => setProjectId(e.target.value)}>
            {context.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!context.projects.length && <p className="pl-6 text-xs text-muted-foreground">Create a project to publish sheets into it.</p>}
        <label className="flex items-center gap-2">
          <input type="radio" checked={target === "pdf"} onChange={() => setTarget("pdf")} />
          A multi-sheet PDF file
        </label>
      </fieldset>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => editor.closeDialog(null)}>
          Cancel
        </Button>
        <Button onClick={() => void run()} disabled={!!progress || !chosen.size || (target === "sheets" && !projectId)}>
          {progress && <Loader2 className="animate-spin" />}
          {progress ?? `Publish ${chosen.size} sheet${chosen.size === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </div>
  );
}
