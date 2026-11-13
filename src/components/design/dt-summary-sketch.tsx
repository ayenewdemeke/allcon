import type { ReactNode } from "react";
import type { BrrDfRow, compareBrr } from "@/lib/design/rating/brr";
import { CHECK_LABEL, type DtRating } from "@/lib/design/rating/double-tee";
import type { VehicleClass } from "@/lib/design/rating/vehicles";

// The rating's tables as pictures for the calc package (a calc sheet's table regions hold numbers
// only): the rating summary, grouped as CDOT's LFR Rating Summary Sheet, and the comparison with
// BrR's run. No hooks.

const VW = 760;
const LINE = "#334155";
const MUTED = "#5c6f8a";
const RULE = "#cbd5e1";
const BAD = "#dc2626";
const GOOD = "#15803d";
const ROW = 16;

const GROUPS: { cls: VehicleClass; title: string }[] = [
  { cls: "design", title: "Design load" },
  { cls: "legal", title: "Colorado legal loads" },
  { cls: "su", title: "Specialized hauling vehicles" },
  { cls: "ev", title: "Emergency vehicles" },
  { cls: "permit", title: "Permit vehicles" },
];

type Col = { x: number; label: string; anchor?: "start" | "end" };

function Head({ cols, y, sub }: { cols: Col[]; y: number; sub?: Col[] }) {
  return (
    <g>
      {cols.map((c) => (
        <text key={c.label} x={c.x} y={y} textAnchor={c.anchor ?? "end"} fontSize="9" fontWeight="600" fill={LINE}>
          {c.label}
        </text>
      ))}
      {sub?.map((c) => (
        <text key={c.label + c.x} x={c.x} y={y + 11} textAnchor={c.anchor ?? "end"} fontSize="8.5" fill={MUTED}>
          {c.label}
        </text>
      ))}
      <line x1={10} y1={y + (sub ? 15 : 5)} x2={VW - 10} y2={y + (sub ? 15 : 5)} stroke={LINE} strokeWidth="0.8" />
    </g>
  );
}

const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "—");

/** The rating summary: each CDOT vehicle's inventory and operating ratings, the governing girder and check, and posting. */
export function RatingSummaryTable({ r, title }: { r: DtRating; title: string }) {
  const cols: Col[] = [
    { x: 14, label: "Vehicle", anchor: "start" },
    { x: 172, label: "Weight" },
    { x: 232, label: "Inventory" },
    { x: 280, label: "" },
    { x: 340, label: "Operating" },
    { x: 388, label: "" },
    { x: 400, label: "Governs (operating)", anchor: "start" },
    { x: 746, label: "Posting" },
  ];
  const sub: Col[] = [
    { x: 172, label: "T" },
    { x: 232, label: "RF" },
    { x: 280, label: "T" },
    { x: 340, label: "RF" },
    { x: 388, label: "T" },
  ];
  let y = 54;
  const body: ReactNode[] = [];
  for (const g of GROUPS) {
    const rows = r.ratings.filter((v) => v.cls === g.cls);
    if (!rows.length) continue;
    y += 6;
    body.push(
      <text key={g.cls} x={14} y={y + 10} fontSize="9" fontStyle="italic" fill={MUTED}>
        {g.title}
      </text>,
    );
    y += ROW;
    for (const v of rows) {
      const posted = v.posting === "Posting required";
      body.push(
        <g key={v.name}>
          <text x={22} y={y + 10} fontSize="9.5" fill={LINE}>
            {v.name}
          </text>
          <text x={172} y={y + 10} textAnchor="end" fontSize="9.5" fill={LINE}>
            {+v.tons.toFixed(2)}
          </text>
          <text x={232} y={y + 10} textAnchor="end" fontSize="9.5" fill={v.cls === "design" && v.govInv.inv.inv < 1 ? BAD : LINE}>
            {f3(v.govInv.inv.inv)}
          </text>
          <text x={280} y={y + 10} textAnchor="end" fontSize="9.5" fill={LINE}>
            {v.invTons.toFixed(1)}
          </text>
          <text x={340} y={y + 10} textAnchor="end" fontSize="9.5" fontWeight="600" fill={v.govOpr.opr.opr < 1 ? BAD : LINE}>
            {f3(v.govOpr.opr.opr)}
          </text>
          <text x={388} y={y + 10} textAnchor="end" fontSize="9.5" fontWeight="600" fill={LINE}>
            {v.oprTons.toFixed(1)}
          </text>
          <text x={400} y={y + 10} fontSize="8.5" fill={MUTED}>
            {`${v.govOpr.g}, ${CHECK_LABEL[v.govOpr.opr.check].split(" (")[0].toLowerCase()} at ${v.govOpr.opr.x.toFixed(2)} ft`}
          </text>
          <text x={746} y={y + 10} textAnchor="end" fontSize="9" fill={posted ? BAD : v.posting.startsWith("Exempt") ? "#b45309" : MUTED} fontWeight={posted ? "600" : "400"}>
            {v.posting}
          </text>
          <line x1={14} y1={y + ROW - 1} x2={VW - 14} y2={y + ROW - 1} stroke={RULE} strokeWidth="0.4" />
        </g>,
      );
      y += ROW;
    }
  }
  const posted = r.ratings.filter((v) => v.posting === "Posting required");
  y += 14;
  const VH = y + 12;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Rating summary">
      <text x={VW / 2} y={16} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        {title}
      </text>
      <Head cols={cols} y={34} sub={sub} />
      {body}
      <text x={14} y={y} fontSize="9.5" fontWeight="600" fill={posted.length ? BAD : GOOD}>
        {posted.length ? `Posting required (BRM 1.15.1): ${posted.map((v) => `${v.name} ${v.oprTons.toFixed(1)} T`).join(", ")}` : "No posting required (BRM 1.15.1)"}
      </text>
    </svg>
  );
}

