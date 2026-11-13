"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { girderReactions, listGirderDesigns } from "@/app/actions/design";
import type { GirderLink, GirderSide } from "@/lib/design/stm/cap-loads";
import { bearingsFromLink } from "@/lib/design/stm/templates";
import type { StmInputs, StmResult } from "@/lib/design/stm/strut-tie";
import { Field, fmt, Toggle } from "./design-kit";

// Loads on a pier cap from girder designs: each span's girders and dead load reactions copied from
// a girder design (refreshed on request, not live), the bridge placed on the cap, and the nodes the
// bearing loads go to. The live load is placed lane by lane across the roadway by the design.

/** Where the bridge's centerline most likely crosses the cap: a standard cap's columns, else the supports, else the cap's middle (ft). */
const capCenter = (inputs: StmInputs) => {
  const cols = inputs.template?.columns ?? [];
  const xs = cols.length ? cols : inputs.supports.filter((s) => s.y).map((s) => inputs.nodes.find((n) => n.label === s.node)?.x).filter((x): x is number => x !== undefined);
  if (xs.length) return Math.round(((Math.min(...xs) + Math.max(...xs)) / 2) * 100) / 100;
  const ox = inputs.outline.map((p) => p[0]);
  return ox.length ? Math.round(((Math.min(...ox) + Math.max(...ox)) / 2) * 100) / 100 : 0;
};

const NEW_LINK = (inputs: StmInputs): GirderLink => {
  const top = Math.max(...inputs.nodes.map((n) => n.y));
  const loadNodes = inputs.nodes.filter((n) => Math.abs(n.y - top) < 1.5);
  // The soffit: the highest corner of the outline below the load nodes (the cap's underside, not the column's foot).
  const lowest = Math.min(...loadNodes.map((n) => n.y));
  const below = inputs.outline.map((p) => p[1]).filter((y) => y < lowest - 1);
  return { enabled: true, back: null, ahead: null, x0: capCenter(inputs), reverse: false, loadNodes: loadNodes.map((n) => n.label), selfWeight: true, soffit: below.length ? Math.max(...below) : Math.min(...inputs.outline.map((p) => p[1])), wc: 0.15 };
};

