import { matchVehicle } from "./brr";
import { CDOT_VEHICLES } from "./vehicles";

// Reading AASHTOWare BrR's "Rating Results Summary Report" (printed to PDF): one page per member, one
// column per vehicle and level, with rows for the live load's name and type (axle load or lane), the
// rating level, limit state, location, rating factor and tons. The pages come in as text lines
// (pieces on a line joined with " | ", as the SIA reader gives them). Two runs (a bridge with
// mountable sidewalks is run twice) are merged by taking the lower rating of each.

export type BrrReportRow = {
  /** BrR's name, e.g. "Colorado Legal Type 3", and ALLCON's when it's one of the CDOT vehicles. */
  brrName: string;
  vehicle: string | null;
  level: "Inventory" | "Operating";
  type: string; // "Axle Load", "Lane"
  limitState: string;
  location: string;
  rf: number;
  tons: number | null;
};
export type BrrReportMember = { member: string; rows: BrrReportRow[] };
export type BrrReport = { members: BrrReportMember[]; engine: string; analysisTime: string; structure: string };

const cells = (line: string) => line.split(" | ").map((c) => c.trim());
const nums = (line: string) => cells(line).slice(1).map(Number);

/** BrR's names for the CDOT vehicles, in the order its report prints them (alphabetical). */
const BRR_NAMES = ["Colorado Legal Type 3", "Colorado Legal Type 3-2", "Colorado Legal Type 3S2", "Colorado Permit Vehicle", "EV2", "EV3", "HS 20-44", "Modified Tandem", "NRL", "SU4", "SU5", "SU6", "SU7"];

/** A cell cut short by a narrow column ("Colorado Le…"), with any type that ran into it dropped. */
const TRUNC = /…|\.\.\.$/;
const stripCell = (c: string) => c.replace(/(…|\.\.\.)\s+(Axle Load|Lane)$/, "$1").trim();

/** A level cell as BrR prints it, cut short or run together with its tons ("Legal Operat… 50.97"). */
const levelOf = (c: string): "Inventory" | "Operating" | null => {
  const s = c.replace(/\s+-?[\d.]+$/, "").replace(TRUNC, "").trim();
  return /Inv/i.test(s) ? "Inventory" : /Oper|Opr/i.test(s) ? "Operating" : null;
};

/**
 * The live load names, with names cut short read as the BrR names they begin with: where several
 * columns share a cut-short beginning ("Colorado Le…" three times), they're BrR's names with that
 * beginning in its (alphabetical) order.
 */
function fullNames(raw: string[]): string[] {
  const out = raw.map(stripCell);
  const groups = new Map<string, number[]>();
  out.forEach((c, k) => {
    if (!TRUNC.test(c)) return;
    const p = c.replace(TRUNC, "").trim();
    groups.set(p, [...(groups.get(p) ?? []), k]);
  });
  for (const [p, ks] of groups) {
    const cands = BRR_NAMES.filter((n) => n.toLowerCase().startsWith(p.toLowerCase()));
    if (cands.length === 1) ks.forEach((k) => (out[k] = cands[0]));
    else if (cands.length === ks.length) ks.forEach((k, j) => (out[k] = cands[j]));
    else throw new Error(`BrR report: the live load name "${p}…" is cut short and could be ${cands.join(", ") || "none of BrR's CDOT vehicles"}.`);
  }
  return out;
}

