"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { buildBridgeModel, syncBridge, type SyncRow } from "@/app/actions/bridge-record";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { bearingText, stationText } from "@/lib/design/bridge/alignment";
import { PIER_DEFAULTS, runBridge, spanGroups, type BridgeInputs } from "@/lib/design/bridge/bridge";
import type { GirderInputs } from "@/lib/design/girders/prestressed";
import { GIRDER_SHAPES } from "@/lib/design/girders/sections";
import { DesignError } from "@/lib/design/walls/cip";
import { BridgePlan, BridgeProfile } from "./bridge-sketch";
import { DesignErrorCard, DesignHeader, fmt, KeyValues, Section } from "./design-kit";
import { FieldView } from "./foundation-editor";
import type { FieldSpec, SectionSpec } from "./foundation-specs";

// The Bridge: entered as PGSuper's Alignment and Bridge Description dialogs take it (the alignment,
// profile and roadway section; the supports; the girders and deck) on the left; its layout, the
// girder check run with it, the reactions at each support and its linked designs on the right, where
// "Update the components" passes the loads down the load path (docs/bridge-model.md).

type Inputs = Record<string, unknown>;
const get = (o: Inputs, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Inputs)[k] : undefined), o);
function setPath(o: Inputs, path: string, v: unknown): Inputs {
  const [k, ...rest] = path.split(".");
  const child = rest.length ? setPath(((o as Record<string, unknown>)[k] as Inputs) ?? {}, rest.join("."), v) : v;
  if (Array.isArray(o)) {
    const a = [...o];
    a[Number(k)] = child;
    return a as unknown as Inputs;
  }
  return { ...o, [k]: child };
}

const supportTypes = [
  { value: "integral-abutment", label: "Integral abutment" },
  { value: "semi-integral-abutment", label: "Semi-integral abutment" },
  { value: "seat-abutment", label: "Seat abutment" },
  { value: "continuous-pier", label: "Pier, girders continuous" },
  { value: "simple-pier", label: "Pier, girders simple (joint)" },
];

