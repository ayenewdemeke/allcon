import { describe, expect, it } from "vitest";
import { TELLRD, TELLRD_BRR_COLUMNS, TELLRD_BRR_RF } from "./benchmarks";
import { compareBrr } from "./brr";
import { brrReportsToTable, memberGirder, mergeBrrReports, readBrrReport } from "./brr-report";
import { dtFigures } from "../figures";
import { rateDoubleTee } from "./double-tee";
import { tons, CDOT_VEHICLES } from "./vehicles";

// Reading BrR's Rating Results Summary Report. A page's lines as pdf.js gives them (pieces on a line
// joined with " | "), laid out as BrR 7.2 prints the report, with TELLRD-PINE ST's results.

function page(member: string, rf: number[], sameLine = false) {
  const n = rf.length;
  const row = (v: string) => Array(n).fill(v).join(" | ");
  const weight = (name: string) => {
    const k = ({ "Colorado Legal Type 3": "CO Type 3", "Colorado Legal Type 3-2": "CO Type 3-2", "Colorado Legal Type 3S2": "CO Type 3S2", "Colorado Permit Vehicle": "CO Permit", "HS 20-44": "HS-20", "Modified Tandem": "CO Mod Tandem", SU6: "CO SU6", SU7: "CO SU7" } as Record<string, string>)[name] ?? name;
    return tons(CDOT_VEHICLES.find((v) => v.name === k)!);
  };
  return [
    "Page 1 of 1",
    "Analyzed by: BrR",
    `Member alt: ${member}`,
    "Lane",
    "NBI: TELLRD-PINE ST",
    row("As Requested"),
    "Impact",
    row("As Requested"),
    "Limit State",
    row("Design Flexure - Concrete"),
    "Location | Span-(%)",
    row("1 - (50.0)"),
    "(ft)",
    `Location | ${row("22.75")}`,
    `Member: ${member}`,
    `Rating Factor | ${rf.map((v) => v.toFixed(3)).join(" | ")}`,
    "Bridge ID: TELLRD-PINE ST",
    "(Ton)",
    `Load Rating | ${rf.map((v, k) => (v * weight(TELLRD_BRR_COLUMNS[k][0])).toFixed(2)).join(" | ")}`,
    "Rating Results Summary Report",
    "Level",
    "Rating",
    TELLRD_BRR_COLUMNS.map((c) => c[2]).join(" | "),
    `Rating Method | ${row("LFD")}`,
    "Type",
    "Live Load",
    TELLRD_BRR_COLUMNS.map((c) => c[1]).join(" | "),
    "Live Load",
    // The report is printed rotated: in the browser the names come as their own line, next to the
    // bridge's name and the footer (in Node's grouping they share one).
    sameLine ? ["Name: TELLRD-PINE ST", "Struct-Def: TELLRD-PINE ST", ...TELLRD_BRR_COLUMNS.map((c) => c[0]), "AASHTO LFR Engine Version 7.2.0.3001", "Analysis time: 5/26/2026 10:36:43 AM"].join(" | ") : "Name: TELLRD-PINE ST | Struct-Def: TELLRD-PINE ST | AASHTO LFR Engine Version 7.2.0.3001 | Analysis preference setting: None | Analysis time: 5/26/2026 10:36:43 AM | Print time: 5/26/2026 10:45:17 AM",
    ...(sameLine ? [] : [TELLRD_BRR_COLUMNS.map((c) => c[0]).join(" | ")]),
  ];
}

const report = readBrrReport([["A cover page", "Bridge Load Rating"], page("GB", TELLRD_BRR_RF.GB), page("GE", TELLRD_BRR_RF.GE)]);

describe("BrR's Rating Results Summary Report", () => {
  it("reads each member's page, skipping the others", () => {
    expect(report.members.map((m) => m.member)).toEqual(["GB", "GE"]);
    expect(report.engine).toBe("AASHTO LFR Engine Version 7.2.0.3001");
    expect(report.analysisTime).toBe("5/26/2026 10:36:43 AM");
    const gb = report.members[0].rows;
    expect(gb).toHaveLength(16);
    expect(gb[0]).toMatchObject({ brrName: "Colorado Legal Type 3", vehicle: "CO Type 3", level: "Operating", type: "Axle Load", rf: 1.939, tons: 52.35, location: "22.75" });
    expect(gb.map((r) => r.vehicle)).toEqual(["CO Type 3", "CO Type 3-2", "CO Type 3S2", "CO Permit", "EV2", "EV3", "HS-20", "HS-20", "HS-20", "HS-20", "CO Mod Tandem", "NRL", "SU4", "SU5", "CO SU6", "CO SU7"]);
  });
  it("finds the names whether they share a line with the bridge's name or have their own", () => {
    const shared = readBrrReport([page("GB", TELLRD_BRR_RF.GB, true)]);
    expect(shared.members[0].rows.map((r) => r.vehicle)).toEqual(report.members[0].rows.map((r) => r.vehicle));
    expect(shared.engine).toBe(report.engine);
  });
  it("names girders as ALLCON does", () => {
    expect(["GA", "GB", "GE", "G3", "3", "Girder 4"].map(memberGirder)).toEqual(["G1", "G2", "G5", "G3", "G3", "G4"]);
  });
  it("takes HS-20's lower of axle and lane, and the lower of two runs", () => {
    const { rows } = mergeBrrReports([report]);
    expect(rows.find((r) => r.vehicle === "HS-20" && r.level === "Inventory" && r.girder === "G2")!.rf).toBe(0.812); // axle 0.812, lane 1.182
    const run2 = readBrrReport([page("GB", TELLRD_BRR_RF.GB.map((v, k) => (k === 0 ? 1.5 : v + 1)))]);
    const both = mergeBrrReports([report, run2]).rows;
    expect(both.find((r) => r.vehicle === "CO Type 3" && r.girder === "G2")).toMatchObject({ rf: 1.5 });
    expect(both.find((r) => r.vehicle === "CO Type 3-2" && r.girder === "G2")).toMatchObject({ rf: 1.864 });
  });
  it("refuses a PDF without the report", () => {
    expect(() => readBrrReport([["Supplemental Calculations", "Concrete properties"]])).toThrow(/Rating Results Summary/);
  });
});