/** Reads the report's pages. Throws if none is a Rating Results Summary page. */
export function readBrrReport(pages: string[][]): BrrReport {
  const members: BrrReportMember[] = [];
  let engine = "";
  let analysisTime = "";
  let structure = "";
  const names = CDOT_VEHICLES.map((v) => v.name);
  for (const lines of pages) {
    if (!lines.some((l) => /Rating Results Summary Report/.test(l))) continue;
    const find = (re: RegExp) => lines.find((l) => re.test(l));
    const member = (find(/^Member:\s*\S+/) ?? find(/^Member alt:\s*\S+/))?.replace(/^Member( alt)?:\s*/, "").trim();
    // The rating factors: labeled "Rating Factor", or (printed narrower) a row of three-decimal
    // numbers on its own or after the report's title.
    const rfLabeled = find(/^Rating Factor \| /);
    const rfBare = lines.map(cells).find((c) => {
      const v = /^-?\d+\.\d{3}$/.test(c[0]) ? c : c.slice(1);
      return v.length >= 4 && v.every((x) => /^-?\d+\.\d{3}$/.test(x));
    });
    const rf = rfLabeled ? nums(rfLabeled) : rfBare ? (/^-?\d+\.\d{3}$/.test(rfBare[0]) ? rfBare : rfBare.slice(1)).map(Number) : null;
    if (!member || !rf) continue;
    const n = rf.length;
    const tons = find(/^Load Rating \| /) ? nums(find(/^Load Rating \| /)!) : [];
    const levels = lines
      .map(cells)
      .filter((c) => c.length === n && c.every((x) => levelOf(x)))
      .map((c) => c.map((x) => levelOf(x)!))[0];
    const types = lines.map(cells).find((c) => c.length === n && c.every((x) => /^(Axle Load|Lane|Truck|Tandem|.*Load)$/.test(x)));
    const limit = lines.map(cells).find((c) => c.length === n && c.every((x) => /Flexure|Shear|Stress|Concrete|Steel/.test(x)));
    const loc = lines.map(cells).find((c) => c[0] === "Location" && c.length === n + 1)?.slice(1);
    if (!levels) throw new Error(`BrR report, member ${member}: can't find the rating levels.`);
    // The live load names: the row whose cells are vehicles (the report is printed rotated, and the
    // names may share a line with the bridge's name and the footer, or have their own).
    const nameCellsOf = (l: string) => cells(l).filter((c) => !/^(Name:|Struct-Def:|AASHTO|Analysis|Print time|Page \d)/.test(c));
    const score = (c: string[]) => c.slice(0, n).filter((x) => matchVehicle(stripCell(x), names) || /^HS ?20|^H ?20|^HL-?93|Legal|Permit|Tandem|^Colorado/i.test(x)).length;
    const best = lines
      .map(nameCellsOf)
      .filter((c) => c.length >= n)
      .sort((a, b) => score(b) - score(a))[0];
    if (!best || score(best) < Math.ceil(n / 2)) throw new Error(`BrR report, member ${member}: ${n} ratings but no row of live load names.`);
    const nameCells = fullNames(best.slice(0, n));
    const all = lines.flatMap(cells);
    structure ||= all.find((c) => c.startsWith("Name:"))?.replace(/^Name:\s*/, "") ?? "";
    engine ||= all.find((c) => /Engine Version/.test(c)) ?? "";
    analysisTime ||= all.find((c) => /^Analysis time:/.test(c))?.replace(/^Analysis time:\s*/, "") ?? "";
    members.push({
      member,
      rows: rf.map((v, k) => ({
        brrName: nameCells[k],
        vehicle: matchVehicle(nameCells[k], names),
        level: levels[k],
        type: types?.[k] ?? "",
        limitState: limit?.[k] ?? "",
        location: loc?.[k] ?? "",
        rf: v,
        tons: Number.isFinite(tons[k]) ? tons[k] : null,
      })),
    });
  }
  if (!members.length) throw new Error("No BrR Rating Results Summary Report pages found in this PDF.");
  return { members, engine, analysisTime, structure };
}

/** A member name as ALLCON's girder: GA, GB… or G1, G2… or 1, 2… → G1, G2… */
export const memberGirder = (m: string) =>
  m
    .toUpperCase()
    .trim()
    .replace(/^GIRDER\s*/, "G")
    .replace(/^(\d+)$/, "G$1")
    .replace(/^G([A-Z])$/, (_, L: string) => `G${L.charCodeAt(0) - 64}`);

/**
 * The reports' ratings as rows to compare: per vehicle, level and girder, the lowest over the runs
 * given (the two sidewalk models) and, for HS-20, over axle load and lane (the governing one).
 */
export function mergeBrrReports(reports: BrrReport[]) {
  const best = new Map<string, { vehicle: string; level: "Inventory" | "Operating"; girder: string; rf: number; from: string }>();
  const unmatched = new Set<string>();
  reports.forEach((rep, run) => {
    for (const m of rep.members)
      for (const r of m.rows) {
        if (!r.vehicle) {
          unmatched.add(r.brrName);
          continue;
        }
        const girder = memberGirder(m.member);
        const key = `${r.vehicle}|${r.level}|${girder}`;
        const cur = best.get(key);
        if (!cur || r.rf < cur.rf) best.set(key, { vehicle: r.vehicle, level: r.level, girder, rf: r.rf, from: `${reports.length > 1 ? `run ${run + 1}, ` : ""}${r.type || "BrR"}, ${r.limitState}${r.location ? ` at ${r.location} ft` : ""}` });
      }
  });
  return { rows: [...best.values()], unmatched: [...unmatched] };
}

/** The merged ratings as the comparison's table text (tab-separated, with a header and notes). */
export function brrReportsToTable(reports: BrrReport[], files: string[]) {
  const { rows, unmatched } = mergeBrrReports(reports);
  const order = (v: string) => CDOT_VEHICLES.findIndex((x) => x.name === v);
  rows.sort((a, b) => order(a.vehicle) - order(b.vehicle) || a.level.localeCompare(b.level) || a.girder.localeCompare(b.girder, undefined, { numeric: true }));
  const head = [
    `# From BrR: ${files.join("; ")}${reports[0]?.engine ? ` (${reports[0].engine}` : ""}${reports[0]?.analysisTime ? `, analyzed ${reports[0].analysisTime})` : reports[0]?.engine ? ")" : ""}`,
    ...(reports.length > 1 ? ["# Two runs: the lower rating of each vehicle, level and girder."] : []),
    "# HS-20: the lower of BrR's axle load and lane ratings.",
    ...(unmatched.length ? [`# Not CDOT vehicles, left out: ${unmatched.join(", ")}`] : []),
    "Vehicle\tLevel\tRating Factor\tGirder",
  ];
  return [...head, ...rows.map((r) => `${r.vehicle}\t${r.level}\t${r.rf}\t${r.girder}`)].join("\n");
}