const SPEC: SectionSpec[] = [
  {
    title: "Alignment (horizontal)",
    open: true,
    fields: [
      { type: "number", key: "alignment.refStation", label: "Reference station", unit: "ft" },
      { type: "number", key: "alignment.northing", label: "Northing", unit: "ft" },
      { type: "number", key: "alignment.easting", label: "Easting", unit: "ft" },
      { type: "number", key: "alignment.azimuth", label: "Back tangent's bearing (azimuth)", unit: "deg", step: 0.0001, hint: "Clockwise from north: 90 is due east" },
      { type: "list", key: "alignment.curves", label: "Horizontal curves", note: "By the PI's station (along the stationing), the radius, the front tangent's azimuth and the entry and exit spirals' lengths (clothoids; 0 for a simple circular curve).", columns: [{ key: "pi", label: "PI station" }, { key: "radius", label: "R ft" }, { key: "azimuth", label: "Ahead azimuth°" }, { key: "spiralIn", label: "Entry spiral ft" }, { key: "spiralOut", label: "Exit spiral ft" }], blank: { pi: 1150, radius: 2000, azimuth: 95, spiralIn: 0, spiralOut: 0 } },
    ],
  },
  {
    title: "Profile (vertical)",
    open: true,
    fields: [
      { type: "number", key: "profile.station", label: "Station", unit: "ft" },
      { type: "number", key: "profile.elevation", label: "Elevation", unit: "ft", step: 0.01 },
      { type: "number", key: "profile.grade", label: "Grade leaving it", unit: "%", step: 0.01 },
      { type: "list", key: "profile.curves", label: "Vertical curves", note: "By the PVI's station, the grade leaving it (%) and the curve's length (symmetric parabolas).", columns: [{ key: "pvi", label: "PVI station" }, { key: "grade", label: "Exit grade %" }, { key: "length", label: "L ft" }], blank: { pvi: 1150, grade: 0, length: 200 } },
    ],
  },
  {
    title: "Roadway section (crown and superelevation)",
    fields: [
      { type: "number", key: "roadway.leftSlope", label: "Left slope (− falls to the left)", unit: "ft/ft", step: 0.005 },
      { type: "number", key: "roadway.rightSlope", label: "Right slope (− falls to the right)", unit: "ft/ft", step: 0.005 },
      { type: "number", key: "roadway.crownOffset", label: "Crown point's offset from the alignment", unit: "ft", step: 0.5 },
      {
        type: "list",
        key: "roadway.sections",
        label: "Superelevation (roadway section templates)",
        note: "Roadway section templates: the slopes and the crown's offset at stations, straight-line between them (the transitions), constant before the first and after the last. None: the section above everywhere.",
        columns: [
          { key: "station", label: "Station" },
          { key: "leftSlope", label: "Left ft/ft" },
          { key: "rightSlope", label: "Right ft/ft" },
          { key: "crownOffset", label: "Crown offset ft" },
        ],
        blank: { station: 1000, leftSlope: -0.02, rightSlope: -0.02, crownOffset: 0 },
      },
    ],
  },
  {
    title: "Supports (abutments and piers)",
    open: true,
    fields: [
      {
        type: "list",
        key: "supports",
        label: "From the first abutment to the last",
        note: "Skew: the support line from the alignment's normal, + clockwise. End distance along the girder; bearing offset normal to the support. Spacing: the girder spacing at the support (0: the bridge's); spacings that differ flare the girders.",
        columns: [
          { key: "name", label: "Name", kind: "text", width: "6rem" },
          { key: "station", label: "Station" },
          { key: "skew", label: "Skew°" },
          { key: "type", label: "Type", kind: "choice", options: supportTypes, width: "10rem" },
          { key: "endDistance", label: "End dist. ft" },
          { key: "bearingOffset", label: "Brg offset ft" },
          { key: "bearingHeight", label: "Brg height in" },
          { key: "spacing", label: "Spacing ft" },
        ],
        blank: { name: "Pier", station: 0, skew: 0, type: "continuous-pier", endDistance: 0.75, bearingOffset: 1, bearingHeight: 2, spacing: 0 },
      },
    ],
  },
  {
    title: "Girders and deck",
    open: true,
    fields: [
      { type: "choice", key: "shape", label: "Girder", options: GIRDER_SHAPES.map((s) => ({ value: s.id, label: s.name })) },
      { type: "number", key: "nGirders", label: "Girders" },
      { type: "number", key: "spacing", label: "Spacing, normal to the alignment", unit: "ft", step: 0.25 },
      { type: "number", key: "bridgeLineOffset", label: "Bridge line from the alignment (+ right)", unit: "ft", step: 0.5 },
      { type: "number", key: "leftEdge", label: "Bridge line to the deck's left edge", unit: "ft", step: 0.25 },
      { type: "number", key: "rightEdge", label: "Bridge line to the deck's right edge", unit: "ft", step: 0.25 },
      {
        type: "choice",
        key: "rail.type",
        label: "Bridge rail (CDOT B-606)",
        options: [
          { value: "custom", label: "Custom barrier (width below)" },
          { value: "type9-4", label: "Type 9 (#4 option)" },
          { value: "type9-3", label: "Type 9 (#3 option)" },
          { value: "type10-mash", label: "Type 10 MASH" },
        ],
      },
      { type: "number", key: "barrierWidth", label: "Deck edge to the barrier's face", unit: "ft", step: 0.25 },
      { type: "number", key: "deckT", label: "Deck thickness", unit: "in", step: 0.25 },
      { type: "number", key: "sacrificial", label: "Sacrificial depth", unit: "in", step: 0.25 },
      { type: "number", key: "slabOffset", label: "Slab offset \"A\" at the bearings", unit: "in", step: 0.25 },
      { type: "number", key: "fcDeck", label: "Deck f'c", unit: "ksi", step: 0.5 },
      { type: "number", key: "fws", label: "Future wearing surface", unit: "psf" },
    ],
  },
];

