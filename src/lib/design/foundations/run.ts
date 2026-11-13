import type { Check } from "../walls/cip";
import { designAbutment, type AbutmentInputs } from "./abutment";
import { designFooting, type FootingInputs } from "./footing";
import type { FoundationKind } from "./kinds";
import type { LateralResult } from "./lateral";
import { designMicropile, type MicropileInputs } from "./micropile";
import { designPiles, type PileInputs } from "./piles";
import { designShaft, type ShaftInputs } from "./shaft";

// Each foundation tool run the same way for the editor and the calc package: its checks, how they
// group, the values worth showing beside them, and the governing lateral analysis to plot.

export type Group = { title: string; of: (id: string) => boolean };
export type FoundationRun = { checks: Check[]; groups: Group[]; summary: { title: string; rows: [string, string][] }[]; lateral: { title: string; r: LateralResult } | null };

const f = (v: number, d = 3) => (Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : "—");
const pick = <T,>(arr: T[], by: (t: T) => number) => (arr.length ? arr.reduce((a, b) => (by(b) > by(a) ? b : a)) : null);

export const FOUNDATION_GROUPS: Record<FoundationKind, Group[]> = {
  "spread-footing": [
    { title: "Geotechnical", of: (id) => ["embedment", "ecc-B", "ecc-L", "bearing", "sliding", "settlement"].includes(id) },
    { title: "The footing", of: (id) => !["embedment", "ecc-B", "ecc-L", "bearing", "sliding", "settlement"].includes(id) },
  ],
  "pile-foundation": [
    { title: "Layout", of: (id) => id.startsWith("spacing") || id.startsWith("edge") || id.startsWith("embed") },
    { title: "The piles", of: (id) => ["geo-axial", "uplift", "struct-axial", "interaction", "deflection"].includes(id) },
    { title: "The cap", of: (id) => id.startsWith("cap-") },
  ],
  "drilled-shaft": [
    { title: "Geotechnical", of: (id) => ["diameter", "ld", "axial", "uplift", "deflection"].includes(id) },
    { title: "Structural", of: (id) => !["diameter", "ld", "axial", "uplift", "deflection"].includes(id) },
  ],
  micropile: [
    { title: "Layout and bond", of: (id) => ["spacing", "embed", "bond-comp", "bond-ten", "elastic"].includes(id) },
    { title: "Structural", of: (id) => ["cased-comp", "uncased-comp", "cased-ten", "uncased-ten", "interaction"].includes(id) },
    { title: "Lateral", of: (id) => id === "deflection" },
  ],
  abutment: [
    { title: "CDOT's integral abutment limits", of: (id) => ["unit-length", "movement", "grade", "skew", "curvature", "depth", "cap-max", "cap-min", "cap-embed", "girder-clear", "flex-detail"].includes(id) },
    { title: "The foundation", of: (id) => id.startsWith("pile") || id.startsWith("shaft") || ["prebore", "embed", "ecc", "bearing", "sliding"].includes(id) },
    { title: "The abutment", of: (id) => id.startsWith("cap-p") || id.startsWith("cap-n") || ["cap-min", "cap-shear", "diaphragm", "stem-flex", "stem-min", "stem-crack", "stem-shear", "backwall", "seat", "toe", "heel"].includes(id) },
  ],
};