export function StmGirderPanel({ inputs, onChange, result }: { inputs: StmInputs; onChange: (g: GirderLink | null) => void; result: StmResult | null }) {
  const [designs, setDesigns] = useState<{ id: string; name: string; spans: number[] }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const link = inputs.girders;
  useEffect(() => {
    if (!link?.enabled || designs) return;
    listGirderDesigns()
      .then(setDesigns)
      .catch(() => toast.error("Could not list the girder designs"));
  }, [link?.enabled, designs]);

  if (!link?.enabled)
    return (
      <div className="text-xs">
        <Toggle label="Take the loads from girder designs" value={false} onChange={(v) => v && onChange(link ? { ...link, enabled: true } : NEW_LINK(inputs))} />
        <p className="text-[11px] text-muted-foreground">Copies each span&apos;s girders and dead load reactions from an LRFD Bridge Design Check, and places the HL-93 live load lane by lane across the cap.</p>
      </div>
    );

  const fetchSide = async (which: "back" | "ahead", designId: string, span: number) => {
    setBusy(which);
    try {
      const side = await girderReactions(designId, span, which === "back" ? "end" : "start");
      let next: GirderLink = { ...link, [which]: side };
      // Girders off the cap: the bridge isn't placed on this cap yet. Center it on the cap's columns.
      const ox = inputs.outline.map((p) => p[0]);
      const off = (l: GirderLink) => bearingsFromLink(l).some((x) => x < Math.min(...ox) || x > Math.max(...ox));
      if (ox.length && off(next)) {
        next = { ...next, x0: capCenter(inputs) };
        toast[off(next) ? "error" : "success"](off(next) ? "The girders are wider than the cap: check the cap's length." : `Bridge centered on the cap: its centerline set at x = ${next.x0} ft. Rebuild a standard cap with "Positions from the girder link" to put nodes under the girders.`);
      }
      onChange(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that girder design");
    } finally {
      setBusy(null);
    }
  };
  const refresh = async () => {
    setBusy("refresh");
    try {
      const [back, ahead] = await Promise.all([link.back ? girderReactions(link.back.designId, link.back.span, "end") : null, link.ahead ? girderReactions(link.ahead.designId, link.ahead.span, "start") : null]);
      onChange({ ...link, back, ahead });
      toast.success("Reactions refreshed from the girder designs");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not refresh");
    } finally {
      setBusy(null);
    }
  };

  const sideRow = (which: "back" | "ahead", label: string, side: GirderSide | null) => (
    <div className="mb-2 rounded border border-border/60 p-1.5 text-xs">
      <p className="mb-1 font-medium">{label}</p>
      <div className="grid grid-cols-[1fr_5.5rem] gap-1">
        <select
          value={side?.designId ?? ""}
          onChange={(e) => (e.target.value ? void fetchSide(which, e.target.value, 0) : onChange({ ...link, [which]: null }))}
          className="h-6 rounded border border-input bg-transparent text-xs"
          disabled={!designs || !!busy}
        >
          <option value="">{designs ? "None" : "Loading…"}</option>
          {designs?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={side?.span ?? 0} onChange={(e) => side && void fetchSide(which, side.designId, Number(e.target.value))} className="h-6 rounded border border-input bg-transparent text-xs" disabled={!side || !!busy}>
          {(designs?.find((d) => d.id === side?.designId)?.spans ?? [0]).map((L, k) => (
            <option key={k} value={k}>
              Span {k + 1}
              {L ? ` (${fmt(L, 1)} ft)` : ""}
            </option>
          ))}
        </select>
      </div>
      {busy === which && <Loader2 className="mt-1 size-3.5 animate-spin" />}
      {side && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {side.n} girders at {fmt(side.S)} ft, {fmt(side.L)} ft span{side.skew ? `, skew ${fmt(side.skew)}°` : ""}. Per girder at the pier: DC {fmt(side.dc.interior, 1)} / {fmt(side.dc.exterior, 1)} kip, DW {fmt(side.dw.interior, 1)} / {fmt(side.dw.exterior, 1)} kip (interior / exterior).
          {side.continuous && " Its girders are continuous; reactions are taken as for simple spans."}
        </p>
      )}
    </div>
  );

  const cl = result?.capLoads;
  return (
    <div className="text-xs">
      <Toggle label="Take the loads from girder designs" value onChange={(v) => !v && onChange({ ...link, enabled: false })} />
      {sideRow("back", "Back span", link.back)}
      {sideRow("ahead", "Ahead span", link.ahead)}
      {(link.back || link.ahead) && (
        <button type="button" onClick={() => void refresh()} disabled={!!busy} className="mb-1 flex items-center gap-1 text-xs text-primary hover:underline">
          <RefreshCw className="size-3" /> Refresh from the girder designs
        </button>
      )}
      <Field label="Cap x at the bridge's centerline" unit="ft" value={link.x0} onChange={(x0) => onChange({ ...link, x0 })} step={0.1} />
      <Toggle label="Bridge's left side at larger cap x" value={link.reverse} onChange={(reverse) => onChange({ ...link, reverse })} />
      <div className="py-1">
        <p className="text-muted-foreground">Nodes that take the bearing loads</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
          {inputs.nodes.map((n) => (
            <label key={n.label} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={link.loadNodes.includes(n.label)}
                onChange={(e) => onChange({ ...link, loadNodes: e.target.checked ? [...link.loadNodes, n.label] : link.loadNodes.filter((l) => l !== n.label) })}
              />
              {n.label}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Each bearing&apos;s load is split between the two load nodes either side of it, by statics. Put load nodes under the bearings where you can.</p>
      </div>
      <Toggle label="Add the cap's own weight" value={link.selfWeight} onChange={(selfWeight) => onChange({ ...link, selfWeight })} />
      {link.selfWeight && (
        <>
          <Field label="Cap soffit (concrete above it counts)" unit="ft" value={link.soffit} onChange={(soffit) => onChange({ ...link, soffit })} step={0.1} />
          <Field label="Unit weight" unit="kcf" value={link.wc} onChange={(wc) => onChange({ ...link, wc })} step={0.005} />
        </>
      )}
      <Toggle label="Wind across the bridge (Strength III, V and Service I)" value={!!link.wind?.enabled} onChange={(enabled) => onChange({ ...link, wind: { enabled } })} />
      {link.wind?.enabled && (
        <p className="text-[11px] text-muted-foreground">
          From each girder design&apos;s site wind (its &quot;Loads to the substructure&quot;):{" "}
          {[link.back, link.ahead]
            .filter((s): s is GirderSide => !!s)
            .map((s) => (s.wind && s.wind.lineIII !== null ? `${s.name}: ${fmt(s.wind.lineIII, 2)} klf at ${s.wind.V} mph, exposure ${s.wind.exposure}, ${fmt(s.wind.depth, 2)} ft deep` : `${s.name}: no site wind given yet`))
            .join("; ")}
          . Refresh after changing it there.
        </p>
      )}
      {cl && (
        <div className="mt-1 rounded bg-muted/40 p-1.5 text-[11px]">
          <p>
            Roadway {fmt(cl.roadway, 2)} ft: up to {cl.lanesMax} lane{cl.lanesMax > 1 ? "s" : ""}, {cl.arrangements} arrangements. Per lane at the pier: {fmt(cl.lane.truck.back + cl.lane.truck.ahead, 1)} kip ({cl.lane.kind}, with IM) and {fmt(cl.lane.lane.back + cl.lane.lane.ahead, 1)} kip of lane load.
            {link.selfWeight ? ` Cap weight ${fmt(cl.selfWeight, 1)} kip.` : ""}
          </p>
          <p className="pt-1 font-medium">{cl.cases.length} cases:</p>
          {cl.caseInfo.map((c) => (
            <p key={c.name}>
              {c.name}: {c.reason}.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
