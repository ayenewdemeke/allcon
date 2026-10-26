"use client";

import { useState } from "react";
import {
  ArrowRightToLine,
  Bomb,
  BrushCleaning,
  Combine,
  Component,
  Copy,
  DoorOpen,
  Eraser,
  FileDown,
  FileText,
  Hand,
  Hexagon,
  ImagePlus,
  Layers,
  LayoutGrid,
  Lightbulb,
  LightbulbOff,
  Lock,
  Maximize,
  Moon,
  Move,
  PackagePlus,
  Paintbrush,
  RotateCw,
  Save,
  Scaling,
  Scissors,
  SlidersHorizontal,
  Snowflake,
  Spline,
  SquareDashed,
  SquareDashedMousePointer,
  SquarePen,
  Sun,
  Tag,
  Tags,
  Unlink,
  X,
} from "lucide-react";
import { HATCH_PATTERNS } from "@/lib/drafting/graphics";
import { hatchSettings } from "@/lib/drafting/commands-annotate";
import type { Editor, Snapshot } from "@/lib/drafting/editor";
import { cn } from "@/lib/utils";
import {
  ArcIcon,
  ChamferIcon,
  CircleIcon,
  DimLinearIcon,
  HatchIcon,
  LeaderIcon,
  PatternSwatch,
  ColorPicker,
  DropButton,
  EllipseIcon,
  FilletIcon,
  LineIcon,
  LineweightPicker,
  lineweightName,
  MirrorIcon,
  OffsetIcon,
  Popover,
  PolylineIcon,
  RayIcon,
  RectangleIcon,
  StretchIcon,
  Swatch,
  XlineIcon,
} from "./controls";

// The ribbon, laid out as AutoCAD's: tabs, then panels of tools with their names underneath.
// Tools run the same commands as the command line.

type Props = {
  editor: Editor;
  state: Snapshot;
  dark: boolean;
  onTheme: (dark: boolean) => void;
  palettes: { properties: boolean; layers: boolean; styles: boolean; blocks: boolean };
  onPalette: (p: "properties" | "layers" | "styles" | "blocks") => void;
  /** Back, Undo and Redo: AutoCAD's Quick Access Toolbar, before the tabs. */
  quickAccess: React.ReactNode;
  /** The save state, at the end of the tab row. */
  status: React.ReactNode;
};

/** Runs a command, optionally answering its first prompt with an option (Circle 2P, Arc Center…). */
function run(editor: Editor, name: string, option?: string) {
  editor.runCommand(name);
  if (option) editor.answer(option);
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col border-r px-1.5 last:border-r-0">
      <div className="flex flex-1 items-start gap-1 pt-1">{children}</div>
      <div className="pb-0.5 text-center text-[10px] text-muted-foreground">{title}</div>
    </div>
  );
}

function Big({ icon: Icon, label, title, onClick, active }: { icon: React.ComponentType<{ className?: string }>; label: string; title?: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={title ?? label}
      onClick={onClick}
      className={cn("flex w-14 flex-col items-center gap-0.5 rounded px-1 py-1 text-center text-[11px] leading-tight hover:bg-accent", active && "bg-accent")}
    >
      <Icon className="size-7 shrink-0" />
      <span className="line-clamp-2">{label}</span>
    </button>
  );
}