/** ALLCON's ratings beside BrR's (and the distribution factors), each within 5%. */
export function BrrComparisonTable({ cmp, df, source }: { cmp: ReturnType<typeof compareBrr>; df: BrrDfRow[]; source: string }) {
  const cols: Col[] = [
    { x: 14, label: "Vehicle", anchor: "start" },
    { x: 170, label: "Level", anchor: "start" },
    { x: 260, label: "Girder", anchor: "start" },
    { x: 470, label: "This calc" },
    { x: 540, label: "BrR" },
    { x: 620, label: "Difference" },
    { x: 700, label: "Check" },
  ];
  let y = 46 + (source ? 12 : 0);
  const body: ReactNode[] = [];
  const row = (key: string, cells: [string, string, string, number, number, number, boolean]) => {
    const [a, b, c, ours, brr, diff, ok] = cells;
    body.push(
      <g key={key}>
        <text x={14} y={y + 10} fontSize="9.5" fill={LINE}>
          {a}
        </text>
        <text x={170} y={y + 10} fontSize="9.5" fill={LINE}>
          {b}
        </text>
        <text x={260} y={y + 10} fontSize="9" fill={MUTED}>
          {c}
        </text>
        <text x={470} y={y + 10} textAnchor="end" fontSize="9.5" fill={LINE}>
          {f3(ours)}
        </text>
        <text x={540} y={y + 10} textAnchor="end" fontSize="9.5" fill={LINE}>
          {f3(brr)}
        </text>
        <text x={620} y={y + 10} textAnchor="end" fontSize="9.5" fill={LINE}>
          {Math.abs(diff) < 0.0005 ? "0.0%" : `${diff > 0 ? "+" : ""}${(diff * 100).toFixed(1)}%`}
        </text>
        <text x={700} y={y + 10} textAnchor="end" fontSize="9.5" fontWeight="600" fill={ok ? GOOD : BAD}>
          {ok ? "OK" : "Check"}
        </text>
        <line x1={14} y1={y + ROW - 1} x2={VW - 14} y2={y + ROW - 1} stroke={RULE} strokeWidth="0.4" />
      </g>,
    );
    y += ROW;
  };
  for (const x of cmp.done) row(`${x.name}${x.level}${x.girder}`, [x.name, x.level, x.girder, x.ours, x.brr, x.diff, x.ok]);
  if (df.length) {
    y += 8;
    body.push(
      <text key="df" x={14} y={y + 10} fontSize="9" fontStyle="italic" fill={MUTED}>
        Distribution factors (moment)
      </text>,
    );
    y += ROW;
    for (const d of df) row(`df${d.key}`, [d.label, "", "", d.ours, d.brr, d.diff, d.ok]);
  }
  const bad = cmp.outside + df.filter((d) => !d.ok).length;
  y += 14;
  const VH = y + 12;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Comparison with BrR">
      <text x={VW / 2} y={16} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Comparison with AASHTOWare BrR (acceptable within 5%)
      </text>
      {source && (
        <text x={VW / 2} y={30} textAnchor="middle" fontSize="8.5" fill={MUTED}>
          {source.length > 140 ? `${source.slice(0, 137)}…` : source}
        </text>
      )}
      <Head cols={cols} y={source ? 46 : 34} />
      {body}
      <text x={14} y={y} fontSize="9.5" fontWeight="600" fill={bad ? BAD : GOOD}>
        {bad ? `${bad} item${bad === 1 ? "" : "s"} outside 5%: check BrR's inputs (spacing, member loads, distribution factors, travelway) before accepting.` : `All ${cmp.done.length + df.length} compared values within 5%.`}
      </text>
    </svg>
  );
}