export function runFoundation(kind: FoundationKind, inputs: unknown): FoundationRun {
  const groups = FOUNDATION_GROUPS[kind];
  switch (kind) {
    case "spread-footing": {
      const r = designFooting(inputs as FootingInputs);
      const g = pick(r.cases.filter((c) => c.lc.limit !== "service"), (c) => c.qeq / c.qR);
      return {
        checks: r.checks,
        groups,
        summary: [
          { title: "The footing", rows: [["Weight, footing / soil over it (kip)", `${f(r.Wf, 1)} / ${f(r.Ws, 1)}`], ["Column as a square (ft)", `${f(r.cB, 2)} × ${f(r.cL, 2)}`], ["Effective depth, bars along B / L (in)", `${f(r.dB, 2)} / ${f(r.dL, 2)}`], ["Short side's band (5.12.8.4)", r.band.beta > 1.0001 ? `${f(r.band.frac * 100, 1)} % of the ${r.band.short} bars` : "square: none"]] },
          ...(g ? [{ title: `Bearing (${g.lc.name})`, rows: [["B′ × L′ (ft)", `${f(g.Bp, 2)} × ${f(g.Lp, 2)}`], ["Vertical load (kip)", f(g.Vmax, 1)], ["Pressure on B′L′ (ksf)", f(g.qeq)], ["Nominal resistance qn (ksf)", f(g.qn)], ...(g.nb ? ([["Nc / Nq / Nγ", `${f(g.nb.Nc, 2)} / ${f(g.nb.Nq, 2)} / ${f(g.nb.Ng, 2)}`]] as [string, string][]) : [])] as [string, string][] }] : []),
          ...(r.settle ? [{ title: `Settlement (${r.settle.name})`, rows: [["Net pressure Δp (ksf)", f(r.settle.dp)], ["Iz,p / depth of influence (ft)", `${f(r.settle.Izp)} / ${f(r.settle.DI, 1)}`], ["C1 / C2", `${f(r.settle.C1)} / ${f(r.settle.C2)}`], ["Settlement (in)", f(r.settle.Si)]] as [string, string][] }] : []),
        ],
        lateral: null,
      };
    }
    case "pile-foundation": {
      const r = designPiles(inputs as PileInputs);
      const g = pick(r.combined, (c) => c.inter.value);
      const lat = g ? (g.c.latB?.lead ?? g.c.latL?.lead ?? null) : null;
      return {
        checks: r.checks,
        groups,
        summary: [
          { title: "The group", rows: [["Piles", `${r.n} × ${(inputs as PileInputs).section}`], ["Cap (ft)", `${f(r.capB, 2)} × ${f(r.capL, 2)}`], ["Most / least loaded pile (kip)", `${f(Math.max(...r.cases.map((c) => c.Pmax)), 1)} / ${f(Math.min(...r.cases.map((c) => c.Pmin)), 1)}`], ["Geotechnical φ", `${f(r.phiGeo)}${r.smallGroup ? " (× 0.8, ≤ 3 piles)" : ""}`], ["Fixed-head embedment (BDM 10.5.3, in)", f(r.fix, 1)]] },
          ...(g ? [{ title: `Lateral (${g.c.lc.name})`, rows: [["Weak / strong axis moment (kip·ft)", `${f(g.Mweak, 1)} / ${f(g.Mstrong, 1)}`], ["Depth to fixity (ft)", f(g.zFix, 2)], ["Pr / Mrx / Mry", `${f(g.Pr, 0)} kip / ${f(g.Mrx / 12, 0)} / ${f(g.Mry / 12, 0)} kip·ft`]] as [string, string][] }] : []),
        ],
        lateral: lat ? { title: "The lead row's pile", r: lat } : null,
      };
    }
    case "drilled-shaft": {
      const r = designShaft(inputs as ShaftInputs);
      const g = pick(r.structural, (s) => s.r.Mmax / Math.max(1e-9, s.phiMn));
      return {
        checks: r.checks,
        groups,
        summary: [
          { title: "Axial (AASHTO 10.8.3.5)", rows: [...r.ax.rows.map((x) => [`${x.name}, ${f(x.from, 1)}–${f(x.to, 1)} ft (${x.method})`, `qs ${f(x.qs)} ksf, Rs ${f(x.Rs, 1)} kip, φ ${f(x.phi, 2)}`] as [string, string]), ["Tip", `qp ${f(r.ax.qp, 2)} ksf, Rp ${f(r.ax.Rp, 1)} kip, φ ${f(r.ax.phiP, 2)}`], ["Factored resistance (kip)", f(r.ax.RR, 1)]] },
          { title: "Section", rows: [["EI used (kip·in²)", r.EI.toExponential(3)], ["de / dv (in)", `${f(r.de, 2)} / ${f(r.dv, 2)}`]] },
        ],
        lateral: g ? { title: `${g.c.name}`, r: g.r } : null,
      };
    }
    case "micropile": {
      const r = designMicropile(inputs as MicropileInputs);
      const g = pick(r.comb, (c) => c.value);
      return {
        checks: r.checks,
        groups,
        summary: [
          { title: "Section", rows: [["Bar / casing / casing at threads (in²)", `${f(r.Ab, 2)} / ${f(r.Ac, 2)} / ${f(r.Act, 2)}`], ["Rn cased / uncased, compression (kip)", `${f(r.RnCC, 1)} / ${f(r.RnCU, 1)}`], ["Rn cased / uncased, tension (kip)", `${f(r.RnTC, 1)} / ${f(r.RnTU, 1)}`]] },
          { title: "Bond (AASHTO 10.9.3.5.2)", rows: [["Ground", r.bond.row.name], ["Table range (ksf)", r.bond.range ? `${r.bond.range[0]}–${r.bond.range[1]}` : "none for this grouting"], ["αb used (ksf)", f(r.bond.alpha, 2)], ["Rs (kip)", f(r.Rs, 1)], ["Plunge length transfer Pt (kip)", f(r.Pt, 1)]] },
        ],
        lateral: g ? { title: g.c.name, r: g.r } : null,
      };
    }
    case "abutment": {
      const r = designAbutment(inputs as AbutmentInputs);
      const rows: { title: string; rows: [string, string][] }[] = [{ title: "Movement at the abutment", rows: [["Expansion / contraction (in)", `${f(r.expansion)} / ${f(r.contraction)}`], ["Girders' reactions, DC / DW / LL (kip)", `${f(r.totalGirderR.DC, 0)} / ${f(r.totalGirderR.DW, 0)} / ${f(r.totalGirderR.LL, 0)}`]] }];
      if (r.integral) rows.push({ title: "Integral", rows: [["Per pile or shaft, Strength I / Service I (kip)", `${f(r.integral.Pu, 1)} / ${f(r.integral.Ps, 1)}`], ["Displacement imposed (in)", f(r.integral.delta)], ["Cap moments + / − (kip·ft)", `${f(r.integral.beam.Mpos, 1)} / ${f(r.integral.beam.Mneg, 1)}`], ["Passive pressure at the cap's bottom (ksf)", f(r.integral.pBottom)]] });
      if (r.seat) rows.push({ title: "Seat or semi-integral, per foot", rows: [["Height / footing width (ft)", `${f(r.seat.H, 2)} / ${f(r.seat.B, 2)}`], ["Earth pressure coefficient", f(r.seat.K)], ["Stem moment / shear", `${f(r.seat.Mstem, 1)} kip·ft / ${f(r.seat.Vstem, 1)} kip`]] });
      const lat = r.integral?.foundation?.lat ?? r.seat?.piles?.lat ?? null;
      return { checks: r.checks, groups, summary: rows, lateral: lat ? { title: "Pile or shaft under the movement", r: lat } : null };
    }
  }
}
