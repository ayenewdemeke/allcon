"use client";

import { useState } from "react";
import { Check, Lightbulb, LightbulbOff, Lock, LockOpen, Plus, Snowflake, Sun, Trash, X } from "lucide-react";
import { colorName } from "@/lib/drafting/aci";
import type { Editor, Snapshot } from "@/lib/drafting/editor";
import { angleOf, arcEnd, arcStart, dist, isFullEllipse, len as magnitude, sweepOf, TAU, tessellate } from "@/lib/drafting/geometry";
import { formatAngle, formatLength, parseAngle, parseLength, trimNumber } from "@/lib/drafting/units";
import { dimMeasurement, dimText, HATCH_PATTERNS, TEXT_FONTS } from "@/lib/drafting/graphics";
import { ENTITY_NAMES, newLayer, type DimStyle, type Entity, type EntityType, type HAlign, type Layer, type TextStyle, type Units, type VAlign } from "@/lib/drafting/types";
import { cn } from "@/lib/utils";
import { ColorPicker, LineweightPicker, lineweightName, Popover, Swatch } from "./controls";

// The Properties palette (Ctrl+1) and the Layer Properties Manager (LA), docked on the right as
// in AutoCAD.

export function PaletteFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b last:border-b-0">
      <header className="flex h-7 shrink-0 items-center justify-between border-b bg-muted/50 px-2 text-[11px] font-semibold tracking-wide uppercase">
        {title}
        <button type="button" onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Close ${title}`}>
          <X className="size-3.5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="bg-muted/40 px-2 py-0.5 text-[11px] font-semibold">{title}</div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center text-[11px]">
      <span className="truncate border-r px-2 py-1 text-muted-foreground">{label}</span>
      <div className="min-w-0 px-1 py-0.5">{children}</div>
    </div>
  );
}

/** A value typed in and applied on Enter or leaving the field (bad input goes back). Keyed by its value, so a change elsewhere resets it. */
function Field({ value, parse, onCommit }: { value: string; parse: (text: string) => number | null; onCommit: (n: number) => void }) {
  const [text, setText] = useState(value);
  const commit = () => {
    const n = parse(text);
    if (n === null || text === value) setText(value);
    else onCommit(n);
  };
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setText(value);
      }}
      className="h-5 w-full rounded-sm bg-transparent px-1 font-mono text-[11px] outline-none hover:bg-muted focus:bg-background focus:ring-1 focus:ring-primary"
    />
  );
}

/** Text typed in and applied on Enter (Ctrl+Enter when multiline) or leaving the field. */
function TextField({ value, onCommit, multiline = false, placeholder }: { value: string; onCommit: (text: string) => void; multiline?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value);
  const commit = () => text !== value && onCommit(text);
  const className = "w-full rounded-sm bg-transparent px-1 text-[11px] outline-none hover:bg-muted focus:bg-background focus:ring-1 focus:ring-primary";
  return multiline ? (
    <textarea value={text} rows={3} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && commit()} className={`${className} resize-y py-0.5`} />
  ) : (
    <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className={`${className} h-5`} />
  );
}

const Static = ({ children }: { children: React.ReactNode }) => <span className="block truncate px-1 font-mono text-muted-foreground">{children}</span>;

function area(a: number, units: Units) {
  return units === "mm" ? `${(a / 1e6).toFixed(3)} m²` : `${(a / 144).toFixed(2)} sq ft`;
}

function polygonArea(points: { x: number; y: number }[]) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function Geometry({ editor, e }: { editor: Editor; e: Entity }) {
  const units = editor.doc.units;
  const len = (v: number) => formatLength(v, units);
  const parseLen = (t: string) => parseLength(t, units);
  const set = (next: Entity) => editor.updateEntity(next);
  const editable = editor.doc.isEditable(e);
  const num = (value: number, apply: (n: number) => Entity, parse = parseLen, format = len) =>
    editable ? <Field key={format(value)} value={format(value)} parse={parse} onCommit={(n) => set(apply(n))} /> : <Static>{format(value)}</Static>;

  switch (e.type) {
    case "line":
      return (
        <Group title="Geometry">
          <Row label="Start X">{num(e.a.x, (x) => ({ ...e, a: { ...e.a, x } }))}</Row>
          <Row label="Start Y">{num(e.a.y, (y) => ({ ...e, a: { ...e.a, y } }))}</Row>
          <Row label="End X">{num(e.b.x, (x) => ({ ...e, b: { ...e.b, x } }))}</Row>
          <Row label="End Y">{num(e.b.y, (y) => ({ ...e, b: { ...e.b, y } }))}</Row>
          <Row label="Delta X"><Static>{len(e.b.x - e.a.x)}</Static></Row>
          <Row label="Delta Y"><Static>{len(e.b.y - e.a.y)}</Static></Row>
          <Row label="Length"><Static>{len(dist(e.a, e.b))}</Static></Row>
          <Row label="Angle"><Static>{formatAngle(angleOf(e.a, e.b))}</Static></Row>
        </Group>
      );
    case "circle":
      return (
        <Group title="Geometry">
          <Row label="Center X">{num(e.center.x, (x) => ({ ...e, center: { ...e.center, x } }))}</Row>
          <Row label="Center Y">{num(e.center.y, (y) => ({ ...e, center: { ...e.center, y } }))}</Row>
          <Row label="Radius">{num(e.radius, (r) => ({ ...e, radius: Math.max(r, 1e-9) }))}</Row>
          <Row label="Diameter">{num(e.radius * 2, (d) => ({ ...e, radius: Math.max(d / 2, 1e-9) }))}</Row>
          <Row label="Circumference"><Static>{len(TAU * e.radius)}</Static></Row>
          <Row label="Area"><Static>{area(Math.PI * e.radius * e.radius, units)}</Static></Row>
        </Group>
      );
    case "arc": {
      const sweep = sweepOf(e.start, e.end);
      const angle = (t: string) => parseAngle(t);
      return (
        <Group title="Geometry">
          <Row label="Center X">{num(e.center.x, (x) => ({ ...e, center: { ...e.center, x } }))}</Row>
          <Row label="Center Y">{num(e.center.y, (y) => ({ ...e, center: { ...e.center, y } }))}</Row>
          <Row label="Radius">{num(e.radius, (r) => ({ ...e, radius: Math.max(r, 1e-9) }))}</Row>
          <Row label="Start angle">{num(e.start, (a) => ({ ...e, start: a }), angle, formatAngle)}</Row>
          <Row label="End angle">{num(e.end, (a) => ({ ...e, end: a }), angle, formatAngle)}</Row>
          <Row label="Total angle"><Static>{formatAngle(sweep)}</Static></Row>
          <Row label="Arc length"><Static>{len(e.radius * sweep)}</Static></Row>
          <Row label="Start X, Y"><Static>{`${len(arcStart(e).x)}, ${len(arcStart(e).y)}`}</Static></Row>
          <Row label="End X, Y"><Static>{`${len(arcEnd(e).x)}, ${len(arcEnd(e).y)}`}</Static></Row>
        </Group>
      );
    }
    case "ellipse": {
      const a = magnitude(e.major);
      return (
        <Group title="Geometry">
          <Row label="Center X">{num(e.center.x, (x) => ({ ...e, center: { ...e.center, x } }))}</Row>
          <Row label="Center Y">{num(e.center.y, (y) => ({ ...e, center: { ...e.center, y } }))}</Row>
          <Row label="Major radius">{num(a, (r) => ({ ...e, major: { x: (e.major.x / a) * Math.max(r, 1e-9), y: (e.major.y / a) * Math.max(r, 1e-9) }, ratio: Math.min((a * e.ratio) / Math.max(r, 1e-9), 1) }))}</Row>
          <Row label="Minor radius">{num(a * e.ratio, (r) => ({ ...e, ratio: Math.min(Math.max(r / a, 1e-6), 1) }))}</Row>
          <Row label="Radius ratio"><Static>{e.ratio.toFixed(4)}</Static></Row>
          <Row label="Rotation"><Static>{formatAngle(Math.atan2(e.major.y, e.major.x))}</Static></Row>
          {isFullEllipse(e) ? (
            <Row label="Area"><Static>{area(Math.PI * a * a * e.ratio, units)}</Static></Row>
          ) : (
            <Row label="Total angle"><Static>{formatAngle(sweepOf(e.start, e.end))}</Static></Row>
          )}
        </Group>
      );
    }
    case "spline": {
      const pts = tessellate(e)[0];
      let length = 0;
      for (let i = 0; i + 1 < pts.length; i++) length += dist(pts[i], pts[i + 1]);
      return (
        <Group title="Geometry">
          <Row label="Fit points"><Static>{e.fit.length}</Static></Row>
          <Row label="Closed"><Static>{e.closed ? "Yes" : "No"}</Static></Row>
          <Row label="Length"><Static>{len(length)}</Static></Row>
        </Group>
      );
    }
    case "xline":
    case "ray":
      return (
        <Group title="Geometry">
          <Row label={e.type === "ray" ? "Start X" : "Root X"}>{num(e.base.x, (x) => ({ ...e, base: { ...e.base, x } }))}</Row>
          <Row label={e.type === "ray" ? "Start Y" : "Root Y"}>{num(e.base.y, (y) => ({ ...e, base: { ...e.base, y } }))}</Row>
          <Row label="Direction"><Static>{formatAngle(Math.atan2(e.dir.y, e.dir.x))}</Static></Row>
        </Group>
      );
    case "text":
    case "mtext": {
      const styles = [...editor.doc.textStyles.keys()];
      return (
        <Group title="Text">
          <Row label="Contents">
            {editable ? (
              <TextField key={e.text} value={e.text} multiline={e.type === "mtext"} onCommit={(text) => text.trim() && set({ ...e, text })} />
            ) : (
              <Static>{e.text}</Static>
            )}
          </Row>
          <Row label="Style">
            <select value={e.style} disabled={!editable} onChange={(ev) => set({ ...e, style: ev.target.value })} className="h-5 w-full bg-transparent text-[11px] outline-none">
              {styles.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Row>
          {e.type === "text" && (
            <Row label="Justify">
              <select
                value={`${e.halign}/${e.valign}`}
                disabled={!editable}
                onChange={(ev) => {
                  const [halign, valign] = ev.target.value.split("/") as [HAlign, VAlign];
                  set({ ...e, halign, valign });
                }}
                className="h-5 w-full bg-transparent text-[11px] outline-none"
              >
                {[["left", "baseline", "Left"], ["center", "baseline", "Center"], ["right", "baseline", "Right"], ["center", "middle", "Middle"], ["left", "top", "Top left"], ["center", "top", "Top center"], ["right", "top", "Top right"], ["left", "middle", "Middle left"], ["right", "middle", "Middle right"], ["left", "bottom", "Bottom left"], ["center", "bottom", "Bottom center"], ["right", "bottom", "Bottom right"]].map(([h, v, label]) => (
                  <option key={label} value={`${h}/${v}`}>
                    {label}
                  </option>
                ))}
              </select>
            </Row>
          )}
          <Row label="Height">{num(e.height, (h) => ({ ...e, height: Math.max(h, 1e-9) }))}</Row>
          {e.type === "mtext" && <Row label="Width">{num(e.width, (w) => ({ ...e, width: Math.max(w, 0) }))}</Row>}
          <Row label="Rotation">{num(e.rotation, (a) => ({ ...e, rotation: a }), (t) => parseAngle(t), formatAngle)}</Row>
          <Row label="Position X">{num(e.at.x, (x) => ({ ...e, at: { ...e.at, x } }))}</Row>
          <Row label="Position Y">{num(e.at.y, (y) => ({ ...e, at: { ...e.at, y } }))}</Row>
        </Group>
      );
    }
    case "dimension":
      return (
        <Group title="Dimension">
          <Row label="Type"><Static>{e.kind[0].toUpperCase() + e.kind.slice(1)}</Static></Row>
          <Row label="Measurement"><Static>{e.kind === "angular" ? formatAngle(dimMeasurement(e)) : len(dimMeasurement(e))}</Static></Row>
          <Row label="Text override">
            {editable ? <TextField key={e.text} value={e.text} placeholder="<> = measurement" onCommit={(text) => set({ ...e, text })} /> : <Static>{e.text}</Static>}
          </Row>
          <Row label="Shows"><Static>{dimText(e)}</Static></Row>
          <Row label="Dim style">
            <select value={e.style} disabled={!editable} onChange={(ev) => set({ ...e, style: ev.target.value })} className="h-5 w-full bg-transparent text-[11px] outline-none">
              {[...editor.doc.dimStyles.keys()].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Row>
        </Group>
      );
    case "leader":
      return (
        <Group title="Multileader">
          <Row label="Contents">{editable ? <TextField key={e.text} value={e.text} multiline onCommit={(text) => set({ ...e, text })} /> : <Static>{e.text}</Static>}</Row>
          <Row label="Text height">{num(e.height, (h) => ({ ...e, height: Math.max(h, 1e-9) }))}</Row>
        </Group>
      );
    case "hatch": {
      let total = 0;
      e.loops.forEach((loop, i) => (total += (i === 0 ? 1 : -1) * polygonArea(loop)));
      return (
        <Group title="Pattern">
          <Row label="Pattern">
            <select value={e.pattern} disabled={!editable} onChange={(ev) => set({ ...e, pattern: ev.target.value })} className="h-5 w-full bg-transparent text-[11px] outline-none">
              {Object.keys(HATCH_PATTERNS).map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Row>
          <Row label="Scale">{num(e.scale, (k) => ({ ...e, scale: Math.max(k, 1e-6) }), (t) => (Number.isFinite(Number(t)) && t.trim() ? Number(t) : null), (v) => trimNumber(v, 4))}</Row>
          <Row label="Angle">{num(e.angle, (a) => ({ ...e, angle: a }), (t) => parseAngle(t), formatAngle)}</Row>
          <Row label="Area"><Static>{area(Math.max(total, 0), units)}</Static></Row>
        </Group>
      );
    }
    case "polyline": {
      let length = 0;
      for (let i = 0; i + 1 < e.points.length; i++) length += dist(e.points[i], e.points[i + 1]);
      if (e.closed && e.points.length > 2) length += dist(e.points.at(-1)!, e.points[0]);
      return (
        <Group title="Geometry">
          <Row label="Vertices"><Static>{e.points.length}</Static></Row>
          <Row label="Closed">
            {editable ? (
              <select value={e.closed ? "yes" : "no"} onChange={(ev) => set({ ...e, closed: ev.target.value === "yes" })} className="h-5 w-full bg-transparent text-[11px] outline-none">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            ) : (
              <Static>{e.closed ? "Yes" : "No"}</Static>
            )}
          </Row>
          <Row label="Length"><Static>{len(length)}</Static></Row>
          {e.closed && <Row label="Area"><Static>{area(polygonArea(e.points), units)}</Static></Row>}
        </Group>
      );
    }
  }
}

export function PropertiesPalette({ editor, state, dark, onClose }: { editor: Editor; state: Snapshot; dark: boolean; onClose: () => void }) {
  const selected = editor.selected();
  const types = [...new Set(selected.map((e) => e.type))] as EntityType[];
  const [filter, setFilter] = useState<EntityType | "all">("all");
  const kind = filter !== "all" && types.includes(filter) ? filter : "all";
  const targets = kind === "all" ? selected : selected.filter((e) => e.type === kind);
  const doc = editor.doc;

  const common = <T,>(get: (e: Entity) => T, fallback: T): T | "varies" => {
    if (!targets.length) return fallback;
    const first = get(targets[0]);
    return targets.every((e) => get(e) === first) ? first : "varies";
  };
  const color = common((e) => e.color, state.current.color);
  const layer = common((e) => e.layer, state.currentLayer);
  const lw = common((e) => e.lineweight, state.current.lineweight);
  // Changing a filtered selection only changes the filtered objects, as in AutoCAD.
  const apply = (patch: Partial<Pick<Entity, "layer" | "color" | "lineweight">>) => {
    if (!targets.length) return editor.setProperty(patch);
    doc.begin("PROPERTIES");
    for (const e of targets) if (doc.isEditable(e)) doc.update({ ...e, ...patch } as Entity);
    doc.commit();
  };
  const layerColor = typeof layer === "string" && layer !== "varies" ? doc.layers.get(layer)?.color : undefined;

  return (
    <PaletteFrame title="Properties" onClose={onClose}>
      <div className="border-b p-1.5">
        <select
          value={kind}
          onChange={(e) => setFilter(e.target.value as EntityType | "all")}
          className="h-6 w-full rounded border bg-background px-1 text-xs"
          disabled={!selected.length}
        >
          {!selected.length && <option value="all">No selection</option>}
          {selected.length > 0 && <option value="all">{types.length === 1 ? `${ENTITY_NAMES[types[0]]} (${selected.length})` : `All (${selected.length})`}</option>}
          {types.length > 1 && types.map((t) => <option key={t} value={t}>{`${ENTITY_NAMES[t]} (${selected.filter((e) => e.type === t).length})`}</option>)}
        </select>
      </div>
      <Group title="General">
        <Row label="Color">
          <Popover
            trigger={(_, toggle) => (
              <button type="button" onClick={toggle} className="flex h-5 w-full items-center gap-1.5 rounded-sm px-1 text-left hover:bg-muted">
                {color === "varies" ? (
                  <span className="text-muted-foreground">*VARIES*</span>
                ) : (
                  <>
                    <Swatch color={color ?? layerColor ?? 7} dark={dark} />
                    {colorName(color)}
                  </>
                )}
              </button>
            )}
            align="right"
          >
            {(close) => (
              <ColorPicker
                value={color === "varies" ? -1 : color}
                dark={dark}
                onChange={(c) => {
                  close();
                  apply({ color: c });
                }}
              />
            )}
          </Popover>
        </Row>
        <Row label="Layer">
          <select
            value={layer === "varies" ? "" : layer}
            onChange={(e) => e.target.value && apply({ layer: e.target.value })}
            className="h-5 w-full bg-transparent text-[11px] outline-none"
          >
            {layer === "varies" && <option value="">*VARIES*</option>}
            {[...doc.layers.values()].map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Linetype">
          <Static>ByLayer</Static>
        </Row>
        <Row label="Lineweight">
          <Popover
            trigger={(_, toggle) => (
              <button type="button" onClick={toggle} className="h-5 w-full rounded-sm px-1 text-left hover:bg-muted">
                {lw === "varies" ? <span className="text-muted-foreground">*VARIES*</span> : lineweightName(lw)}
              </button>
            )}
            align="right"
          >
            {(close) => (
              <LineweightPicker
                value={lw === "varies" ? -99 : lw}
                onChange={(v) => {
                  close();
                  apply({ lineweight: v });
                }}
              />
            )}
          </Popover>
        </Row>
      </Group>
      {targets.length === 1 && <Geometry editor={editor} e={targets[0]} />}
    </PaletteFrame>
  );
}

export function LayerManager({ editor, state, dark, onClose }: { editor: Editor; state: Snapshot; dark: boolean; onClose: () => void }) {
  const doc = editor.doc;
  const layers = [...doc.layers.values()].sort((a, b) => (a.name === "0" ? -1 : b.name === "0" ? 1 : a.name.localeCompare(b.name, undefined, { numeric: true })));
  const [picked, setPicked] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const e of doc.entities.values()) counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);

  const change = (layer: Layer, patch: Partial<Layer>) => {
    doc.begin("LAYER");
    doc.setLayer({ ...layer, ...patch });
    doc.commit();
  };
  const create = () => {
    let n = 1;
    while (doc.layers.has(`Layer${n}`)) n++;
    doc.begin("LAYER");
    doc.setLayer(newLayer(`Layer${n}`));
    doc.commit();
    setPicked(`Layer${n}`);
    setRenaming(`Layer${n}`);
  };
  const remove = () => {
    if (!picked) return;
    doc.begin("LAYER");
    const ok = doc.removeLayer(picked);
    doc.commit();
    if (!ok) editor.print(`Layer "${picked}" can't be deleted: it's layer 0, the current layer, or it has objects.`, "error");
    else setPicked(null);
  };
  const rename = (from: string, to: string) => {
    setRenaming(null);
    const name = to.trim();
    if (!name || name === from) return;
    if (/[<>/\\":;?*|=`]/.test(name)) return editor.print("Layer names can't contain <>/\\\":;?*|=`", "error");
    doc.begin("LAYER");
    const ok = doc.renameLayer(from, name);
    doc.commit();
    if (!ok) editor.print(`Can't rename layer "${from}" to "${name}".`, "error");
    else setPicked(name);
  };

  const Icon = ({ on, onIcon: On, offIcon: Off, title, onClick, className }: { on: boolean; onIcon: typeof Sun; offIcon: typeof Sun; title: string; onClick: () => void; className?: string }) => (
    <button type="button" title={title} onClick={onClick} className={cn("rounded p-0.5 hover:bg-accent", className)}>
      {on ? <On className="size-3.5" /> : <Off className="size-3.5 opacity-60" />}
    </button>
  );

  return (
    <PaletteFrame title="Layer Properties" onClose={onClose}>
      <div className="flex items-center gap-1 border-b p-1">
        <button type="button" onClick={create} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent" title="New layer">
          <Plus className="size-3.5" /> New
        </button>
        <button type="button" onClick={remove} disabled={!picked} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent disabled:opacity-40" title="Delete layer">
          <Trash className="size-3.5" /> Delete
        </button>
        <button
          type="button"
          onClick={() => picked && doc.setCurrentLayer(picked)}
          disabled={!picked}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent disabled:opacity-40"
          title="Set current"
        >
          <Check className="size-3.5" /> Current
        </button>
      </div>
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-background text-left text-muted-foreground">
          <tr className="border-b">
            <th className="w-5 px-1" />
            <th className="px-1 py-1 font-medium">Name</th>
            <th className="w-6 font-medium" title="On">On</th>
            <th className="w-6 font-medium" title="Freeze">Frz</th>
            <th className="w-6 font-medium" title="Lock">Lck</th>
            <th className="w-12 font-medium">Color</th>
            <th className="font-medium">Lineweight</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((l) => (
            <tr
              key={l.name}
              onClick={() => setPicked(l.name)}
              onDoubleClick={() => (l.name === state.currentLayer ? undefined : doc.setCurrentLayer(l.name))}
              className={cn("border-b", picked === l.name ? "bg-primary/10" : "hover:bg-muted/60")}
            >
              <td className="px-1 text-center text-primary">{l.name === state.currentLayer && <Check className="size-3.5" />}</td>
              <td className="max-w-0 px-1 py-0.5">
                {renaming === l.name ? (
                  <input
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    defaultValue={l.name}
                    onBlur={(e) => rename(l.name, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(l.name, (e.target as HTMLInputElement).value);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="h-5 w-full rounded-sm border bg-background px-1 outline-none"
                  />
                ) : (
                  <span className="block truncate" onDoubleClick={(e) => (e.stopPropagation(), l.name !== "0" && setRenaming(l.name))} title={`${counts.get(l.name) ?? 0} objects. Double-click the name to rename.`}>
                    {l.name}
                  </span>
                )}
              </td>
              <td><Icon on={l.on} onIcon={Lightbulb} offIcon={LightbulbOff} title={l.on ? "On" : "Off"} onClick={() => change(l, { on: !l.on })} className={l.on ? "text-amber-500" : ""} /></td>
              <td><Icon on={!l.frozen} onIcon={Sun} offIcon={Snowflake} title={l.frozen ? "Frozen" : "Thawed"} onClick={() => l.name !== state.currentLayer && change(l, { frozen: !l.frozen })} className={l.frozen ? "text-sky-500" : "text-amber-500"} /></td>
              <td><Icon on={!l.locked} onIcon={LockOpen} offIcon={Lock} title={l.locked ? "Locked" : "Unlocked"} onClick={() => change(l, { locked: !l.locked })} /></td>
              <td>
                <Popover
                  trigger={(_, toggle) => (
                    <button type="button" onClick={toggle} className="flex items-center gap-1 rounded px-1 hover:bg-accent">
                      <Swatch color={l.color} dark={dark} />
                      <span className="truncate">{typeof l.color === "number" ? l.color : "RGB"}</span>
                    </button>
                  )}
                  align="right"
                >
                  {(close) => (
                    <ColorPicker
                      value={l.color}
                      byLayer={false}
                      dark={dark}
                      onChange={(c) => {
                        close();
                        if (c !== null) change(l, { color: c });
                      }}
                    />
                  )}
                </Popover>
              </td>
              <td>
                <Popover
                  trigger={(_, toggle) => (
                    <button type="button" onClick={toggle} className="w-full truncate rounded px-1 text-left hover:bg-accent">
                      {lineweightName(l.lineweight)}
                    </button>
                  )}
                  align="right"
                >
                  {(close) => (
                    <LineweightPicker
                      value={l.lineweight}
                      byLayer={false}
                      onChange={(v) => {
                        close();
                        change(l, { lineweight: v });
                      }}
                    />
                  )}
                </Popover>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PaletteFrame>
  );
}


/** Paper sizes as AutoCAD shows them in a dimension style: fractions of an inch, or millimetres. */
function paperSize(v: number, units: Units) {
  if (units === "mm") return trimNumber(v, 3);
  return formatLength(v, units).replace(/^0'-/, "").replace(/^0 /, "");
}

/** The Text Style and Dimension Style managers (STYLE, DIMSTYLE), in one palette. */
export function StylesPalette({ editor, state, onClose }: { editor: Editor; state: Snapshot; onClose: () => void }) {
  void state;
  const doc = editor.doc;
  const units = doc.units;
  const [textName, setTextName] = useState(doc.currentTextStyle);
  const [dimName, setDimName] = useState(doc.currentDimStyle);
  const text = doc.textStyles.get(textName) ?? doc.textStyles.get(doc.currentTextStyle)!;
  const dim = doc.dimStyles.get(dimName) ?? doc.dimStyles.get(doc.currentDimStyle)!;
  const saveText = (patch: Partial<TextStyle>) => {
    doc.begin("STYLE");
    doc.setTextStyle({ ...text, ...patch });
    doc.commit();
  };
  const saveDim = (patch: Partial<DimStyle>) => {
    doc.begin("DIMSTYLE");
    doc.setDimStyle({ ...dim, ...patch });
    doc.commit();
  };
  const create = (kind: "text" | "dim") => {
    const base = kind === "text" ? "Style" : "Dim";
    let n = 1;
    const table = kind === "text" ? doc.textStyles : doc.dimStyles;
    while (table.has(`${base}${n}`)) n++;
    const name = window.prompt(`New ${kind === "text" ? "text" : "dimension"} style name (a copy of the selected one)`, `${base}${n}`)?.trim();
    if (!name || table.has(name)) return;
    doc.begin(kind === "text" ? "STYLE" : "DIMSTYLE");
    if (kind === "text") {
      doc.setTextStyle({ ...text, name });
      setTextName(name);
    } else {
      doc.setDimStyle({ ...dim, name });
      setDimName(name);
    }
    doc.commit();
  };
  const select = "h-6 w-full rounded border bg-background px-1 text-[11px]";
  const size = (label: string, key: keyof DimStyle, isLength = true) => (
    <Row label={label}>
      <Field
        key={`${dim.name}-${key}-${dim[key]}`}
        value={isLength ? paperSize(Number(dim[key]), units) : trimNumber(Number(dim[key]), 4)}
        parse={(t) => {
          const n = isLength ? parseLength(t, units) : Number(t);
          return n !== null && Number.isFinite(n) && n > 0 ? n : null;
        }}
        onCommit={(n) => saveDim({ [key]: n } as Partial<DimStyle>)}
      />
    </Row>
  );

  return (
    <PaletteFrame title="Styles" onClose={onClose}>
      <Group title="Text styles">
        <div className="flex gap-1 p-1.5">
          <select className={select} value={text.name} onChange={(e) => setTextName(e.target.value)}>
            {[...doc.textStyles.keys()].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <button type="button" onClick={() => create("text")} className="rounded px-1.5 text-xs hover:bg-accent" title="New text style">
            <Plus className="size-3.5" />
          </button>
          <button type="button" onClick={() => doc.setSetting("currentTextStyle", text.name)} disabled={text.name === doc.currentTextStyle} className="rounded px-1.5 text-xs hover:bg-accent disabled:opacity-40" title="Set current">
            <Check className="size-3.5" />
          </button>
        </div>
        <Row label="Font">
          <select className="h-5 w-full bg-transparent text-[11px] outline-none" value={text.font} onChange={(e) => saveText({ font: e.target.value })}>
            {TEXT_FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Row>
        <Row label="Width factor">
          <Field key={`${text.name}-${text.widthFactor}`} value={trimNumber(text.widthFactor, 3)} parse={(t) => (Number(t) > 0 ? Number(t) : null)} onCommit={(n) => saveText({ widthFactor: n })} />
        </Row>
      </Group>
      <Group title="Dimension styles">
        <div className="flex gap-1 p-1.5">
          <select className={select} value={dim.name} onChange={(e) => setDimName(e.target.value)}>
            {[...doc.dimStyles.keys()].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <button type="button" onClick={() => create("dim")} className="rounded px-1.5 text-xs hover:bg-accent" title="New dimension style">
            <Plus className="size-3.5" />
          </button>
          <button type="button" onClick={() => doc.setSetting("currentDimStyle", dim.name)} disabled={dim.name === doc.currentDimStyle} className="rounded px-1.5 text-xs hover:bg-accent disabled:opacity-40" title="Set current">
            <Check className="size-3.5" />
          </button>
        </div>
        {size("Text height", "textHeight")}
        {size("Arrow size", "arrowSize")}
        <Row label="Arrowheads">
          <select className="h-5 w-full bg-transparent text-[11px] outline-none" value={dim.arrow} onChange={(e) => saveDim({ arrow: e.target.value as DimStyle["arrow"] })}>
            <option value="closed">Closed filled</option>
            <option value="tick">Architectural tick</option>
            <option value="dot">Dot</option>
            <option value="open">Open</option>
          </select>
        </Row>
        {size("Offset from origin", "extOffset")}
        {size("Extend beyond", "extBeyond")}
        {size("Text gap", "textGap")}
        {size("Baseline spacing", "baselineSpacing")}
        {size("Overall scale", "scale", false)}
        <Row label="Text style">
          <select className="h-5 w-full bg-transparent text-[11px] outline-none" value={dim.textStyle} onChange={(e) => saveDim({ textStyle: e.target.value })}>
            {[...doc.textStyles.keys()].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Row>
      </Group>
    </PaletteFrame>
  );
}
