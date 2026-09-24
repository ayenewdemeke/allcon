// Generates samples/riverside-schedule-of-values.xlsx, a realistic demo file for the importer.
// Run: node scripts/make-sample-sov.mjs
import ExcelJS from "exceljs";

const sections = [
  ["01", "GENERAL REQUIREMENTS", [
    ["01 50 00", "Temporary facilities and controls", "LS", null, null, 85000],
    ["01 71 00", "Mobilization", "LS", null, null, 40000],
  ]],
  ["03", "CONCRETE", [
    ["03 30 00", "Cast-in-place foundation walls, 12\"", "CY", 180, 650],
    ["03 30 00", "Slab on grade, 5\"", "SF", 21000, 9.5],
  ]],
  ["04", "MASONRY", [["04 20 00", "Brick veneer on metal stud backup", "SF", 18500, 32]]],
  ["05", "METALS", [
    ["05 12 00", "Structural steel framing, beams", "LF", 4200, 95],
    ["05 12 00", "Structural steel columns", "EA", 84, 1850],
  ]],
  ["08", "OPENINGS", [
    ["08 11 13", "Hollow metal doors and frames", "EA", 24, 1450],
    ["08 44 13", "Glazed aluminum curtain wall", "SF", 3800, 88],
  ]],
  ["09", "FINISHES", [
    ["09 21 16", "Gypsum board partitions", "SF", 24000, 7.25],
    ["09 51 13", "Acoustical panel ceilings", "SF", 16000, 4.8],
  ]],
  ["22", "PLUMBING", [["22 42 00", "Commercial plumbing fixtures", "EA", 24, 1600]]],
  ["32", "EXTERIOR IMPROVEMENTS", [
    ["32 12 16", "Asphalt paving, 3\" on 6\" aggregate base", "SF", 14000, 4.1],
    ["32 16 13", "Concrete curbs and gutters", "LF", 900, 28],
    ["32 92 23", "Sodding", "SF", 6500, 0.95],
  ]],
];

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Schedule of Values");
ws.columns = [{ width: 12 }, { width: 44 }, { width: 8 }, { width: 12 }, { width: 12 }, { width: 16 }];
ws.addRow(["Riverside Medical Office Building"]).font = { bold: true, size: 14 };
ws.addRow(["Schedule of Values — Contract No. RMOB-2026-01"]);
ws.addRow([]);
const head = ws.addRow(["Cost Code", "Description of Work", "Unit", "Qty", "Unit Rate", "Scheduled Value"]);
head.font = { bold: true };
head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } }));

for (const [code, title, lines] of sections) {
  ws.addRow([code, title]).font = { bold: true };
  for (const [c, desc, unit, qty, rate, amount] of lines) {
    const row = ws.addRow([c, desc, unit, qty, rate, null]);
    const r = row.number;
    // Unit-price lines total with a formula, as real sheets do; lump sums are typed in.
    row.getCell(6).value = amount != null ? amount : { formula: `D${r}*E${r}`, result: qty * rate };
    row.getCell(5).numFmt = "$#,##0.00";
    row.getCell(6).numFmt = "$#,##0.00";
    row.getCell(4).numFmt = "#,##0";
  }
}
await wb.xlsx.writeFile("samples/riverside-schedule-of-values.xlsx");
console.log("wrote samples/riverside-schedule-of-values.xlsx");
