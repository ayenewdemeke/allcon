"use client";

import { useMemo } from "react";
import { fmt, KeyValues } from "@/components/design/design-kit";
import type { BridgeAnalysis, Selection } from "@/lib/bridge/bridge";
import type { BridgeDefinition } from "@/lib/bridge/definition";
import type { Member } from "@/lib/bridge/generate";
import type { Model } from "@/lib/bridge/model";
import type { LiveLoad } from "@/lib/bridge/moving";
import { customShape, shapeById } from "@/lib/design/girders/sections";
import { cn } from "@/lib/utils";
import { Diagram } from "./diagram";

// The workspace's tables panel: a member's diagrams and forces, the reactions, and the checks
// (midas Civil's result tables and message window).

const th = "px-2 py-1 text-right font-medium";
const td = "px-2 py-0.5 text-right";

export function MemberPanel({ a, member, sel, live }: { a: BridgeAnalysis; member: Member; sel: Selection; live: LiveLoad | null }) {
  const stations = useMemo(() => a.member(member, sel, 4, live), [a, member, sel, live]);
  const ends = useMemo(() => a.member(member, sel, 1, live), [a, member, sel, live]);
  const env = !!stations[0]?.max;
  // Each element's two ends, the shared ones once.
  const rows = ends.filter((_, k) => k === 0 || k === ends.length - 1 || k % 2 === 1);
  const band = (c: "My" | "Vz" | "N") => (env ? stations.map((s) => ({ x: s.x, max: s.max![c], min: s.min![c] })) : undefined);
  const where = member.kind === "girder" ? "Along the span from its first support." : member.kind === "cap" ? "Across the bridge, from the first girder's side." : "From the base up.";
  return (
    <div className="grid gap-x-6 gap-y-2 p-3 xl:grid-cols-2">
      <div className="space-y-2">
        <p className="text-xs">
          <span className="font-semibold">{member.name}</span> <span className="text-muted-foreground">· {where}{env ? " Solid lines: the envelope with live load; dashed: the permanent loads." : ""}</span>
        </p>
        <Diagram title="Moment" unit="kip·ft, sagging below the line" points={stations.map((s) => ({ x: s.x, v: s.forces.My }))} band={band("My")} flip />
        <Diagram title="Shear" unit="kip" points={stations.map((s) => ({ x: s.x, v: s.forces.Vz }))} band={band("Vz")} color="#b45309" />
        {member.kind === "column" ? (
          <Diagram title="Axial force" unit="kip, compression −" points={stations.map((s) => ({ x: s.x, v: s.forces.N }))} band={band("N")} color="#475569" />
        ) : (
          <Diagram title="Deflection, permanent loads" unit="in, down −" points={stations.map((s) => ({ x: s.x, v: s.dz * 12 }))} color="#475569" />
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-1 pr-2 text-left font-medium">x (ft)</th>
              {env ? (
                <>
                  <th className={th}>M max</th>
                  <th className={th}>M min</th>
                  <th className={th}>V max</th>
                  <th className={th}>V min</th>
                  {member.kind === "column" && <th className={th}>N min</th>}
                </>
              ) : (
                <>
                  <th className={th}>Moment (kip·ft)</th>
                  <th className={th}>Shear (kip)</th>
                  <th className={th}>Axial (kip)</th>
                  <th className={th}>Torsion (kip·ft)</th>
                </>
              )}
              <th className={th}>Deflection (in)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, k) => (
              <tr key={k} className="border-b border-border/40">
                <td className="py-0.5 pr-2">{fmt(s.x, 2)}</td>
                {env ? (
                  <>
                    <td className={td}>{fmt(s.max!.My, 1)}</td>
                    <td className={td}>{fmt(s.min!.My, 1)}</td>
                    <td className={td}>{fmt(s.max!.Vz, 1)}</td>
                    <td className={td}>{fmt(s.min!.Vz, 1)}</td>
                    {member.kind === "column" && <td className={td}>{fmt(s.min!.N, 1)}</td>}
                  </>
                ) : (
                  <>
                    <td className={td}>{fmt(s.forces.My, 1)}</td>
                    <td className={td}>{fmt(s.forces.Vz, 1)}</td>
                    <td className={td}>{fmt(s.forces.N, 1)}</td>
                    <td className={td}>{fmt(s.forces.T, 1)}</td>
                  </>
                )}
                <td className={td}>{(s.dz * 12).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {env && <p className="pt-1 text-[11px] text-muted-foreground">Moments in kip·ft, forces in kip. Each maximum and minimum is its own loading (an envelope).</p>}
      </div>
    </div>
  );
}

export function ReactionsPanel({ a, sel, def, live }: { a: BridgeAnalysis; sel: Selection; def: BridgeDefinition; live: LiveLoad | null }) {
  const bearings = useMemo(() => a.bearings(sel, live), [a, sel, live]);
  const reactions = useMemo(() => a.reactions(sel), [a, sel]);
  const lines = def.supports.map((_, k) => k + 1);
  const lineName = (k: number) => (k === 1 ? "Abutment 1" : k === lines.length ? "Abutment 2" : `Pier ${k - 1}`);
  const girders = Array.from({ length: def.nGirders }, (_, k) => k + 1);
  const bases = reactions.filter((r) => r.node >= 400000 && r.node < 500000);
  const env = bearings[0]?.max !== undefined;
  return (
    <div className="space-y-4 p-3 text-xs">
      <div>
        <p className="pb-1 font-semibold">Bearing reactions, vertical (kip){env ? ": permanent loads, then the largest and smallest with live load" : ""}</p>
        <div className="overflow-x-auto">
          <table className="w-full tabular-nums">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1 pr-2 text-left font-medium">Support</th>
                {env && <th className="px-2 text-left font-medium" />}
                {girders.map((g) => (
                  <th key={g} className={th}>
                    G{g}
                  </th>
                ))}
                <th className={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.flatMap((k) => {
                const row = bearings.filter((b) => b.support === k);
                const line = (label: string, value: (b: (typeof row)[0]) => number, total: boolean) => (
                  <tr key={`${k}-${label}`} className="border-b border-border/40">
                    <td className="py-0.5 pr-2">{label === "max" || label === "min" ? "" : lineName(k)}</td>
                    {env && <td className="px-2 text-muted-foreground">{label}</td>}
                    {girders.map((g) => (
                      <td key={g} className={td}>
                        {fmt(value(row.find((b) => b.girder === g)!), 1)}
                      </td>
                    ))}
                    <td className={cn(td, "font-medium")}>{total ? fmt(row.reduce((s, b) => s + value(b), 0), 1) : ""}</td>
                  </tr>
                );
                return env ? [line("permanent", (b) => b.vertical, true), line("max", (b) => b.max!, false), line("min", (b) => b.min!, false)] : [line("permanent", (b) => b.vertical, true)];
              })}
            </tbody>
          </table>
        </div>
      </div>
      {bases.length > 0 && (
        <div>
          <p className="pb-1 font-semibold">Pier column bases, permanent loads</p>
          <table className="w-full tabular-nums">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1 pr-2 text-left font-medium">Column</th>
                <th className={th}>Vertical (kip)</th>
                <th className={th}>Along the bridge (kip)</th>
                <th className={th}>Across (kip)</th>
                <th className={th}>Moment about the bridge&apos;s axis (kip·ft)</th>
                <th className={th}>Moment about the cross axis (kip·ft)</th>
              </tr>
            </thead>
            <tbody>
              {bases.map((r) => (
                <tr key={r.node} className="border-b border-border/40">
                  <td className="py-0.5 pr-2">
                    Pier {Math.floor((r.node - 400000) / 1000)}, column {(r.node % 1000) + 1}
                  </td>
                  <td className={td}>{fmt(r.R[2], 1)}</td>
                  <td className={td}>{fmt(r.R[0], 1)}</td>
                  <td className={td}>{fmt(r.R[1], 1)}</td>
                  <td className={td}>{fmt(r.R[3], 1)}</td>
                  <td className={td}>{fmt(r.R[4], 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pt-1 text-[11px] text-muted-foreground">With live load, see each column under Members (its axial force and moments with their envelope).</p>
        </div>
      )}
    </div>
  );
}

export function ChecksPanel({ a, live }: { a: BridgeAnalysis; live: LiveLoad | null }) {
  const p = a.generated.properties;
  return (
    <div className="grid gap-4 p-3 text-xs xl:grid-cols-2">
      <div className="space-y-2">
        <p className={cn("font-semibold", a.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600")}>{a.ok ? "Every load case is in equilibrium: the reactions equal the load applied." : "A load case is not in equilibrium: don't use these results."}</p>
        <table className="w-full tabular-nums">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-1 pr-2 text-left font-medium">Load case</th>
              <th className="px-2 text-left font-medium">Type</th>
              <th className="px-2 text-left font-medium">Acts on</th>
              <th className={th}>Applied (kip)</th>
              <th className={th}>Reactions (kip)</th>
              <th className="pl-2" />
            </tr>
          </thead>
          <tbody>
            {a.checks.map((c, k) => (
              <tr key={c.name} className="border-b border-border/40">
                <td className="py-0.5 pr-2">{c.name}</td>
                <td className="px-2">{a.cases[k].type}</td>
                <td className="px-2">{a.cases[k].stage === 1 ? "Girders alone, simple spans" : "Composite bridge"}</td>
                <td className={td}>{fmt(c.applied, 2)}</td>
                <td className={td}>{fmt(c.reactions, 2)}</td>
                <td className={cn("pl-2 font-medium", c.ok ? "text-emerald-600" : "text-red-600")}>{c.ok ? "OK" : "NG"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {live && (
          <p className="text-muted-foreground">
            Live load: HL-93 in {live.arrangements[0].length} design lane{live.arrangements[0].length === 1 ? "" : "s"} of 12 ft (tried against either barrier and centered), a unit axle moved to {live.positions.length} positions along each for the influence lines; dynamic allowance{" "}
            {Math.round(live.IM * 100)}% on the truck and tandem; multiple presence 1.2, 1.0, 0.85, 0.65.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <KeyValues
          title="Section properties used"
          rows={[
            ["Girder: A, I, yb", `${fmt(p.girder.A, 1)} in², ${fmt(p.girder.I, 0)} in⁴, ${fmt(p.girder.yb, 2)} in`],
            ["Girder weight", `${fmt(p.girder.weight, 3)} klf`],
            ["Ec, girder and deck (5.4.2.4)", `${fmt(p.Ec.girder, 0)} and ${fmt(p.Ec.deck, 0)} ksi (n = ${fmt(p.n, 3)})`],
            ["Composite, interior: effective width, I, yb", `${fmt(p.composite.interior.beff, 1)} in, ${fmt(p.composite.interior.I, 0)} in⁴, ${fmt(p.composite.interior.yb, 2)} in`],
            ["Composite, exterior: effective width, I, yb", `${fmt(p.composite.exterior.beff, 1)} in, ${fmt(p.composite.exterior.I, 0)} in⁴, ${fmt(p.composite.exterior.yb, 2)} in`],
          ]}
        />
        <p className="text-muted-foreground">
          The model is a grillage of beam elements, as midas Civil&apos;s girder bridge wizard builds its &ldquo;All Frame&rdquo; model: each girder a line of elements with the composite section&apos;s properties, deck strips between them, bearings as links to the abutments and
          pier caps. The girders alone carry their weight, the deck and the diaphragms on simple spans; the composite bridge carries the barriers, the wearing surface and live load.
        </p>
      </div>
    </div>
  );
}

/** The girder with its deck, drawn to scale: the composite section an interior girder works with. */
export function SectionSketch({ def, a }: { def: BridgeDefinition; a: BridgeAnalysis }) {
  const shape = def.girder.custom ? customShape(def.girder.custom.profile, def.girder.custom.web, def.girder.custom.topWidth) : shapeById(def.girder.shape);
  if (!shape) return null;
  const p = a.generated.properties;
  const beff = Math.min(p.composite.interior.beff, def.spacing * 12);
  const ts = def.deck.thickness;
  const H = shape.depth;
  const total = H + def.deck.haunch + ts;
  const W = Math.max(beff, 2 * Math.max(...shape.profile.map((q) => q[1])));
  const k = Math.min(200 / W, 150 / total);
  const x = (v: number) => 120 + v * k;
  const y = (v: number) => 8 + (total - v) * k;
  const outline = [...shape.profile.map(([yy, h]) => `${x(h)},${y(yy)}`), ...[...shape.profile].reverse().map(([yy, h]) => `${x(-h)},${y(yy)}`)].join(" ");
  return (
    <figure className="pb-2">
      <svg viewBox={`0 0 240 ${total * k + 30}`} className="w-full text-foreground" role="img" aria-label="Composite section">
        <rect x={x(-beff / 2)} y={y(total)} width={beff * k} height={ts * k} fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="0.8" />
        {def.deck.haunch > 0 && <rect x={x(-shape.topWidth / 2)} y={y(H + def.deck.haunch)} width={shape.topWidth * k} height={def.deck.haunch * k} fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="0.5" />}
        <polygon points={outline} fill="currentColor" fillOpacity="0.28" stroke="currentColor" strokeWidth="0.8" />
        <line x1={x(-W / 2) - 4} x2={x(W / 2) + 4} y1={y(p.composite.interior.yb)} y2={y(p.composite.interior.yb)} stroke="#1b76bb" strokeDasharray="4 3" strokeWidth="0.8" />
        <text x={x(W / 2) + 4} y={y(p.composite.interior.yb) - 3} fontSize="8" textAnchor="end" fill="#1b76bb">
          composite centroid
        </text>
        <text x="120" y={total * k + 24} fontSize="9" textAnchor="middle" fill="currentColor" fillOpacity="0.7">
          {shape.name} · {fmt(H, 1)} in deep · deck {fmt(beff, 0)} × {fmt(ts, 2)} in
        </text>
      </svg>
      <figcaption className="grid grid-cols-2 gap-x-3 text-[11px] tabular-nums text-muted-foreground">
        <span>Girder A {fmt(p.girder.A, 0)} in²</span>
        <span>I {fmt(p.girder.I, 0)} in⁴</span>
        <span>Composite A {fmt(p.composite.interior.A, 0)} in²</span>
        <span>I {fmt(p.composite.interior.I, 0)} in⁴</span>
      </figcaption>
    </figure>
  );
}

/** The analysis model as tables: sections, materials, nodes and elements (midas Civil's model tables). */
export function ModelDataPanel({ model }: { model: Model }) {
  const LIMIT = 250;
  const head = (cells: string[]) => (
    <thead>
      <tr className="border-b text-muted-foreground">
        {cells.map((c, k) => (
          <th key={c} className={k === 0 ? "py-1 pr-2 text-left font-medium" : th}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
  return (
    <div className="grid gap-4 p-3 text-xs xl:grid-cols-2">
      <div className="space-y-4">
        <div>
          <p className="pb-1 font-semibold">Sections ({model.sections.length})</p>
          <table className="w-full tabular-nums">
            {head(["Section", "A (in²)", "I vertical (in⁴)", "I lateral (in⁴)", "J (in⁴)"])}
            <tbody>
              {model.sections.map((s) => (
                <tr key={s.id} className="border-b border-border/40">
                  <td className="py-0.5 pr-2">{s.id}. {s.name}</td>
                  <td className={td}>{fmt(s.A * 144, 1)}</td>
                  <td className={td}>{fmt(s.Iy * 20736, 0)}</td>
                  <td className={td}>{fmt(s.Iz * 20736, 0)}</td>
                  <td className={td}>{fmt(s.J * 20736, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="pb-1 font-semibold">Materials ({model.materials.length})</p>
          <table className="w-full tabular-nums">
            {head(["Material", "E (ksi)", "G (ksi)", "Unit weight (kcf)"])}
            <tbody>
              {model.materials.map((m) => (
                <tr key={m.id} className="border-b border-border/40">
                  <td className="py-0.5 pr-2">{m.id}. {m.name}</td>
                  <td className={td}>{fmt(m.E / 144, 0)}</td>
                  <td className={td}>{fmt(m.G / 144, 0)}</td>
                  <td className={td}>{fmt(m.density, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="pb-1 font-semibold">Supports ({model.supports.length}) and bearings ({model.links.length})</p>
          <p className="text-muted-foreground">Supports hold their nodes in every direction. Bearings are links between a girder&apos;s node and the node under it: stiff vertically and across the bridge, and along it where fixed.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="pb-1 font-semibold">Nodes ({model.nodes.length})</p>
          <table className="w-full tabular-nums">
            {head(["Node", "X (ft)", "Y (ft)", "Z (ft)"])}
            <tbody>
              {model.nodes.slice(0, LIMIT).map((n) => (
                <tr key={n.id} className="border-b border-border/40">
                  <td className="py-0.5 pr-2">{n.id}</td>
                  <td className={td}>{fmt(n.x, 2)}</td>
                  <td className={td}>{fmt(n.y, 2)}</td>
                  <td className={td}>{fmt(n.z, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {model.nodes.length > LIMIT && <p className="pt-1 text-muted-foreground">The first {LIMIT}.</p>}
        </div>
        <div>
          <p className="pb-1 font-semibold">Elements ({model.elements.length})</p>
          <table className="w-full tabular-nums">
            {head(["Element", "Type", "Section", "Node 1", "Node 2"])}
            <tbody>
              {model.elements.slice(0, LIMIT).map((e) => (
                <tr key={e.id} className="border-b border-border/40">
                  <td className="py-0.5 pr-2">{e.id}</td>
                  <td className={td}>{e.type}</td>
                  <td className={td}>{e.sec}</td>
                  <td className={td}>{e.n1}</td>
                  <td className={td}>{e.n2}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {model.elements.length > LIMIT && <p className="pt-1 text-muted-foreground">The first {LIMIT}.</p>}
        </div>
      </div>
    </div>
  );
}