export function BridgeEditor({
  design,
  projects,
  girders,
  candidates,
}: {
  design: { id: string; name: string; projectId: string | null; inputs: BridgeInputs };
  projects: { id: string; name: string }[];
  girders: (GirderInputs | null)[];
  candidates: Record<string, { id: string; name: string }[]>;
}) {
  const [inputs, setInputs] = useState(design.inputs);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SyncRow[] | null>(null);
  const set = (path: string, v: unknown) => setInputs((s) => setPath(s as unknown as Inputs, path, v) as unknown as BridgeInputs);
  const outcome = useMemo(() => {
    try {
      return { r: runBridge(inputs, girders), error: null };
    } catch (err) {
      return { r: null, error: err instanceof DesignError ? err.message : "This bridge can't be worked out" };
    }
  }, [inputs, girders]);
  const r = outcome.r;
  const groups = spanGroups(inputs);
  const comp = (i: number) => inputs.components.find((c) => c.support === i) ?? { support: i };
  const setComp = (i: number, patch: Record<string, unknown>) => setInputs((s) => ({ ...s, components: [...s.components.filter((c) => c.support !== i), { ...comp(i), ...patch }] }));
  const pick = (label: string, kind: string, value: string | null | undefined, onChange: (v: string | null) => void) => (
    <label className="grid grid-cols-[8rem_1fr] items-center gap-2 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select className="h-7 min-w-0 rounded-md border border-input bg-transparent px-1" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">None (create it)</option>
        {(candidates[kind] ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
  const sync = async (create: boolean) => {
    setBusy(true);
    try {
      const out = await syncBridge(design.id, inputs, create);
      setInputs(out.inputs);
      setReport(out.rows);
      toast.success("The components are up to date with the bridge");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the components");
    } finally {
      setBusy(false);
    }
  };
  const [model, setModel] = useState<{ link: string; elements: number } | null>(null);
  const buildModel = async () => {
    setBusy(true);
    try {
      const out = await buildBridgeModel(design.id, inputs);
      if ("error" in out) toast.error(out.error);
      else {
        setModel(out);
        toast.success(`The IFC model is built: ${out.elements} elements`);
      }
    } catch {
      toast.error("Could not build the IFC model");
    } finally {
      setBusy(false);
    }
  };
  const allChecks = r ? r.groups.flatMap((g) => [...g.result.spans.flatMap((s) => [...s.interior.checks, ...s.exterior.checks]), ...g.result.piers.flatMap((p) => [...p.interior.checks, ...p.exterior.checks])]) : [];
  const failing = allChecks.filter((c) => !c.ok && !c.advisory);
  return (
    <div className="space-y-4">
      <DesignHeader design={design} projects={projects} inputs={inputs} label="Bridge · alignment, layout, girder check and load path" canMakeCalc />
      <div className="grid gap-4 lg:grid-cols-[minmax(340px,440px)_1fr]">
        <Card className="self-start">
          <CardContent className="py-2">
            {SPEC.map((sec) => (
              <Section key={sec.title} title={sec.title} open={sec.open}>
                {sec.fields.map((f, k) => (
                  <FieldView key={`${f.key}-${k}`} spec={f} inputs={inputs as unknown as Inputs} set={set} />
                ))}
              </Section>
            ))}
            <Section title="Piers" open>
              {inputs.supports.map((s, i) =>
                s.type.endsWith("pier") ? (
                  <div key={i} className="border-b pb-1 last:border-b-0">
                    <div className="py-1 text-xs font-medium">{s.name}</div>
                    {s.pier ? (
                      (
                        [
                          { type: "choice", key: `supports.${i}.pier.kind`, label: "Cap", options: [{ value: "multicolumn", label: "Multicolumn bent" }, { value: "hammerhead", label: "Hammerhead" }] },
                          { type: "number", key: `supports.${i}.pier.capLength`, label: "Cap length (along the support)", unit: "ft", step: 0.5 },
                          { type: "number", key: `supports.${i}.pier.capDepth`, label: "Cap depth", unit: "ft", step: 0.25 },
                          { type: "number", key: `supports.${i}.pier.capWidth`, label: "Cap width (along the bridge)", unit: "in" },
                          { type: "number", key: `supports.${i}.pier.columns`, label: "Columns", show: () => s.pier!.kind === "multicolumn" },
                          { type: "number", key: `supports.${i}.pier.columnSpacing`, label: "Column spacing", unit: "ft", step: 0.5, show: () => s.pier!.kind === "multicolumn" },
                          { type: "choice", key: `supports.${i}.pier.columnShape`, label: "Column", options: [{ value: "round", label: "Round" }, { value: "rectangular", label: "Rectangular" }] },
                          { type: "number", key: `supports.${i}.pier.columnSize`, label: "Column diameter or width", unit: "in" },
                          { type: "number", key: `supports.${i}.pier.columnDepth`, label: "Column depth (along the bridge)", unit: "in", show: () => s.pier!.columnShape === "rectangular" },
                          { type: "number", key: `supports.${i}.pier.foundationTop`, label: "Top of footing or shaft, elevation (0: 20 ft below the cap)", unit: "ft", step: 0.5 },
                          { type: "choice", key: `supports.${i}.pier.foundation`, label: "Foundation", options: [{ value: "spread-footing", label: "Spread footing" }, { value: "pile-foundation", label: "Pile foundation" }, { value: "drilled-shaft", label: "Drilled shaft" }] },
                        ] as FieldSpec[]
                      ).map((f, k) => <FieldView key={k} spec={f} inputs={inputs as unknown as Inputs} set={set} />)
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => set(`supports.${i}.pier`, PIER_DEFAULTS)}>
                        Describe this pier
                      </Button>
                    )}
                  </div>
                ) : null,
              )}
            </Section>
            <Section title="Linked designs" open>
              {groups.map((g, gi) => pick(`Girders, span${g.length > 1 ? "s" : ""} ${g.map((j) => j + 1).join("–")}`, "lrfd-girder-check", inputs.girderDesignIds[gi], (v) => setInputs((s) => ({ ...s, girderDesignIds: groups.map((_, k) => (k === gi ? v : (s.girderDesignIds[k] ?? null))) }))))}
              {pick("Deck, overhang and rail", "deck-slab", inputs.deckDesignId, (v) => setInputs((s) => ({ ...s, deckDesignId: v })))}
              {inputs.supports.map((s, i) =>
                s.type.endsWith("abutment") ? (
                  <div key={i} className="border-t pt-1">
                    {pick(`${s.name}, bearings`, "elastomeric-bearing", comp(i).bearingId, (v) => setComp(i, { bearingId: v }))}
                    {pick(s.name, "abutment", comp(i).abutmentId, (v) => setComp(i, { abutmentId: v }))}
                    {pick(`${s.name}, approach slab`, "approach-slab", comp(i).approachSlabId, (v) => setComp(i, { approachSlabId: v }))}
                    {pick(`${s.name}, wingwall`, "cantilever-wingwall", comp(i).wingwallId, (v) => setComp(i, { wingwallId: v }))}
                  </div>
                ) : (
                  <div key={i} className="border-t pt-1">
                    {pick(`${s.name}, bearings`, "elastomeric-bearing", comp(i).bearingId, (v) => setComp(i, { bearingId: v }))}
                    {pick(`${s.name}, cap`, "stm-d-region", comp(i).capId, (v) => setComp(i, { capId: v }))}
                    {pick(`${s.name}, column`, "pier-column", comp(i).columnId, (v) => setComp(i, { columnId: v }))}
                    {s.pier && pick(`${s.name}, foundation`, s.pier.foundation, comp(i).foundationKind === s.pier.foundation ? comp(i).foundationId : null, (v) => setComp(i, { foundationId: v, foundationKind: s.pier!.foundation }))}
                  </div>
                ),
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" onClick={() => sync(false)} disabled={busy || !r}>
                  {busy && <Loader2 className="animate-spin" />} Update the components
                </Button>
                <Button size="sm" variant="outline" onClick={() => sync(true)} disabled={busy || !r}>
                  Create the missing designs
                </Button>
              </div>
            </Section>
            <Section title="IFC model" open>
              <p className="text-xs text-muted-foreground">
                An IFC 4.3 model of the bridge: the alignment, the bridge&apos;s parts and every element (girders, bearings, deck, abutments, approach slabs, pier caps, columns, footings, piles and shafts) at its designed size and place, from the linked designs. It&apos;s saved as a new 3D model in the Bridge&apos;s project.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={buildModel} disabled={busy || !r}>
                  Build the IFC model
                </Button>
                {model && (
                  <Link className="text-xs underline" href={model.link}>
                    Open the model ({model.elements} elements)
                  </Link>
                )}
              </div>
            </Section>
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-4">
          {outcome.error ? (
            <DesignErrorCard message={outcome.error} />
          ) : (
            r && (
              <>
                <div className={`rounded-md border px-3 py-2 text-sm ${failing.length ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
                  Girder check from the bridge&apos;s layout: {failing.length ? `${failing.length} of ${allChecks.filter((c) => !c.advisory).length} checks fail (${[...new Set(failing.map((c) => c.name))].slice(0, 3).join("; ")})` : `all ${allChecks.filter((c) => !c.advisory).length} checks pass`} across {r.groups.length} girder design{r.groups.length > 1 ? "s" : ""}, interior and exterior girders.
                </div>
                <Card>
                  <CardContent className="space-y-2 py-3">
                    <BridgePlan b={inputs} lay={r.layout} />
                    <BridgeProfile b={inputs} lay={r.layout} />
                  </CardContent>
                </Card>
                <div className="grid gap-4 xl:grid-cols-2">
                  <KeyValues
                    title="Supports"
                    rows={r.layout.supports.map((s) => [`${s.name}, ${stationText(s.station)}`, `${bearingText(s.az)}; skew ${fmt(s.skew)}°; grade ${fmt(s.grade * 100, 3)} %`] as [string, string])}
                  />
                  <KeyValues
                    title="Spans, bearing to bearing (the longest girder)"
                    rows={r.layout.spans.map((s) => [`${s.from} to ${s.to}`, `${fmt(s.L)} ft; skew ${fmt(s.skew)}°; profile ordinate ${fmt(s.girders[0].ordinate, 2)} in`] as [string, string])}
                  />
                  <KeyValues
                    title="Bearing seat elevations, exterior girders (left / right)"
                    rows={r.layout.supports.map((s, k) => {
                      const sp = k < r.layout.spans.length ? r.layout.spans[k] : r.layout.spans[k - 1];
                      const end = k < r.layout.spans.length ? "start" : "end";
                      const gl = sp.girders[0][end];
                      const gr = sp.girders[sp.girders.length - 1][end];
                      return [s.name, `deck ${fmt(gl.deck, 3)} / ${fmt(gr.deck, 3)}; seat ${fmt(gl.seat, 3)} / ${fmt(gr.seat, 3)} ft`] as [string, string];
                    })}
                  />
                  <KeyValues
                    title="Reactions per girder (kip): DC, DW, LL, LL + IM"
                    rows={r.reactions.map((x) => [`${x.name}${x.continuous ? " (continuous)" : ""}`, `${fmt(x.DC, 1)}, ${fmt(x.DW, 1)}, ${fmt(x.LL, 1)}, ${fmt(x.LLIM, 1)}`] as [string, string])}
                  />
                </div>
                {report && (
                  <Card>
                    <CardContent className="py-3 text-xs">
                      <div className="mb-2 text-sm font-semibold">Load path: the components updated from the bridge</div>
                      <table className="w-full">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="py-1">Component</th>
                            <th>Design</th>
                            <th>Action</th>
                            <th>What changed</th>
                            <th>Verdict</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.map((row, k) => (
                            <tr key={k} className="border-t align-top">
                              <td className="py-1 pr-2">{row.component}</td>
                              <td className="pr-2">{row.designId ? <Link className="underline" href={`/design/${row.designId}`}>{row.name}</Link> : "—"}</td>
                              <td className="pr-2">{row.action}</td>
                              <td className="pr-2">{row.changes.join(", ") || "—"}</td>
                              <td>{row.verdict}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export const bridgeFieldValue = get;