function Small({ icon: Icon, label, title, onClick, active }: { icon: React.ComponentType<{ className?: string }>; label: string; title?: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={title ?? label}
      onClick={onClick}
      className={cn("flex h-6 items-center gap-1.5 rounded px-1.5 text-[11px] hover:bg-accent", active && "bg-accent")}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

/** A small tool with a menu of related ones (Trim/Extend, Fillet/Chamfer, Array types). */
function SmallSplit({ icon, label, title, onClick, options }: { icon: React.ComponentType<{ className?: string }>; label: string; title: string; onClick: () => void; options: { label: string; run: () => void }[] }) {
  return (
    <div className="flex items-center">
      <Small icon={icon} label={label} title={title} onClick={onClick} />
      <Popover
        trigger={(_, toggle) => (
          <button type="button" onClick={toggle} className="h-6 rounded px-0.5 text-[10px] text-muted-foreground hover:bg-accent" aria-label={`${label} options`}>
            ▾
          </button>
        )}
      >
        {(close) => (
          <div className="w-40">
            {options.map((o) => (
              <button
                key={o.label}
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                onClick={() => {
                  close();
                  o.run();
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}

function Icon({ icon: I, title, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="flex size-6 items-center justify-center rounded hover:bg-accent">
      <I className="size-4" />
    </button>
  );
}

function SplitBig({ icon, label, title, onClick, options }: { icon: React.ComponentType<{ className?: string }>; label: string; title: string; onClick: () => void; options: { label: string; run: () => void }[] }) {
  return (
    <div className="flex flex-col items-center">
      <Big icon={icon} label={label} title={title} onClick={onClick} />
      <Popover
        trigger={(_, toggle) => (
          <button type="button" onClick={toggle} className="-mt-1 rounded px-2 text-[10px] leading-none text-muted-foreground hover:bg-accent" aria-label={`${label} options`}>
            ▾
          </button>
        )}
      >
        {(close) => (
          <div className="w-44">
            {options.map((o) => (
              <button
                key={o.label}
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                onClick={() => {
                  close();
                  o.run();
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}

const TABS = [
  ["home", "Home"],
  ["insert", "Insert"],
  ["annotate", "Annotate"],
  ["view", "View"],
  ["manage", "Manage"],
] as const;
type Tab = (typeof TABS)[number][0] | "block";

export function Ribbon({ editor, state, dark, onTheme, palettes, onPalette, quickAccess, status }: Props) {
  const [chosen, setTab] = useState<Tab>("home");
  // The Block Editor tab comes up when the block editor opens, as in AutoCAD.
  const [editing, setEditing] = useState(state.blockEdit);
  if (editing !== state.blockEdit) {
    setEditing(state.blockEdit);
    setTab(state.blockEdit ? "block" : "home");
  }
  const tab: Tab = chosen === "block" && !state.blockEdit ? "home" : chosen;
  // AutoCAD's contextual tab: Hatch Creation while HATCH runs.
  const hatching = state.command === "HATCH";
  const doc = editor.doc;
  const selected = editor.selected();
  // The property boxes show the selection's values (or *VARIES*), else what new objects get.
  const common = <T,>(get: (e: (typeof selected)[number]) => T, fallback: T): T | "varies" => {
    if (!selected.length) return fallback;
    const first = get(selected[0]);
    return selected.every((e) => get(e) === first) ? first : "varies";
  };
  const layerValue = common((e) => e.layer, state.currentLayer);
  const colorValue = common((e) => e.color, state.current.color);
  const lwValue = common((e) => e.lineweight, state.current.lineweight);
  const layer = typeof layerValue === "string" && layerValue !== "varies" ? doc.layers.get(layerValue) : undefined;

  return (
    <div className="border-b bg-muted/40">
      <div className="flex items-end gap-0.5 px-2 pt-1 text-xs">
        <div className="mr-2 flex items-center gap-0.5 self-center pb-0.5">{quickAccess}</div>
        {TABS.map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn("rounded-t px-3 py-1", tab === t && !hatching ? "bg-background font-medium text-foreground shadow-[0_-1px_0_0] shadow-border" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
        {state.blockEdit && (
          <button
            type="button"
            onClick={() => setTab("block")}
            className={cn("rounded-t px-3 py-1 text-primary", tab === "block" && !hatching ? "bg-background font-medium shadow-[0_-1px_0_0] shadow-border" : "hover:bg-background/60")}
          >
            Block Editor
          </button>
        )}
        {hatching && <span className="rounded-t bg-background px-3 py-1 font-medium text-primary shadow-[0_-1px_0_0] shadow-border">Hatch Creation</span>}
        <div className="ml-auto self-center pb-0.5">{status}</div>
      </div>
      <div className="flex h-[5.25rem] overflow-x-auto bg-background">
        {hatching ? (
          <HatchCreation editor={editor} />
        ) : tab === "block" ? (
          <BlockEditorTab editor={editor} state={state} />
        ) : tab === "insert" ? (
          <InsertTab editor={editor} onPalette={onPalette} palettes={palettes} />
        ) : tab === "manage" ? (
          <Panel title="Cleanup">
            <Big icon={BrushCleaning} label="Purge" title="Remove unused blocks, layers and styles (PU)" onClick={() => run(editor, "PURGE")} />
          </Panel>
        ) : tab === "annotate" ? (
          <AnnotateTab editor={editor} state={state} onPalette={onPalette} palettes={palettes} />
        ) : tab === "home" ? (
          <>
            <Panel title="Draw">
              <Big icon={LineIcon} label="Line" title="Line (L)" onClick={() => run(editor, "LINE")} />
              <Big icon={PolylineIcon} label="Polyline" title="Polyline (PL)" onClick={() => run(editor, "PLINE")} />
              <SplitBig
                icon={CircleIcon}
                label="Circle"
                title="Circle, center radius (C)"
                onClick={() => run(editor, "CIRCLE")}
                options={[
                  { label: "Center, Radius", run: () => run(editor, "CIRCLE") },
                  { label: "Center, Diameter", run: () => run(editor, "CIRCLE") },
                  { label: "2-Point", run: () => run(editor, "CIRCLE", "2P") },
                  { label: "3-Point", run: () => run(editor, "CIRCLE", "3P") },
                ]}
              />
              <SplitBig
                icon={ArcIcon}
                label="Arc"
                title="Arc, 3-point (A)"
                onClick={() => run(editor, "ARC")}
                options={[
                  { label: "3-Point", run: () => run(editor, "ARC") },
                  { label: "Center, Start, End", run: () => run(editor, "ARC", "C") },
                ]}
              />
              <div className="grid grid-cols-2 gap-x-0.5 pt-0.5">
                <Icon icon={RectangleIcon} title="Rectangle (REC)" onClick={() => run(editor, "RECTANG")} />
                <Icon icon={Hexagon} title="Polygon (POL)" onClick={() => run(editor, "POLYGON")} />
                <Icon icon={EllipseIcon} title="Ellipse (EL)" onClick={() => run(editor, "ELLIPSE")} />
                <Icon icon={Spline} title="Spline (SPL)" onClick={() => run(editor, "SPLINE")} />
                <Icon icon={XlineIcon} title="Construction line (XL)" onClick={() => run(editor, "XLINE")} />
                <Icon icon={RayIcon} title="Ray" onClick={() => run(editor, "RAY")} />
                <Icon icon={HatchIcon} title="Hatch (H)" onClick={() => run(editor, "HATCH")} />
              </div>
            </Panel>
            <Panel title="Modify">
              <div className="grid grid-cols-3 gap-x-1 gap-y-0.5">
                <Small icon={Move} label="Move" title="Move (M)" onClick={() => run(editor, "MOVE")} />
                <Small icon={RotateCw} label="Rotate" title="Rotate (RO)" onClick={() => run(editor, "ROTATE")} />
                <SmallSplit
                  icon={Scissors}
                  label="Trim"
                  title="Trim (TR)"
                  onClick={() => run(editor, "TRIM")}
                  options={[
                    { label: "Trim", run: () => run(editor, "TRIM") },
                    { label: "Extend", run: () => run(editor, "EXTEND") },
                  ]}
                />
                <Small icon={Copy} label="Copy" title="Copy (CO)" onClick={() => run(editor, "COPY")} />
                <Small icon={MirrorIcon} label="Mirror" title="Mirror (MI)" onClick={() => run(editor, "MIRROR")} />
                <SmallSplit
                  icon={FilletIcon}
                  label="Fillet"
                  title="Fillet (F)"
                  onClick={() => run(editor, "FILLET")}
                  options={[
                    { label: "Fillet", run: () => run(editor, "FILLET") },
                    { label: "Chamfer", run: () => run(editor, "CHAMFER") },
                  ]}
                />
                <Small icon={StretchIcon} label="Stretch" title="Stretch (S)" onClick={() => run(editor, "STRETCH")} />
                <Small icon={Scaling} label="Scale" title="Scale (SC)" onClick={() => run(editor, "SCALE")} />
                <SmallSplit
                  icon={LayoutGrid}
                  label="Array"
                  title="Rectangular array"
                  onClick={() => run(editor, "ARRAYRECT")}
                  options={[
                    { label: "Rectangular Array", run: () => run(editor, "ARRAYRECT") },
                    { label: "Polar Array", run: () => run(editor, "ARRAYPOLAR") },
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-0.5 pl-1">
                <Icon icon={Eraser} title="Erase (E)" onClick={() => run(editor, "ERASE")} />
                <Icon icon={Bomb} title="Explode (X)" onClick={() => run(editor, "EXPLODE")} />
                <Icon icon={OffsetIcon} title="Offset (O)" onClick={() => run(editor, "OFFSET")} />
                <Icon icon={Combine} title="Join (J)" onClick={() => run(editor, "JOIN")} />
                <Icon icon={Unlink} title="Break (BR)" onClick={() => run(editor, "BREAK")} />
                <Icon icon={ArrowRightToLine} title="Extend (EX)" onClick={() => run(editor, "EXTEND")} />
                <Icon icon={ChamferIcon} title="Chamfer (CHA)" onClick={() => run(editor, "CHAMFER")} />
              </div>
            </Panel>
            <Panel title="Annotation">
              <SplitBig
                icon={TextIcon}
                label="Text"
                title="Multiline text (MT)"
                onClick={() => run(editor, "MTEXT")}
                options={[
                  { label: "Multiline Text", run: () => run(editor, "MTEXT") },
                  { label: "Single Line", run: () => run(editor, "TEXT") },
                ]}
              />
              <SplitBig icon={DimLinearIcon} label="Dimension" title="Dimension (DIM)" onClick={() => run(editor, "DIM")} options={DIM_OPTIONS(editor)} />
              <Big icon={LeaderIcon} label="Leader" title="Multileader (MLD)" onClick={() => run(editor, "MLEADER")} />
            </Panel>
            <Panel title="Layers">
              <Big icon={Layers} label="Layer Properties" title="Layer Properties (LA)" onClick={() => onPalette("layers")} active={palettes.layers} />
              <div className="flex w-48 flex-col gap-1 pt-1">
                <Popover
                  trigger={(_, toggle) => (
                    <DropButton onClick={toggle} title="Layer of the selection, or the current layer" className="w-48">
                      {layer ? (
                        <>
                          {layer.on ? <Lightbulb className="size-3 text-amber-500" /> : <LightbulbOff className="size-3" />}
                          {layer.frozen && <Snowflake className="size-3 text-sky-500" />}
                          {layer.locked && <Lock className="size-3" />}
                          <Swatch color={layer.color} dark={dark} />
                          <span className="truncate">{layer.name}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">*VARIES*</span>
                      )}
                    </DropButton>
                  )}
                >
                  {(close) => (
                    <div className="max-h-72 w-56 overflow-y-auto">
                      {[...doc.layers.values()].map((l) => (
                        <button
                          key={l.name}
                          type="button"
                          className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted", l.name === layerValue && "bg-muted font-medium")}
                          onClick={() => {
                            close();
                            editor.setProperty({ layer: l.name });
                          }}
                        >
                          <Swatch color={l.color} dark={dark} />
                          <span className="flex-1 truncate">{l.name}</span>
                          {!l.on && <LightbulbOff className="size-3 opacity-60" />}
                          {l.locked && <Lock className="size-3 opacity-60" />}
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>
                <p className="truncate text-[10px] text-muted-foreground">{selected.length ? `${selected.length} selected` : `Current layer: ${state.currentLayer}`}</p>
              </div>
            </Panel>
            <Panel title="Block">
              <Big icon={PackagePlus} label="Insert" title="Insert a block (I)" onClick={() => onPalette("blocks")} active={palettes.blocks} />
              <div className="flex flex-col gap-0.5">
                <Small icon={Component} label="Create" title="Create a block (B)" onClick={() => run(editor, "BLOCK")} />
                <Small icon={SquarePen} label="Edit" title="Block editor (BE)" onClick={() => run(editor, "BEDIT")} />
                <Small icon={Tags} label="Edit Attributes" title="Edit attributes (EATTEDIT)" onClick={() => run(editor, "EATTEDIT")} />
              </div>
            </Panel>
            <Panel title="Properties">
              <Big icon={Paintbrush} label="Match Properties" title="Match properties (MA)" onClick={() => run(editor, "MATCHPROP")} />
              <div className="flex w-40 flex-col gap-1 pt-1">
                <Popover
                  trigger={(_, toggle) => (
                    <DropButton onClick={toggle} title="Color" className="w-40">
                      {colorValue === "varies" ? (
                        <span className="text-muted-foreground">*VARIES*</span>
                      ) : (
                        <>
                          <Swatch color={colorValue ?? layer?.color ?? 7} dark={dark} />
                          {colorValue === null ? "ByLayer" : typeof colorValue === "number" ? `Color ${colorValue}` : colorValue}
                        </>
                      )}
                    </DropButton>
                  )}
                >
                  {(close) => (
                    <ColorPicker
                      value={colorValue === "varies" ? -1 : colorValue}
                      dark={dark}
                      onChange={(c) => {
                        close();
                        editor.setProperty({ color: c });
                      }}
                    />
                  )}
                </Popover>
                <Popover
                  trigger={(_, toggle) => (
                    <DropButton onClick={toggle} title="Lineweight" className="w-40">
                      {lwValue === "varies" ? <span className="text-muted-foreground">*VARIES*</span> : lineweightName(lwValue)}
                    </DropButton>
                  )}
                >
                  {(close) => (
                    <LineweightPicker
                      value={lwValue === "varies" ? -99 : lwValue}
                      onChange={(lw) => {
                        close();
                        editor.setProperty({ lineweight: lw });
                      }}
                    />
                  )}
                </Popover>
              </div>
              <Big icon={SlidersHorizontal} label="Properties" title="Properties (Ctrl+1)" onClick={() => onPalette("properties")} active={palettes.properties} />
            </Panel>
            <Panel title="Utilities">
              <div className="flex flex-col gap-0.5">
                <Small icon={SquareDashedMousePointer} label="Select All" title="Select all (Ctrl+A)" onClick={() => editor.selectAll()} />
              </div>
            </Panel>
          </>
        ) : (
          <>
            <Panel title="Navigate">
              <Big icon={Maximize} label="Extents" title="Zoom extents (Z, E)" onClick={() => editor.zoomExtents()} />
              <Big icon={SquareDashed} label="Window" title="Zoom window (Z, W)" onClick={() => run(editor, "ZOOM", "W")} />
              <Big icon={Hand} label="Pan" title="Pan (P)" onClick={() => run(editor, "PAN")} />
            </Panel>
            <Panel title="Palettes">
              <Big icon={SlidersHorizontal} label="Properties" title="Properties (Ctrl+1)" onClick={() => onPalette("properties")} active={palettes.properties} />
              <Big icon={Layers} label="Layers" title="Layer Properties (LA)" onClick={() => onPalette("layers")} active={palettes.layers} />
              <Big icon={PackagePlus} label="Blocks" title="Blocks palette" onClick={() => onPalette("blocks")} active={palettes.blocks} />
            </Panel>
            <Panel title="Theme">
              <Big icon={Sun} label="Light" title="Light theme" onClick={() => onTheme(false)} active={!dark} />
              <Big icon={Moon} label="Dark" title="Dark theme" onClick={() => onTheme(true)} active={dark} />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function TextIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </svg>
  );
}

const DIM_OPTIONS = (editor: Editor) => [
  { label: "Dimension (smart)", run: () => run(editor, "DIM") },
  { label: "Linear", run: () => run(editor, "DIMLINEAR") },
  { label: "Aligned", run: () => run(editor, "DIMALIGNED") },
  { label: "Angular", run: () => run(editor, "DIMANGULAR") },
  { label: "Radius", run: () => run(editor, "DIMRADIUS") },
  { label: "Diameter", run: () => run(editor, "DIMDIAMETER") },
  { label: "Continue", run: () => run(editor, "DIMCONTINUE") },
  { label: "Baseline", run: () => run(editor, "DIMBASELINE") },
];

function AnnotateTab({ editor, state, onPalette, palettes }: { editor: Editor; state: Snapshot; onPalette: (p: "styles") => void; palettes: { styles: boolean } }) {
  void state;
  const doc = editor.doc;
  const select = "h-6 w-36 rounded border bg-background px-1 text-xs";
  return (
    <>
      <Panel title="Text">
        <Big icon={TextIcon} label="Multiline Text" title="Multiline text (MT)" onClick={() => run(editor, "MTEXT")} />
        <div className="flex flex-col gap-1 pt-1">
          <Small icon={TextIcon} label="Single Line" title="Single-line text (DT)" onClick={() => run(editor, "TEXT")} />
          <select className={select} value={doc.currentTextStyle} onChange={(e) => doc.setSetting("currentTextStyle", e.target.value)} title="Text style">
            {[...doc.textStyles.keys()].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
      </Panel>
      <Panel title="Dimensions">
        <SplitBig icon={DimLinearIcon} label="Dimension" title="Dimension (DIM)" onClick={() => run(editor, "DIM")} options={DIM_OPTIONS(editor)} />
        <div className="flex flex-col gap-0.5">
          <Small icon={DimLinearIcon} label="Linear" title="Linear (DLI)" onClick={() => run(editor, "DIMLINEAR")} />
          <Small icon={DimLinearIcon} label="Continue" title="Continue (DCO)" onClick={() => run(editor, "DIMCONTINUE")} />
          <Small icon={DimLinearIcon} label="Baseline" title="Baseline (DBA)" onClick={() => run(editor, "DIMBASELINE")} />
        </div>
        <div className="flex flex-col gap-1 pt-1">
          <select className={select} value={doc.currentDimStyle} onChange={(e) => doc.setSetting("currentDimStyle", e.target.value)} title="Dimension style">
            {[...doc.dimStyles.keys()].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
      </Panel>
      <Panel title="Leaders">
        <Big icon={LeaderIcon} label="Multileader" title="Multileader (MLD)" onClick={() => run(editor, "MLEADER")} />
      </Panel>
      <Panel title="Styles">
        <Big icon={SlidersHorizontal} label="Styles Manager" title="Text and dimension styles (ST, D)" onClick={() => onPalette("styles")} active={palettes.styles} />
      </Panel>
    </>
  );
}

function InsertTab({ editor, onPalette, palettes }: { editor: Editor; onPalette: (p: "blocks") => void; palettes: { blocks: boolean } }) {
  return (
    <>
      <Panel title="Block">
        <Big icon={PackagePlus} label="Insert" title="Insert a block (I)" onClick={() => onPalette("blocks")} active={palettes.blocks} />
        <Big icon={Tags} label="Edit Attribute" title="Edit attributes (EATTEDIT)" onClick={() => run(editor, "EATTEDIT")} />
      </Panel>
      <Panel title="Block Definition">
        <Big icon={Component} label="Create Block" title="Create a block (B)" onClick={() => run(editor, "BLOCK")} />
        <Big icon={Tag} label="Define Attributes" title="Define an attribute (ATT)" onClick={() => run(editor, "ATTDEF")} />
        <Big icon={SquarePen} label="Block Editor" title="Edit a block (BE)" onClick={() => run(editor, "BEDIT")} />
      </Panel>
      <Panel title="Reference">
        <Big icon={ImagePlus} label="Attach Image" title="Attach a picture under the drawing (IAT)" onClick={() => run(editor, "IMAGEATTACH")} />
        <Big icon={FileText} label="Attach PDF" title="Attach a PDF page under the drawing" onClick={() => run(editor, "PDFATTACH")} />
      </Panel>
      <Panel title="Export">
        <Big icon={FileDown} label="Export DXF" title="Download as DXF for AutoCAD and other CAD programs (DXFOUT)" onClick={() => run(editor, "DXFOUT")} />
      </Panel>
    </>
  );
}

function BlockEditorTab({ editor, state }: { editor: Editor; state: Snapshot }) {
  return (
    <>
      <Panel title="Open/Save">
        <Big icon={Save} label="Save Block" title={`Save ${state.blockEdit} (BSAVE)`} onClick={() => run(editor, "BSAVE")} />
      </Panel>
      <Panel title="Block Definition">
        <Big icon={Tag} label="Define Attribute" title="Define an attribute (ATT)" onClick={() => run(editor, "ATTDEF")} />
        <Big icon={PackagePlus} label="Insert Block" title="Insert a block (-INSERT)" onClick={() => run(editor, "-INSERT")} />
      </Panel>
      <Panel title="Close">
        <Big icon={DoorOpen} label="Close Block Editor" title="Close the block editor (BCLOSE)" onClick={() => editor.requestCloseBlockEditor()} />
      </Panel>
    </>
  );
}

function HatchCreation({ editor }: { editor: Editor }) {
  const s = hatchSettings(editor);
  const set = (key: "hatchPattern" | "hatchScale" | "hatchAngle", value: string | number) => {
    editor.remember(key, value);
    const command = editor.command as unknown as { restyle?: () => void } | null;
    command?.restyle?.();
  };
  const input = "h-6 w-20 rounded border bg-background px-1 text-xs";
  return (
    <>
      <Panel title="Boundaries">
        <Big icon={HatchIcon} label="Pick Points" title="Pick internal points" onClick={() => undefined} active />
        <Small icon={SquareDashedMousePointer} label="Select" title="Select boundary objects" onClick={() => editor.answer("S")} />
      </Panel>
      <Panel title="Pattern">
        <div className="grid grid-cols-5 gap-1 pt-0.5">
          {Object.entries(HATCH_PATTERNS).map(([name, p]) => (
            <button
              key={name}
              type="button"
              title={`${name}: ${p.description}`}
              onClick={() => set("hatchPattern", name)}
              className={cn("rounded border p-0.5 hover:border-primary", s.pattern === name && "border-primary ring-1 ring-primary")}
            >
              <PatternSwatch name={name} className="size-6" />
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Properties">
        <div className="grid grid-cols-[auto_auto] items-center gap-x-2 gap-y-1 pt-1 text-[11px]">
          <span className="text-muted-foreground">Scale</span>
          <input className={input} type="number" min={0} step="any" defaultValue={s.scale} key={`s${s.scale}`} onBlur={(e) => Number(e.target.value) > 0 && set("hatchScale", Number(e.target.value))} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          <span className="text-muted-foreground">Angle</span>
          <input className={input} type="number" step="any" defaultValue={s.angle} key={`a${s.angle}`} onBlur={(e) => set("hatchAngle", Number(e.target.value) || 0)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        </div>
      </Panel>
      <Panel title="Close">
        <Big icon={X} label="Close Hatch Creation" title="Done (Enter)" onClick={() => editor.submit()} />
      </Panel>
    </>
  );
}