it("reads a report printed with narrow columns: names and levels cut short, the factors after the title", () => {
  // One member's page as the PDF reader gives it (values from a CDOT off-system rating, 2026).
  const page = [
    "Member alt: GA",
    "Analyzed by: Bridge",
    "Limit State",
    "Location",
    "14.29 | 14.29 | 14.29 | 14.29 | 17.15 | 14.29 | 17.15 | 17.15 | 14.29 | 14.29 | 17.15 | 14.29 | 14.29 | 14.29 | 14.29 | 14.29",
    "Member: GA",
    "Rating Factor",
    "Rating Results Summary Report | 1.888 | 1.917 | 1.828 | 1.256 | 1.913 | 1.245 | 1.104 | 1.844 | 1.459 | 2.446 | 1.385 | 1.488 | 1.884 | 1.724 | 1.579 | 1.533",
    "Load Rating",
    "120.57 | 39.76 | 66.39 | 52.51 | 88.06 | 69.25",
    "Legal Operat… 50.97 | Legal Operat… 81.45 | Legal Operat… 77.69 | Permit Oper… | Legal Operat… 55.01 | Legal Operat… 53.55 | Inventory | Operating | Inventory | Operating | Permit Oper… | Legal Operat… 59.54 | Legal Operat… 50.87 | Legal Operat… 53.43 | Legal Operat… 54.88 | Legal Operat… 59.39",
    "Axle Load | Axle Load | Axle Load | Axle Load | Axle Load | Axle Load | Axle Load | Lane | Lane | Axle Load | Axle Load | Axle Load | Axle Load | Axle Load | Axle Load",
    "Name: X | Struct-Def: X | Colorado Le… | Colorado Le… | Colorado Le… | Colorado Pe… Axle Load | EV2 | EV3 | HS 20-44 | HS 20-44 | HS 20-44 | HS 20-44 | Modified Ta… | NRL | SU4 | SU5 | SU6 | SU7 | AASHTO LFR Engine Version 7.2.0.3001 | Analysis time: 7/31/2026 6:17:55 AM",
  ];
  const rep = readBrrReport([page]);
  const rows = rep.members[0].rows;
  expect(rows.map((r) => r.brrName)).toEqual(TELLRD_BRR_COLUMNS.map((c) => c[0]));
  expect(rows.map((r) => r.vehicle)).not.toContain(null);
  expect(rows.map((r) => r.level)).toEqual(TELLRD_BRR_COLUMNS.map((c) => (/Inventory/.test(c[2]) ? "Inventory" : "Operating")));
  const { rows: merged } = mergeBrrReports([rep]);
  expect(merged.find((r) => r.vehicle === "HS-20" && r.level === "Inventory")!.rf).toBe(1.104);
  expect(merged.find((r) => r.vehicle === "CO Type 3-2")!.rf).toBe(1.917);
  expect(merged.find((r) => r.vehicle === "CO Mod Tandem")!.rf).toBe(1.385);
});

describe("the calc package's tables", () => {
  it("draws the rating summary always, and the comparison once BrR's results are in", () => {
    const without = dtFigures(TELLRD);
    expect(without.summary.svg).toContain("CO Mod Tandem");
    expect(without.summary.svg).toContain("No posting required (BRM 1.15.1)");
    expect(without.comparison).toBeUndefined();
    const withBrr = dtFigures({ ...TELLRD, brrResults: brrReportsToTable([report], ["TELLRD-PINE ST rating package.pdf"]) });
    expect(withBrr.comparison!.svg).toContain("All 32 compared values within 5%.");
    expect(withBrr.comparison!.svg).toContain("TELLRD-PINE ST rating package.pdf");
  });
});

describe("the comparison, filled from BrR's report: TELLRD-PINE ST with its BrR model's values", () => {
  const r = rateDoubleTee(TELLRD);
  const c = compareBrr(r, brrReportsToTable([report], ["TELLRD-PINE ST rating package.pdf"]));
  it("compares all 13 vehicles on both girders, every one within 0.5% of BrR", () => {
    expect(c.rows.filter((x) => x.unmatched)).toEqual([]);
    expect(c.done).toHaveLength(2 * 14); // 12 vehicles at operating, HS-20 at both levels; two girders
    for (const x of c.done) expect(Math.abs(x.diff), `${x.name} ${x.level} ${x.girder}: ALLCON ${x.ours.toFixed(3)}, BrR ${x.brr}`).toBeLessThan(0.005);
    expect(c.outside).toBe(0);
    expect(c.hsInv?.brr).toBe(0.812);
  });
});
