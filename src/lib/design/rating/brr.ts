import { MAX_DECIMALS, showNum } from "../calc-style";
import { EP, Ec, finalTension, ruptureModulus, tensionIgnored, type DtInputs, type DtRating } from "./double-tee";
import { CDOT_VEHICLES } from "./vehicles";

// AASHTOWare BrR: the input sheet (every value in BrR's entry order, to model the bridge for its one
// confirming run) and the comparison of BrR's rating table, pasted back, with ALLCON's results.

const f = (v: number, d = MAX_DECIMALS) => showNum(v, d);
const ftin = (ft: number) => {
  const whole = Math.floor(ft + 1e-9);
  const inch = Math.round((ft - whole) * 12 * 8) / 8;
  return inch >= 12 ? `${whole + 1}'-0"` : `${whole}'-${inch}"`;
};

export type BrrRow = [field: string, value: string, note: string];
export type BrrGroup = { title: string; rows: BrrRow[] };

/** The BrR input sheet: LFD, girder system, prestress by force and eccentricity. */
export function brrInputSheet(i: DtInputs, r: DtRating): BrrGroup[] {
  const u = i.units;
  const m = i.materials;
  const ld = i.loads;
  const deck = i.deck.present ? i.deck : null;
  const sw = ld.sidewalks.length > 0;
  const mountable = r.ped.mountable;
  const G = r.geo;
  const s = r.solve;
  const harp = i.prestress.mode === "known" ? (i.prestress.harp ?? null) : null;
  const ovh =((i.structureLength - i.span) / 2) * 12;
  const first = G.units[0];
  const last = G.units[G.units.length - 1];
  const totalW = u.layout ? last.x + last.bf / 2 + first.bf / 2 : last.x + first.edge + last.edge; // in, edge to edge
  const shapes: { bf: number; ss: number; girders: string[] }[] = [];
  G.units.forEach((x, k) => {
    let o = shapes.find((sh) => Math.abs(sh.bf - x.bf) < 0.01 && Math.abs(sh.ss - x.ss) < 0.01);
    if (!o) shapes.push((o = { bf: x.bf, ss: x.ss, girders: [] }));
    o.girders.push(`G${k + 1}`);
  });
  const dfInt = r.girders.find((g) => !g.ext && !g.name.includes("("));
  const dfExt = r.girders.find((g) => g.ext && !g.name.includes("("))!;
  const dfMnt = r.girders.find((g) => g.name.includes("("));
  const hsGov = r.ratings.find((x) => x.cls === "design")!;
  const legal = r.ratings.filter((x) => x.cls === "legal");
  const rf = i.roadway.railFaceOffset;
  const travel = G.roadW - (2 * rf) / 12;

  return [
    {
      title: "1. Bridge workspace: description",
      rows: [
        ["Bridge ID / name", i.bridge.id || "—", "NBI structure number"],
        ["Description", `CDOT LFR rating. ${i.numSpans > 1 ? `(${i.numSpans}) ${ftin(i.span)} simple spans` : `${ftin(i.span)} simple span`}, (${u.count}) adjacent double tees${deck ? ` with a ${f(deck.thk)}" CIP deck` : ""}${i.prestress.mode === "back-calculate" ? ", no plans" : ""}`, "Add the rater, checker and date"],
        ["Facility carried / feature intersected", `${i.bridge.facility || "—"} / ${i.bridge.feature || "—"}`, "Inspection report"],
        ["Year built / owner", `${i.bridge.yearBuilt} / ${i.bridge.owner || "—"}`, "Inspection report"],
      ],
    },
    {
      title: "2. Components › Materials",
      rows: [
        ["Girder concrete: f′c / f′ci", `${f(m.fc)} / ${f(m.fci)} ksi`, `Ec ≈ ${f(Ec(m.fc), 0)} ksi`],
        ["Girder concrete: density for dead load / for E", `${f(ld.concPcf / 1000, 3)} / 0.145 kcf`, ""],
        ...(deck ? [["Deck concrete: f′c / density", `${f(deck.fc)} ksi / ${f(deck.pcf / 1000, 3)} kcf`, `Ec ≈ ${f(Ec(deck.fc), 0)} ksi; n ≈ ${f(r.nDeck, 3)}`] as BrrRow] : []),
        ["Prestressing strand", m.strand, `f′s = ${f(m.fpu)} ksi, A = ${f(m.aps, 4)} in², ${m.lowRelaxation ? "low relaxation" : "stress-relieved"}`],
        ["Reinforcing steel", "Grade 60", "No mild steel modeled in the girder"],
      ],
    },
    {
      title: "3. Components › Beam shapes › PS tee beam",
      rows: [
        ["Depth (all shapes)", `${f(u.depth)} in`, "Precast only"],
        ["Flange thickness", `${f(u.flangeThk)} in`, ""],
        ["Top / bottom web thickness", `${f(u.stemTop)} / ${f(u.stemBot)} in`, ""],
        ...shapes.flatMap((sh, j): BrrRow[] => {
          const trimmed = !u.layout && u.exteriorTrimmed && (sh.girders.includes("G1") || sh.girders.includes(`G${u.count}`));
          const left = trimmed ? G.extOverhangOut : (sh.bf - sh.ss) / 2;
          const right = u.layout ? (sh.bf - sh.ss) / 2 : G.intOverhang;
          return [
            [`Shape ${j + 1} name`, `${f(sh.bf, 2)}"W x ${f(u.depth)}"D DT`, `Used by ${sh.girders.join(", ")}; the deck is not part of the shape`],
            [`Shape ${j + 1}: distance between webs / left, right flange`, `${f(sh.ss, 2)} / ${f(left, 2)}, ${f(right, 2)} in`, trimmed ? `Outside flange trimmed; flip for G${u.count}` : "Flange beyond the web centerline"],
          ];
        }),
        ["Check BrR's properties (interior / exterior)", `A = ${f(r.secInt.A, 1)} / ${f(r.secExt.A, 1)} in²; I = ${f(r.secInt.I, 0)} / ${f(r.secExt.I, 0)} in⁴; yb = ${f(r.secInt.yb, 2)} / ${f(r.secExt.yb, 2)} in`, "Precast section"],
      ],
    },
    {
      title: "4. Components › Appurtenances, PS properties, stress limits",
      rows: [
        ["Railing", `Custom rail, ${f(ld.railKlf, 4)} klf each side`, ""],
        ...ld.sidewalks.map((x, j): BrrRow => [`${x.curb ? "Curb" : "Sidewalk"} ${j + 1}`, `${ftin(x.width)} wide × ${f(x.thk)}" concrete`, x.curb ? "Typical section, DC2; no pedestrian load, not mountable" : "Typical section, DC2"]),
        ["PS properties: loss method", `Lump sum, ${f(i.options.lossLumpSum)} ksi`, "SSHB 9.16.2.2"],
        ["Jacking stress ratio", f(m.jackingRatio), ""],
        tensionIgnored(i)
          ? ["Final tension limit, girder (LFD)", "10 ksi", "Ignored, BRM 1.7.2: a value high enough that tension never governs, so strength flexure controls"]
          : ["Final tension limit, girder (LFD)", `${f(finalTension(i), 3)} ksi`, i.options.tensionLimit === null ? "6√f′c, SSHB 9.15.2.2" : i.options.tensionLimit === 1 ? "Set so strength flexure controls the prestress, BRM 1.7.2" : "As entered"],
        ["Other LFD stress limits", `Final compression 0.6f′c = ${f(0.6 * m.fc, 2)} ksi; DL compression 0.4f′c = ${f(0.4 * m.fc, 2)} ksi${deck ? `; deck 0.4f′c = ${f(0.4 * deck.fc, 2)} ksi` : ""}`, "SSHB 9.15.2.2"],
        ["Concrete: modulus of rupture / strand modulus", `${f(ruptureModulus(m.fc), 3)} ksi / ${f(EP, 0)} ksi`, "AASHTO LRFD 5.4.2.6, 5.4.4.2"],
      ],
    },
    {
      title: "5. Superstructure definition (girder system)",
      rows: [
        ["Default analysis method", "LFD", ""],
        ["Number of spans / span length", `1 / ${f(i.span)} ft`, `${ftin(i.span)} bearing to bearing${i.numSpans > 1 ? `; one span modeled (${i.numSpans} identical simple spans)` : ""}`],
        ["Number of girders", String(u.count), "One girder line per unit"],
        ["DL1 / DL2 distribution", deck ? "Tributary area / uniformly to all girders" : "Tributary area", deck ? "DC1: girder and deck; DC2: rail, sidewalks, asphalt, utilities" : "Every dead load on the girder it sits on"],
        ["Girder spacing", u.layout ? G.spacings.map((x, k) => `bay ${k + 1}: ${f(x / 12, 4)} ft`).join("; ") : `${f(G.S_ft, 4)} ft (all bays)`, "Unit centerline to unit centerline"],
        ["Skew", `${f(i.skew)}°`, ""],
      ],
    },
    {
      title: "6. Structure typical section",
      rows: [
        ["Deck", deck ? `${f(deck.thk)}" CIP concrete, composite` : "None", deck ? "Structural thickness: the full topping" : ""],
        ["Overall width", `${f(totalW / 12, 3)} ft = ${f(totalW, 1)} in`, `Edge to edge of the units; measured ${ftin(G.roadW)}`],
        ["Wearing surface", ld.asphalt > 0 ? `Asphalt, ${f(ld.asphalt)} in, ${f(ld.asphaltPcf)} pcf` : "None", deck ? "DC2" : "DC1"],
        ["Railings", `Left and right, ${f(ld.railKlf, 4)} klf`, deck ? "DC2" : "DC1"],
        ...(sw
          ? ([
              ["Travelway, model 1", `Curb to curb, ${f(i.roadway.curbToCurb, 3)} ft`, `Curb faces ${f(i.roadway.curbFaceOffset)}" in from each edge${r.ped.pedKlf > 0 ? "; with pedestrian load" : ""}`],
              ...(mountable ? [["Travelway, model 2", `Rail to rail, ${f(travel, 3)} ft (${f(rf)}" in from each edge)`, "Trucks on the sidewalks, no pedestrian load"] as BrrRow] : []),
            ] as BrrRow[])
          : ([["Travelway", `Between rail faces, ${f(travel, 3)} ft (${f(rf)}" in from each edge)`, `${G.NL} lane${G.NL > 1 ? "s" : ""}`]] as BrrRow[])),
      ],
    },
    {
      title: `7. Members (each girder G1–G${u.count})`,
      rows: [
        ...(deck
          ? ld.utilities.length
            ? ([["Utilities", `${f(ld.utilities.reduce((a, x) => a + x.klf, 0) / u.count, 4)} klf on every girder, DC2`, ld.utilities.map((x) => x.desc).join("; ")]] as BrrRow[])
            : []
          : ld.utilities.map((x): BrrRow => [`Distributed member load, G${x.unit}`, `${f(x.klf, 4)} klf, DC1, full length`, x.desc])),
        ...(ld.diaphragmKip ? ([["Diaphragm", `${f(ld.diaphragmKip)} kip per girder at midspan, DC1`, ""]] as BrrRow[]) : []),
        ...(sw
          ? ([
              r.ped.pedKlf > 0
                ? ["Pedestrian live load (model 1)", `${f(r.ped.pedKlf * 1000, 1)} lb/ft on every girder`, `${f(r.ped.pedPsf)} psf × ${f(r.ped.pedWidth, 2)} ft ÷ ${u.count} girders, SSHB 3.14.1.1`]
                : ["Pedestrian live load", "None", ld.sidewalks.every((x) => x.curb) ? "Curbs only, no walkway" : "Not applied to this bridge"],
            ] as BrrRow[])
          : []),
        ["Member alternative", "Prestressed concrete tee beam, schedule based", ""],
        ["Beam details", "Force and eccentricity only", harp ? `Harped at ${f(harp.at * 10, 1)}/10 span (standard plans)` : "Straight strands"],
        ["Force (jacking), all girders", `${f(s.Pj, 1)} kip`, `${f(s.nStrands, 2)} strands × ${f(m.aps, 4)} in² × ${f(s.fpj, 1)} ksi`],
        ["Strand CG at midspan / left / right", harp ? `${f(harp.mid, 2)} / ${f(harp.end, 2)} / ${f(harp.end, 2)} in` : `${f(s.cg, 2)} / ${f(s.cg, 2)} / ${f(s.cg, 2)} in`, "From the bottom"],
        ["Overhang left / right", `${f(ovh, 1)} / ${f(ovh, 1)} in`, `Structure length ${ftin(i.structureLength)}`],
        ["LFD shear computation", i.options.checkShear ? "Compute (SSHB 9.20)" : "Ignore", i.options.checkShear ? "" : "BRM 1.4(O)"],
        ...(dfInt ? ([[`LFD DF, interior`, `Single ${f(dfInt.dfSingle, 3)}; multi ${f(dfInt.dfMulti, 3)}`, i.options.lldfInterior === "sd" ? "SSHB 3.23.4.3, S/D" : "SSHB Table 3.23.1"]] as BrrRow[]) : []),
        [`LFD DF, exterior (G1, G${u.count})${mountable ? ", model 1" : ""}`, `Single ${f(dfExt.dfSingle, 3)}; multi ${f(dfExt.dfMulti, 3)}`, "Lever rule"],
        ...(dfMnt ? ([[`LFD DF, exterior, model 2`, `Single ${f(dfMnt.dfSingle, 3)}; multi ${f(dfMnt.dfMulti, 3)}`, "Lever rule, wheel 2 ft from the rail"]] as BrrRow[]) : []),
      ],
    },
    {
      title: "8. Run and check",
      rows: [
        ["Vehicles", CDOT_VEHICLES.map((v) => v.name).join(", "), `Legal and permit: ${i.options.legalLldf}-lane DF`],
        [`Expected HS-20 inventory RF (${hsGov.govInv.g})`, f(hsGov.govInv.inv.inv, 3), i.prestress.mode === "back-calculate" ? "Should be at least 1.00; if lower, add a strand and rerun" : ""],
        ["Expected legal operating ratings", legal.map((x) => `${x.name} ${f(x.oprTons, 1)} T`).join(" / "), "BrR should agree within 5%"],
        ["Finally", "Compare the BrR ratings and distribution factors with these calculations", "They should agree within 5%"],
      ],
    },
  ];
}

// --- the comparison ----------------------------------------------------------------------------------

export const BRR_TOLERANCE = 0.05;

const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string> = {
  hs20: "HS-20", hs2044: "HS-20", ms18: "HS-20",
  type3: "CO Type 3", cotype3: "CO Type 3", type3co: "CO Type 3", colorado3: "CO Type 3",
  type3s2: "CO Type 3S2", cotype3s2: "CO Type 3S2", type3s2co: "CO Type 3S2",
  type32: "CO Type 3-2", cotype32: "CO Type 3-2", type32co: "CO Type 3-2",
  su4: "SU4", su5: "SU5", su6: "CO SU6", cosu6: "CO SU6", su7: "CO SU7", cosu7: "CO SU7",
  nrl: "NRL", ev2: "EV2", ev3: "EV3",
  permit: "CO Permit", copermit: "CO Permit", permittruck: "CO Permit",
  modtandem: "CO Mod Tandem", comodtandem: "CO Mod Tandem", modifiedtandem: "CO Mod Tandem",
};

/** A vehicle name as BrR writes it, matched to one of ours. */
export function matchVehicle(name: string, names: string[]) {
  const n = norm(name);
  if (!n) return null;
  const exact = names.find((x) => norm(x) === n);
  if (exact) return exact;
  if (ALIASES[n]) return ALIASES[n];
  const key = Object.keys(ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((k) => n.includes(k));
  return key ? ALIASES[key] : null;
}

export type BrrRowIn = { vehicle: string; level: string; rf: number | null; tons: number | null; girder: string };

/** BrR's rating table as pasted (tab-separated, copied from BrR or Excel) or CSV, with a header row. */
export function parseBrrTable(text: string): BrrRowIn[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l));
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const split = (line: string) => {
    if (delim === "\t") return line.split("\t").map((s) => s.trim());
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const c = { veh: col(/vehicle|live\s*load(?!\s*type)|truck/), lvl: col(/level|rating\s*type/), rf: col(/^rf$|^brr\s*rf|rating\s*factor|^rf\b/), tons: col(/ton/), gir: col(/girder|member/) };
  if (c.veh < 0) throw new Error("BrR's table needs a Vehicle (or Live Load) column in its header row.");
  if (c.rf < 0 && c.tons < 0) throw new Error("BrR's table needs a Rating Factor or Tons column.");
  return lines.slice(1).map((l) => {
    const r = split(l);
    const num = (k: number) => (k >= 0 && r[k] !== undefined && r[k] !== "" && !isNaN(+r[k]) ? +r[k] : null);
    return { vehicle: r[c.veh] ?? "", level: c.lvl >= 0 ? r[c.lvl] ?? "" : "", rf: num(c.rf), tons: num(c.tons), girder: c.gir >= 0 ? r[c.gir] ?? "" : "" };
  });
}

/** A girder name as BrR writes it (G5, 5, Girder 5, or BrR's letters GA, GB, …) as ours. */
const girderKey = (s: string) =>
  (s || "")
    .toUpperCase()
    .trim()
    .replace(/^GIRDER\s*/, "G")
    .replace(/^(\d+)$/, "G$1")
    .replace(/^G([A-Z])$/, (_, L: string) => `G${L.charCodeAt(0) - 64}`);

export type BrrComparisonRow =
  | { vehicle: string; unmatched: true; why?: string }
  | { vehicle: string; unmatched: false; name: string; level: "Inventory" | "Operating"; girder: string; ours: number; brr: number; brrTons: number; diff: number; ok: boolean };

/** BrR's ratings beside ALLCON's: each row against the same girder when BrR names one, else ALLCON's governing girder. */
export function compareBrr(r: DtRating, text: string) {
  const names = r.ratings.map((x) => x.name);
  const rows: BrrComparisonRow[] = [];
  for (const b of parseBrrTable(text)) {
    const v = matchVehicle(b.vehicle, names);
    const rt = v ? r.ratings.find((x) => x.name === v) : null;
    if (!v || !rt) {
      rows.push({ vehicle: b.vehicle, unmatched: true });
      continue;
    }
    const level = /inv/i.test(b.level) ? "Inventory" : /op/i.test(b.level) ? "Operating" : rt.cls === "design" ? null : "Operating";
    if (!level) {
      rows.push({ vehicle: b.vehicle, unmatched: true, why: "An HS-20 row needs its level (Inventory or Operating)" });
      continue;
    }
    if (b.rf === null && b.tons === null) continue;
    const brr = b.rf !== null ? b.rf : b.tons! / rt.tons;
    const key = girderKey(b.girder);
    // The girder's lower case: with mountable sidewalks, curb to curb or trucks on the sidewalk (BrR's two runs, merged).
    const cases = rt.per.filter((x) => x.g === key || x.g.startsWith(`${key} (`));
    const rfOf = (x: (typeof rt.per)[number]) => (level === "Inventory" ? x.inv.inv : x.opr.opr);
    const p = cases.length ? cases.reduce((a, c) => (rfOf(c) < rfOf(a) ? c : a)) : null;
    const ours = p ? rfOf(p) : level === "Inventory" ? rt.govInv.inv.inv : rt.govOpr.opr.opr;
    const girder = p ? p.g : level === "Inventory" ? rt.govInv.g : rt.govOpr.g;
    const diff = (brr - ours) / ours;
    rows.push({ vehicle: b.vehicle, unmatched: false, name: v, level, girder, ours, brr, brrTons: brr * rt.tons, diff, ok: Math.abs(diff) <= BRR_TOLERANCE });
  }
  const done = rows.filter((x): x is Extract<BrrComparisonRow, { unmatched: false }> => !x.unmatched);
  const hsInv = done.find((x) => x.name === "HS-20" && x.level === "Inventory") ?? null;
  return { rows, done, hsInv, outside: done.filter((x) => !x.ok).length };
}

export type BrrDfRow = { key: keyof DtInputs["brrDf"]; label: string; ours: number; brr: number; diff: number; ok: boolean };

/**
 * BrR's moment distribution factors beside ALLCON's, each within 5% (as a rating package checks its
 * hand-calculated factors against BrR's before using BrR's). Interior: the typical interior girder;
 * exterior: curb to curb (with sidewalks, the pedestrian model).
 */
export function compareBrrDf(i: DtInputs, r: DtRating): BrrDfRow[] {
  const int = r.girders.find((g) => !g.ext && !g.name.includes("("));
  const ext = r.girders.find((g) => g.ext && !g.name.includes("("))!;
  const ours: Record<keyof DtInputs["brrDf"], [string, number | undefined]> = {
    intSingle: ["Interior, one lane", int?.dfSingle],
    intMulti: ["Interior, two or more lanes", int?.dfMulti],
    extSingle: ["Exterior, one lane", ext.dfSingle],
    extMulti: ["Exterior, two or more lanes", ext.dfMulti],
  };
  return (Object.keys(ours) as (keyof DtInputs["brrDf"])[]).flatMap((key) => {
    const brr = i.brrDf[key];
    const [label, v] = ours[key];
    if (brr === null || v === undefined) return [];
    const diff = (brr - v) / v;
    return [{ key, label, ours: v, brr, diff, ok: Math.abs(diff) <= BRR_TOLERANCE }];
  });
}

/** A blank table to fill from BrR, with ALLCON's values for reference. */
export function brrTemplate(r: DtRating) {
  const lines = ["Vehicle\tLevel\tRating Factor\tGirder"];
  for (const x of r.ratings) {
    if (x.cls === "design") lines.push(`${x.name}\tInventory\t\t`);
    lines.push(`${x.name}\tOperating\t\t`);
  }
  return lines.join("\n");
}
