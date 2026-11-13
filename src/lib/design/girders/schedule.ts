import { spanInputs, type GirderDesign, type GirderInputs, type GirderResult } from "./prestressed";

// The girder schedule as CDOT's worksheet B-618-CBT1 tabulates it, filled from the design: for each
// span, the exterior and interior girders (by letter, A at the left), their length along grade, the
// harping point, the prestressing steel, the strands' centroid at the end and at midspan, the jacking
// and final forces, the concrete strengths, the deflection under the deck and the other dead loads,
// and the predicted cambers. With the debonding table the worksheet asks for, and what the girder
// elevation's schematic shows. Feet, inches, kips.

export type ScheduleRow = {
  span: number; // 1-based
  girders: string; // "A, F" or "B–E"
  side: "exterior" | "interior";
  type: string;
  L: number; // ft
  Lh: number | null; // ft, the end to the harping point
  As: number; // in²
  Ee: number; // in, the strands' centroid above the bottom at the girder's end
  Ec: number; // in, at midspan
  Fj: number; // kip, jacking force
  Ff: number; // kip, after all losses
  fci: number;
  fc: number;
  delta: number; // in, down: the deck, diaphragms, overlay, rails (positive)
  releaseCamber: number; // in
  camber: number; // in, at the camber age
  age: number; // days
  ok: boolean;
};

export type DebondRow = { span: number; y: number; strands: number; debonded: number; length: number };

const letter = (k: number) => String.fromCharCode(65 + k);

function rowFor(span: number, r: GirderResult, i: GirderInputs, side: "exterior" | "interior"): ScheduleRow {
  const s = r.strands;
  const N = s.groups.reduce((p, g) => p + g.n, 0);
  const cg = (key: "yEnd" | "yMid") => (N ? s.groups.reduce((p, g) => p + g.n * g[key], 0) / N : 0);
  const n = i.nGirders;
  return {
    span,
    girders: side === "exterior" ? `${letter(0)}, ${letter(n - 1)}` : n > 3 ? `${letter(1)}–${letter(n - 2)}` : n === 3 ? letter(1) : "",
    side,
    type: r.shape.name,
    L: r.loads.Lg,
    Lh: i.harped.count > 0 ? i.harped.harpPoint * r.loads.Lg : null,
    As: s.Aps,
    Ee: cg("yEnd"),
    Ec: cg("yMid"),
    Fj: s.Aps * r.losses.fpj,
    Ff: s.Aps * r.losses.fpe,
    fci: i.fci,
    fc: i.fc,
    delta: -r.camber.dTotal,
    releaseCamber: r.camber.cRelease,
    camber: r.camber.cDeck,
    age: r.camber.age,
    ok: r.ok,
  };
}

/** The schedule, the debonding table, and whether the design has checked out (else the schedule is preliminary). */
export function girderSchedule(i: GirderInputs, d: GirderDesign) {
  const rows: ScheduleRow[] = [];
  const debond: DebondRow[] = [];
  d.spans.forEach((sp, k) => {
    const si = spanInputs(i, k);
    rows.push(rowFor(k + 1, sp.exterior, si, "exterior"));
    if (i.nGirders > 2) rows.push(rowFor(k + 1, sp.interior, si, "interior"));
    for (const row of si.strands) if ((row.debonded ?? 0) > 0 && (row.debondLength ?? 0) > 0) debond.push({ span: k + 1, y: row.y, strands: row.count, debonded: row.debonded ?? 0, length: row.debondLength ?? 0 });
  });
  const final = d.spans.every((s) => s.ok) && d.piers.every((p) => p.ok);
  return { rows, debond, final, harped: i.harped.count > 0 };
}

export type GirderSchedule = ReturnType<typeof girderSchedule>;

/** The schedule's columns as CDOT's table heads them, and a row's cells, for the editor and the calc package. */
export const SCHEDULE_HEAD: [string, string][] = [
  ["Girder", "Type"],
  ["Span", "No"],
  ["Girder", "(Letter)"],
  ["L", "(ft)"],
  ["Lh", "(ft)"],
  ["As*", "(sq in)"],
  ["Ee", "(in)"],
  ["Ec", "(in)"],
  ["Fj", "(kip)"],
  ["Ff", "(kip)"],
  ["f'ci", "(ksi)"],
  ["f'c", "(ksi)"],
  ["Δ", "(in)"],
  ["Release", "camber (in)"],
  ["Camber", "(in)"],
];

const f = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : "—");
export const scheduleCells = (r: ScheduleRow) => [r.type, String(r.span), r.girders, f(r.L, 2), r.Lh === null ? "—" : f(r.Lh, 2), f(r.As, 3), f(r.Ee, 2), f(r.Ec, 2), f(r.Fj, 0), f(r.Ff, 0), f(r.fci, 1), f(r.fc, 1), f(r.delta, 2), f(r.releaseCamber, 2), f(r.camber, 2)];
