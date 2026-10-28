import type { UnitSystem } from "../evaluate";

// Materials and standard parts, as worksheet math to insert: definitions people can read, check
// and edit, as they'd write them. Values from ASTM and the codes noted with each.

/** A note (what it is and where the values come from) and the math that defines it. */
export type Snippet = { label: string; note: string; lines: string[] };
export type SnippetGroup = { id: string; title: string; items: Snippet[] };

const steel = (label: string, fy: number, fu: number, si: [number, number], system: UnitSystem): Snippet =>
  system === "SI"
    ? { label, note: `Structural steel: ASTM ${label} (AISC 360 Table A3.1)`, lines: [`F_y\\coloneq${si[0]}MPa`, `F_u\\coloneq${si[1]}MPa`, "E\\coloneq200000MPa", "G\\coloneq77200MPa"] }
    : { label, note: `Structural steel: ASTM ${label} (AISC 360 Table A3.1)`, lines: [`F_y\\coloneq${fy}ksi`, `F_u\\coloneq${fu}ksi`, "E\\coloneq29000ksi", "G\\coloneq11200ksi"] };

function concrete(fc: number, system: UnitSystem): Snippet {
  if (system === "SI")
    return {
      label: `f'c = ${fc} MPa`,
      note: "Normal-weight concrete (ACI 318-19 19.2.2, 22.2.2.4.3)",
      lines: [`f'_{c}\\coloneq${fc}MPa`, "E_c\\coloneq4700\\cdot\\sqrt{\\frac{f'_{c}}{MPa}}\\cdot MPa=", "\\beta_1\\coloneq\\begin{cases}0.85 & f'_{c}\\le28MPa\\\\ 0.65 & f'_{c}\\ge55MPa\\\\ 0.85-0.05\\cdot\\frac{f'_{c}-28MPa}{7MPa} & \\text{otherwise}\\end{cases}=", "\\lambda\\coloneq1.0"],
    };
  return {
    label: `f'c = ${fc.toLocaleString("en-US")} psi`,
    note: "Normal-weight concrete (ACI 318-19 19.2.2, 22.2.2.4.3)",
    lines: [`f'_{c}\\coloneq${fc / 1000}ksi`, "E_c\\coloneq57000\\cdot\\sqrt{\\frac{f'_{c}}{psi}}\\cdot psi=", "\\beta_1\\coloneq\\begin{cases}0.85 & f'_{c}\\le4ksi\\\\ 0.65 & f'_{c}\\ge8ksi\\\\ 0.85-0.05\\cdot\\frac{f'_{c}-4ksi}{1ksi} & \\text{otherwise}\\end{cases}=", "\\lambda\\coloneq1.0"],
  };
}

/** ASTM A615 bar sizes: [designation, diameter, area] in in and in², or mm and mm² (A615M). */
const BARS_US: [string, number, number][] = [
  ["#3", 0.375, 0.11],
  ["#4", 0.5, 0.2],
  ["#5", 0.625, 0.31],
  ["#6", 0.75, 0.44],
  ["#7", 0.875, 0.6],
  ["#8", 1.0, 0.79],
  ["#9", 1.128, 1.0],
  ["#10", 1.27, 1.27],
  ["#11", 1.41, 1.56],
  ["#14", 1.693, 2.25],
  ["#18", 2.257, 4.0],
];
const BARS_SI: [string, number, number][] = [
  ["#10", 9.5, 71],
  ["#13", 12.7, 129],
  ["#16", 15.9, 199],
  ["#19", 19.1, 284],
  ["#22", 22.2, 387],
  ["#25", 25.4, 510],
  ["#29", 28.7, 645],
  ["#32", 32.3, 819],
  ["#36", 35.8, 1006],
  ["#43", 43.0, 1452],
  ["#57", 57.3, 2581],
];

/** Bolt strengths, AISC 360 Table J3.2: [label, note, Fnt, Fnv] in ksi, and MPa. */
const BOLTS: [string, string, [number, number], [number, number]][] = [
  ["Group A, threads included (N)", "Bolts: ASTM F3125 Grade A325 (Group A), threads not excluded from shear planes (AISC 360 Table J3.2)", [90, 54], [620, 372]],
  ["Group A, threads excluded (X)", "Bolts: ASTM F3125 Grade A325 (Group A), threads excluded from shear planes (AISC 360 Table J3.2)", [90, 68], [620, 469]],
  ["Group B, threads included (N)", "Bolts: ASTM F3125 Grade A490 (Group B), threads not excluded from shear planes (AISC 360 Table J3.2)", [113, 68], [780, 469]],
  ["Group B, threads excluded (X)", "Bolts: ASTM F3125 Grade A490 (Group B), threads excluded from shear planes (AISC 360 Table J3.2)", [113, 84], [780, 579]],
];

