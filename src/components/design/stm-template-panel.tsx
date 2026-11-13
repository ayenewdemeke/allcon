"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { BARS } from "@/lib/design/stm/aashto";
import type { GirderLink } from "@/lib/design/stm/cap-loads";
import type { StmInputs } from "@/lib/design/stm/strut-tie";
import { ABUTMENT_DEFAULTS, bearingsFromLink, buildTemplate, HAMMERHEAD_DEFAULTS, INVERTED_T_DEFAULTS, MULTICOLUMN_DEFAULTS, type LedgeTemplate, type StmTemplate } from "@/lib/design/stm/templates";

/** An inverted-T's ledges: their size, where the girders bear, and their bars (AASHTO 5.8.4.3). */
function LedgeFields({ ledge, onChange }: { ledge: LedgeTemplate; onChange: (l: LedgeTemplate) => void }) {
  const set = <K extends keyof LedgeTemplate>(k: K) => (v: LedgeTemplate[K]) => onChange({ ...ledge, [k]: v });
  const group = (label: string, k: "primary" | "ties" | "hangers") => (
    <div className="grid grid-cols-[1fr_4rem_3rem] items-center gap-1 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <select value={ledge[k].size} onChange={(e) => set(k)({ ...ledge[k], size: Number(e.target.value) })} className="h-6 rounded border border-input bg-transparent">
        {barOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input type="number" value={ledge[k].spacing} onChange={(e) => set(k)({ ...ledge[k], spacing: Number(e.target.value) })} className="h-6 rounded border border-input bg-transparent px-1 text-right" />
    </div>
  );
  return (
    <div className="my-1 rounded border border-border/60 p-1.5">
      <p className="font-medium">Ledges (5.8.4.3)</p>
      <Field label="Ledge depth" unit="in" value={ledge.depth} onChange={set("depth")} />
      <Field label="Ledge projection from the stem" unit="in" value={ledge.projection} onChange={set("projection")} />
      <Field label="Stem face to the bearings' centerline" unit="in" value={ledge.av} onChange={set("av")} />
      <Field label="Ledge top to its bars' centroid" unit="in" value={ledge.cover} onChange={set("cover")} step={0.25} />
      <p className="pt-1 text-[11px] text-muted-foreground">Bars: size and spacing (in)</p>
      {group("Ledge bars across the stem face", "primary")}
      {group("Closed ties in the ledge", "ties")}
      {group("Hanger stirrups", "hangers")}
      <p className="text-[11px] text-muted-foreground">The bearing pads below: length along the cap is W, width across is L.</p>
    </div>
  );
}
import { DesignError } from "@/lib/design/walls/cip";
import { Button } from "@/components/ui/button";
import { Choice, Field } from "./design-kit";

// Start from a standard pier cap: its dimensions, columns, bearings and bars; "Build the model"
// writes the outline, nodes, supports, struts and ties, ties' bars and node checks.

const barOptions = Object.keys(BARS).map((b) => ({ value: Number(b), label: `#${b}` }));

export function StmTemplatePanel({ inputs, onBuild, onLink }: { inputs: StmInputs; onBuild: (next: StmInputs) => void; onLink: (link: GirderLink) => void }) {
  const [t, setT] = useState<StmTemplate>(inputs.template ?? HAMMERHEAD_DEFAULTS);
  const set = <K extends keyof StmTemplate>(k: K) => (v: StmTemplate[K]) => setT((s) => ({ ...s, [k]: v }));
  const build = () => {
    try {
      onBuild(buildTemplate(t, inputs));
      toast.success("Model built from the template");
    } catch (err) {
      toast.error(err instanceof DesignError ? err.message : "Could not build the model");
    }
  };
  const fromLink = () => {
    const link = inputs.girders;
    if (!link?.back && !link?.ahead) return toast.error("Pick the girder designs under Loads from girder designs first");
    let xs = bearingsFromLink(link);
    // Girders off the cap: the link's centerline isn't set for this cap yet. Center the bridge on the cap.
    if (xs.some((x) => x <= 0 || x >= t.length)) {
      const shift = t.length / 2 - (xs[0] + xs[xs.length - 1]) / 2;
      const x0 = Math.round((link.x0 + shift) * 100) / 100;
      onLink({ ...link, x0 });
      xs = bearingsFromLink({ ...link, x0 });
      if (xs.some((x) => x <= 0 || x >= t.length)) toast.error("The girders are wider than the cap: lengthen the cap.");
      else toast.success(`Bridge centered on the cap: its centerline set at x = ${x0} ft`);
    }
    set("bearings")(xs.map((x) => ({ x: Math.round(x * 100) / 100, P: 0 })));
  };
  const hammer = t.kind === "hammerhead";
  return (
    <div className="text-xs">
      <Choice
        label="Cap"
        value={t.kind}
        options={[
          { value: "hammerhead", label: "Hammerhead" },
          { value: "multicolumn", label: "Multi-column bent cap" },
          { value: "inverted-t", label: "Inverted-T bent cap" },
          { value: "abutment", label: "Abutment cap on piles" },
        ]}
        onChange={(k) => setT(k === "hammerhead" ? HAMMERHEAD_DEFAULTS : k === "inverted-t" ? INVERTED_T_DEFAULTS : k === "abutment" ? ABUTMENT_DEFAULTS : MULTICOLUMN_DEFAULTS)}
      />
      <Field label="Cap length" unit="ft" value={t.length} onChange={set("length")} step={0.5} />
      <Field label={hammer ? "Depth at the column" : "Depth"} unit="ft" value={t.depth} onChange={set("depth")} step={0.25} />
      {hammer && <Field label="Depth at the ends" unit="ft" value={t.tipDepth} onChange={set("tipDepth")} step={0.25} />}
      <Field label={t.kind === "inverted-t" ? "Stem width (out of plane)" : "Cap width (out of plane)"} unit="in" value={t.capWidth} onChange={set("capWidth")} />
      <Field label={t.kind === "abutment" ? "Pile width (in plane)" : "Column width (in plane)"} unit="ft" value={t.columnWidth} onChange={set("columnWidth")} step={0.25} />
      {t.kind === "inverted-t" && t.ledge && <LedgeFields ledge={t.ledge} onChange={set("ledge")} />}
      {hammer ? (
        <Field label="Column centerline from the left end" unit="ft" value={t.columns[0] ?? 0} onChange={(v) => set("columns")([v])} step={0.5} />
      ) : (
        <label className="block py-1">
          <span className="text-muted-foreground">{t.kind === "abutment" ? "Pile" : "Column"} centerlines from the left end (ft), separated by commas</span>
          <input
            defaultValue={t.columns.join(", ")}
            key={t.kind}
            onChange={(e) => {
              const xs = e.target.value.split(",").map((s) => Number(s.trim())).filter((v) => Number.isFinite(v) && v > 0);
              if (xs.length) set("columns")(xs);
            }}
            className="mt-1 h-6 w-full rounded border border-input bg-transparent px-1"
          />
        </label>
      )}
      {hammer && (
        <>
          <Field label="Column face to its bars' centroid" unit="in" value={t.columnBarInset} onChange={set("columnBarInset")} step={0.5} />
          <Choice
            label="Lay out for"
            value={t.direction}
            options={[
              { value: "auto", label: "The case turning the column most" },
              { value: "right", label: "Cases turning it toward the right" },
              { value: "left", label: "Cases turning it toward the left" },
            ]}
            onChange={set("direction")}
          />
        </>
      )}
      <Field label="Top of cap to top bars' centroid" unit="in" value={t.topCover} onChange={set("topCover")} step={0.5} />
      {hammer && (
        <Choice
          label="Bottom strut"
          value={t.bottomChord ?? "auto"}
          options={[
            { value: "auto", label: "At a/2, from the arm's moment (FHWA)" },
            { value: "entered", label: "At the height entered" },
          ]}
          onChange={set("bottomChord")}
        />
      )}
      {(!hammer || t.bottomChord === "entered") && <Field label="Soffit to bottom chord" unit="in" value={t.bottomCover} onChange={set("bottomCover")} step={0.5} />}
      {hammer && <Field label="Resolve bearings closer than" unit="ft" value={t.resolveWithin ?? t.depth / 2} onChange={set("resolveWithin")} step={0.25} />}

      <p className="pt-2 font-medium">Bearings (factored loads, kip)</p>
      <table className="w-full">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="font-normal">x from the left end, ft</th>
            <th className="font-normal">Load, kip</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {t.bearings.map((b, k) => (
            <tr key={k}>
              <td className="pr-1">
                <input type="number" value={b.x} step={0.5} onChange={(e) => set("bearings")(t.bearings.map((x, j) => (j === k ? { ...x, x: Number(e.target.value) } : x)))} className="h-6 w-full rounded border border-input bg-transparent px-1 text-right" />
              </td>
              <td className="pr-1">
                <input type="number" value={b.P} onChange={(e) => set("bearings")(t.bearings.map((x, j) => (j === k ? { ...x, P: Number(e.target.value) } : x)))} className="h-6 w-full rounded border border-input bg-transparent px-1 text-right" />
              </td>
              <td className="w-5">
                <button type="button" onClick={() => set("bearings")(t.bearings.filter((_, j) => j !== k))} className="text-muted-foreground hover:text-destructive" aria-label="Remove bearing">
                  <X className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-3">
        <button type="button" onClick={() => set("bearings")([...t.bearings, { x: t.length / 2, P: 0 }])} className="mt-1 flex items-center gap-1 text-primary hover:underline">
          <Plus className="size-3" /> Bearing
        </button>
        <button type="button" onClick={fromLink} className="mt-1 text-primary hover:underline">
          Positions from the girder link
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">With the girder link on, the loads come from the girders and these only place the nodes.</p>
      <Field label="Bearing length along the cap" unit="in" value={t.bearingLength} onChange={set("bearingLength")} />
      <Field label="Bearing width across the cap" unit="in" value={t.bearingWidth} onChange={set("bearingWidth")} />

      <p className="pt-2 font-medium">Bars</p>
      <BarRow label="Top bars" size={t.topBars.size} count={t.topBars.count} onChange={(size, count) => set("topBars")({ size, count })} />
      <BarRow label={hammer ? "Bottom bars (along the soffit)" : "Bottom bars"} size={t.bottomBars.size} count={t.bottomBars.count} onChange={(size, count) => set("bottomBars")({ size, count })} />
      <div className="grid grid-cols-[1fr_4rem_3rem_3rem] items-center gap-1 py-0.5">
        <span className="text-muted-foreground">Stirrups: size, legs, spacing (in)</span>
        <select value={t.stirrups.size} onChange={(e) => set("stirrups")({ ...t.stirrups, size: Number(e.target.value) })} className="h-6 rounded border border-input bg-transparent">
          {barOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input type="number" value={t.stirrups.legs} onChange={(e) => set("stirrups")({ ...t.stirrups, legs: Number(e.target.value) })} className="h-6 rounded border border-input bg-transparent px-1 text-right" />
        <input type="number" value={t.stirrups.spacing} onChange={(e) => set("stirrups")({ ...t.stirrups, spacing: Number(e.target.value) })} className="h-6 rounded border border-input bg-transparent px-1 text-right" />
      </div>
      <Field label="Clear cover to the stirrups (sides, top, ends)" unit="in" value={t.sideCover} onChange={set("sideCover")} step={0.25} />
      <Choice
        label="Top and bottom bars at the cap's ends"
        value={t.barEnds}
        options={[
          { value: "hook", label: "90° hooks" },
          { value: "straight", label: "Straight" },
        ]}
        onChange={set("barEnds")}
      />
      <Button size="sm" className="mt-2 w-full" onClick={build}>
        Build the model
      </Button>
      <p className="pt-1 text-[11px] text-muted-foreground">Replaces the outline, nodes, supports, members, ties and node checks. Each bearing gets a direct strut to its column where it&apos;s steeper than 27°; farther out, its load steps in panel by panel with vertical stirrup ties. A hammerhead follows FHWA&apos;s cantilever bent (Design Example 2): bearings closer than the distance given act as one load at their resultant, each arm&apos;s loads strut to their own column node, the bottom strut sits as low as its node&apos;s back face allows, and the column struts come from the column&apos;s stress where the disturbed region ends, for the cases turning it one way; cases turning it the other way need a second design laid out for that side.</p>
    </div>
  );
}

function BarRow({ label, size, count, onChange }: { label: string; size: number; count: number; onChange: (size: number, count: number) => void }) {
  return (
    <div className="grid grid-cols-[1fr_4rem_4rem] items-center gap-1 py-0.5">
      <span className="text-muted-foreground">{label}: size, number</span>
      <select value={size} onChange={(e) => onChange(Number(e.target.value), count)} className="h-6 rounded border border-input bg-transparent">
        {barOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input type="number" value={count} onChange={(e) => onChange(size, Number(e.target.value))} className="h-6 rounded border border-input bg-transparent px-1 text-right" />
    </div>
  );
}