const BOLT_SIZES_US: [string, string][] = [
  ["5/8 in", "\\frac{5}{8}in"],
  ["3/4 in", "\\frac{3}{4}in"],
  ["7/8 in", "\\frac{7}{8}in"],
  ["1 in", "1in"],
  ["1-1/8 in", "1.125in"],
  ["1-1/4 in", "1.25in"],
];
const BOLT_SIZES_SI = ["M16", "M20", "M22", "M24", "M27", "M30"];

export function materials(system: UnitSystem): SnippetGroup[] {
  const si = system === "SI";
  return [
    {
      id: "steel",
      title: "Steel",
      items: [
        steel("A992", 50, 65, [345, 450], system),
        steel("A36", 36, 58, [250, 400], system),
        steel("A572 Gr. 50", 50, 65, [345, 450], system),
        steel("A500 Gr. C (rectangular HSS)", 50, 62, [345, 425], system),
        steel("A500 Gr. C (round HSS)", 46, 62, [315, 425], system),
        steel("A1085 (HSS)", 50, 65, [345, 450], system),
        steel("A53 Gr. B (pipe)", 35, 60, [240, 415], system),
      ],
    },
    { id: "concrete", title: "Concrete", items: (si ? [25, 28, 30, 35, 40, 50] : [3000, 4000, 5000, 6000, 8000]).map((fc) => concrete(fc, system)) },
    {
      id: "rebar",
      title: "Rebar grade",
      items: (si ? [420, 520] : [60, 80]).map((grade) => ({
        label: `Grade ${grade}`,
        note: `Reinforcement: ASTM A615${si ? "M" : ""} Grade ${grade} (ACI 318-19 20.2.2)`,
        lines: si ? [`f_y\\coloneq${grade}MPa`, "E_s\\coloneq200000MPa"] : [`f_y\\coloneq${grade}ksi`, "E_s\\coloneq29000ksi"],
      })),
    },
    {
      id: "bars",
      title: "Bar size",
      items: (si ? BARS_SI : BARS_US).map(([bar, d, a]) => ({
        label: bar,
        note: `${bar} bar (ASTM A615${si ? "M" : ""})`,
        lines: si ? [`d_b\\coloneq${d}mm`, `A_b\\coloneq${a}mm^2`] : [`d_b\\coloneq${d}in`, `A_b\\coloneq${a}in^2`],
      })),
    },
    {
      id: "bolts",
      title: "Bolts",
      items: BOLTS.map(([label, note, us, metric]) => ({ label, note, lines: si ? [`F_{nt}\\coloneq${metric[0]}MPa`, `F_{nv}\\coloneq${metric[1]}MPa`] : [`F_{nt}\\coloneq${us[0]}ksi`, `F_{nv}\\coloneq${us[1]}ksi`] })),
    },
    {
      id: "bolt-size",
      title: "Bolt size",
      items: si
        ? BOLT_SIZES_SI.map((m) => ({ label: m, note: `${m} bolt`, lines: [`d_b\\coloneq${m.slice(1)}mm`, "A_b\\coloneq\\frac{\\pi\\cdot d_b^2}{4}="] }))
        : BOLT_SIZES_US.map(([label, d]) => ({ label, note: `${label} diameter bolt`, lines: [`d_b\\coloneq${d}`, "A_b\\coloneq\\frac{\\pi\\cdot d_b^2}{4}="] })),
    },
    {
      id: "weld",
      title: "Weld",
      items: [
        { label: "E70XX", note: "Weld metal: E70XX electrodes (AISC 360 J2)", lines: [si ? "F_{EXX}\\coloneq480MPa" : "F_{EXX}\\coloneq70ksi"] },
        { label: "E80XX", note: "Weld metal: E80XX electrodes (AISC 360 J2)", lines: [si ? "F_{EXX}\\coloneq550MPa" : "F_{EXX}\\coloneq80ksi"] },
      ],
    },
  ];
}
