import type { Line } from "@/lib/calcs/library/templates";
import { COLOR_NOTE, INPUT_COLOR, isInput, num } from "../calc-style";
import type { Figure } from "../figures";
import { BARS, PHI_STM, PHI_TIE } from "./aashto";
import type { StmInputs, StmResult } from "./strut-tie";

// A strut-and-tie design as a Calcs worksheet. The model's forces come from the equilibrium
// solution and are written in as given values; the checks on them (ties, nodes, grid, anchorage,
// diagonal cracking) are live math. The solve is asynchronous, so the result is passed in.

const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;
const FACE: Record<string, string> = { bearing: "bearing face", back: "back face", interface: "strut-to-node interface" };

/** The girder loads on the cap: dead load reactions, the lane's reaction, and the live load placed across the roadway. */
function girderLoadLines(i: StmInputs, r: StmResult, text: (t: string, style?: "heading" | "subheading" | "note", extra?: { newPage?: boolean; keepWithNext?: boolean }) => void) {
  const g = i.girders!;
  const c = r.capLoads!;
  text("Loads from the girders (AASHTO 3.4, 3.6.1)", "subheading", { keepWithNext: true });
  for (const [label, s] of [["Back span", g.back], ["Ahead span", g.ahead]] as const) {
    if (!s) continue;
    text(
      `${label}:- ${s.n} girders at ${num(s.S)} ft, overhangs of ${num(s.overhang)} ft, a ${num(s.L)} ft span${s.skew ? ` skewed ${num(s.skew)}°` : ""}. Unfactored reactions at the pier per girder: DC ${num(s.dc.interior)} kip interior and ${num(s.dc.exterior)} kip exterior; DW ${num(s.dw.interior)} kip interior and ${num(s.dw.exterior)} kip exterior.`,
    );
  }
  const L = c.lane;
  text(
    `Live load along the bridge:- The ${L.kind} gives the largest reaction at the pier, with the dynamic load allowance of 33% (AASHTO 3.6.2.1). Per lane: ${num(L.truck.back + L.truck.ahead)} kip from the ${L.kind.startsWith("two") ? "trucks" : L.kind.replace("design ", "")} and ${num(L.lane.back + L.lane.ahead)} kip from the lane load, the spans taken as simply supported.`,
  );
  text(
    `Live load across the bridge:- The roadway is ${num(c.roadway)} ft wide between the barriers, so up to ${c.lanesMax} design lanes of 12 ft are placed (AASHTO 3.6.1.1.1). They were moved across the roadway in 1 ft steps, with the trucks' wheels 2 ft or more from each lane's edges and the lane load 10 ft wide (AASHTO 3.6.1.2), giving ${c.arrangements} arrangements. Each wheel line and the lane load go to the girders by the lever rule, and the multiple presence factor applies (AASHTO 3.6.1.1.2).`,
  );
  text(
    `Load cases:- Strength I with 1.25 DC, 1.50 DW and 1.75 LL (AASHTO Table 3.4.1-1 and 3.4.1-2), for the arrangements that load each load node most, turn the cap most each way about its supports, and give the most total load; the two turning arrangements also with the dead loads at 0.90 DC and 0.65 DW. Bearing loads are resolved onto the nodes ${g.loadNodes.join(", ")} by statics${g.selfWeight ? `, with the cap's own weight of ${num(c.selfWeight)} kip above the soffit at ${num(g.wc * 1000)} pcf` : ""}.`,
  );
}

export function stmCalcLines(i: StmInputs, r: StmResult, title: string, figures?: { model?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note", extra?: { newPage?: boolean; keepWithNext?: boolean }) => lines.push({ text: t, ...(style ? { style } : {}), ...(extra ?? {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref } : {}) });
  const component = i.component === "pier_cap" ? "pier cap" : i.component === "abutment" ? "abutment" : "disturbed region";

  text(title.toUpperCase(), "heading");
  text(`Purpose:- These calculations design the ${component} as a disturbed region by the strut-and-tie method of AASHTO LRFD Article 5.8.2, for the factored strength load cases listed.`);
  text(
    `Method:- The ${component} is idealized as a planar truss of concrete struts and reinforcing-bar ties meeting at nonhydrostatic nodes. ${i.layout === "entered" ? "The engineer chose the truss layout" : "The truss layout was found by layout optimization over every line between the nodes that stays within the concrete"}, and its forces were found by equilibrium for each load case. The ties, the node faces, the crack-control grid, the anchorage of the ties and the diagonal-cracking estimate are then checked.`,
  );
  text("Limitations:- The design covers normalweight, nonprestressed concrete with a design concrete strength up to 10 ksi and bars with a yield strength up to 75 ksi. It treats the region in one plane at a constant width; out-of-plane behavior, seismic detailing and serviceability other than the diagonal-cracking estimate are outside these calculations.");
  text(COLOR_NOTE, "note");

  text("1 Calculations", "subheading", { newPage: true, keepWithNext: true });
  text("Materials and resistance factors", "subheading", { keepWithNext: true });
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`, "Design concrete strength");
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`, "Bar yield strength");
  m(`b_w\\coloneq ${num(i.b)}\\mathrm{in}`, "Member width");
  m(`\\phi_t\\coloneq ${PHI_TIE}`, "Tension in strut-and-tie models, AASHTO 5.5.4.2");
  m(`\\phi_c\\coloneq ${PHI_STM}`, "Compression in strut-and-tie models, AASHTO 5.5.4.2");

  text("Strut-and-tie model", "subheading", { keepWithNext: true });
  text(`Nodes, in feet: ${i.nodes.map((n) => `${n.label} (${num(n.x)}, ${num(n.y)})`).join("; ")}.`);
  if (r.capLoads && i.girders) girderLoadLines(i, r, text);
  text("Factored loads at the nodes, by load case (upward forces positive):", "note", { keepWithNext: true });
  for (const c of r.cases) text(`${c.name}:- ${c.loads.map((l) => `${num(l.fy)} kip vertically${l.fx ? ` and ${num(l.fx)} kip horizontally` : ""} at ${l.node}`).join("; ")}.`);
  if (figures?.model) {
    text("The model, with the largest force in each member over the load cases (kip):", "note", { keepWithNext: true });
    lines.push({ region: figures.model });
  }
  text("Member forces:- The largest tension and compression in each member over the load cases, with the case each comes from. These maxima come from different cases, so together they are not one state of equilibrium; each case on its own is.", "note", { keepWithNext: true });
  for (const mr of r.members.filter((x) => x.active)) {
    const t = mr.tension > 0 ? `tension ${num(mr.tension)} kip in case ${mr.tensionCase! + 1}` : "";
    const c = mr.compression > 0 ? `compression ${num(mr.compression)} kip in case ${mr.compressionCase! + 1}` : "";
    text(`${mr.key}, ${num(mr.length / 12)} ft long: ${[t, c].filter(Boolean).join("; ")}.`);
  }
  text("Equilibrium:- Each case was checked from its member forces, loads and reactions, apart from the solver.", undefined, { keepWithNext: true });
  r.perCase.forEach((p, k) =>
    text(`Case ${k + 1}, ${p.name}: ${num(p.applied)} kip applied; largest nodal residual ${p.equilibrium.nodal < 1e-3 ? "under 0.001" : num(p.equilibrium.nodal)} kip; ${p.equilibrium.ok ? "in equilibrium" : "NOT in equilibrium"}${p.smallestAngle !== null ? `; smallest strut-tie angle ${num(p.smallestAngle)} degrees` : ""}.`),
  );
  text(`Supports:- ${r.supportReport.map((s) => `${s.node} restrains ${s.direction === "y" ? "vertical" : "horizontal"} movement${s.upwardOnly ? " (upward only)" : ""}`).join("; ")}. ${r.boundary.kind === "solver" ? "Their reactions follow from statics and the solver." : "Their reactions are held as near as statics allows to the column's linear stress, P/A ± Mc/I, over each support's tributary width."}`);
  if (r.angles.smallest !== null) {
    given(`\\theta_{min}\\coloneq ${num(r.angles.smallest)}\\mathrm{deg}`, "The smallest angle between a strut and a tie meeting at a node");
    m("\\operatorname{if}\\left(\\theta_{min}>25\\mathrm{deg},\\text{OK},\\text{NG}\\right)=", "AASHTO 5.8.2.2");
  }

  if (i.grid.provided) {
    text("Crack-control reinforcement (AASHTO 5.8.2.6)", "subheading", { keepWithNext: true });
    m(`A_v\\coloneq ${num(i.grid.Av)}\\mathrm{in}^{2}`, "Vertical bars within each spacing");
    m(`s_v\\coloneq ${num(i.grid.sv)}\\mathrm{in}`);
    m(`A_h\\coloneq ${num(i.grid.Ah)}\\mathrm{in}^{2}`, "Horizontal bars within each spacing");
    m(`s_h\\coloneq ${num(i.grid.sh)}\\mathrm{in}`);
    m(`d\\coloneq ${num(i.grid.d)}\\mathrm{in}`, "Effective depth");
    m(ok("0.003", "\\frac{A_v}{b_w\\cdot s_v}"), "AASHTO Eq. 5.8.2.6-1");
    m(ok("0.003", "\\frac{A_h}{b_w\\cdot s_h}"), "AASHTO Eq. 5.8.2.6-2");
    m(ok("\\max\\left(s_v,s_h\\right)", "\\min\\left(\\frac{d}{4},12\\mathrm{in}\\right)"), "AASHTO 5.8.2.6");
  }
  text(r.grid ? "Efficiency:- The crack-control grid meets Article 5.8.2.6, so the node faces take the efficiency factors of AASHTO Table 5.8.2.5.3a-1." : "Efficiency:- The crack-control grid of Article 5.8.2.6 is not provided in full, so every node face takes an efficiency factor of 0.45 (AASHTO 5.8.2.5.3a).");

  if (r.ties.length) {
    text("Ties (AASHTO 5.8.2.4)", "subheading", { keepWithNext: true });
    r.ties.forEach((t, k) => {
      const spec = t;
      const n = k + 1;
      text(`Tie ${t.member}: ${spec.bars} #${spec.barSize} bars.`, undefined, { keepWithNext: true });
      given(`P_{ut${n}}\\coloneq ${num(t.demand)}\\mathrm{kip}`, "Largest tension from the model");
      m(`A_{st${n}}\\coloneq ${num(spec.bars)}\\cdot ${num(BARS[spec.barSize].area)}\\mathrm{in}^{2}=`, undefined, "in^2");
      m(`P_{rt${n}}\\coloneq\\phi_t\\cdot f_y\\cdot A_{st${n}}=`, "AASHTO Eqs. 5.8.2.3-1 and 5.8.2.4.1-1", "kip");
      m(ok(`P_{ut${n}}`, `P_{rt${n}}`));
      t.ends.forEach((e, j) => {
        const end = e;
        const s = `${n}${String.fromCharCode(97 + j)}`;
        const db = BARS[spec.barSize].db;
        text(`Anchorage of tie ${t.member} at node ${e.node}, ${e.kind === "hook" ? "with standard 90° hooks" : "with straight bars"}, measured from where the bars leave the extended nodal zone (AASHTO 5.8.2.4.2).`, undefined, { keepWithNext: true });
        m(`d_{b${s}}\\coloneq ${num(db)}\\mathrm{in}`);
        m(`c_{b${s}}\\coloneq\\min\\left(${num(end.clearCover)}\\mathrm{in}+\\frac{d_{b${s}}}{2},\\frac{${num(end.clearSpacing)}\\mathrm{in}+d_{b${s}}}{2}\\right)=`, "To the nearest surface, or half the bars' spacing", "in");
        if (e.kind === "hook") {
          m(`R_{${s}}\\coloneq ${num(e.radius)}\\mathrm{in}`, "Least bend radius to the bar's centroid, AASHTO 5.10.2.1");
          m(`F_{h${s}}\\coloneq d_{b${s}}\\cdot R_{${s}}\\cdot ${num(Math.max(0.45, Math.min(0.65, 0.85 - i.fc / 20)))}\\cdot f'_{c}=`, "AASHTO Eq. 5.10.8.2.4a-2", "kip");
          m(`A_{b${s}}\\coloneq ${num(BARS[spec.barSize].area)}\\mathrm{in}^{2}`);
          m(`l_{db${s}}\\coloneq0.17\\cdot d_{b${s}}\\cdot\\left(\\frac{f_y-\\frac{F_{h${s}}}{A_{b${s}}}}{1.97\\cdot\\left(\\frac{f'_{c}}{\\mathrm{ksi}}\\right)^{0.25}\\cdot\\mathrm{ksi}}\\right)^{2}=`, "AASHTO Eq. 5.10.8.2.1a-2", "in");
        } else m(`l_{db${s}}\\coloneq0.17\\cdot d_{b${s}}\\cdot\\left(\\frac{f_y}{1.97\\cdot\\left(\\frac{f'_{c}}{\\mathrm{ksi}}\\right)^{0.25}\\cdot\\mathrm{ksi}}\\right)^{2}=`, "AASHTO Eq. 5.10.8.2.1a-2", "in");
        m(`\\lambda_{rl${s}}\\coloneq ${num(e.location)}`, e.location > 1 ? "Over 12 in of fresh concrete cast below the bars, AASHTO 5.10.8.2.1b" : "AASHTO 5.10.8.2.1b");
        m(`\\lambda_{cf${s}}\\coloneq ${num(e.coatingFactor)}`, end.coating === "uncoated" || end.coating === "galvanized" ? "Uncoated or galvanized bars, AASHTO 5.10.8.2.1b" : "Epoxy-coated bars, AASHTO 5.10.8.2.1b");
        m(`\\lambda_{rc${s}}\\coloneq\\max\\left(0.3,\\min\\left(1,\\frac{d_{b${s}}}{c_{b${s}}}\\right)\\right)=`, "No transverse bars credited, AASHTO Eq. 5.10.8.2.1c-2", "");
        m(`l_{d${s}}\\coloneql_{db${s}}\\cdot\\min\\left(1.7,\\lambda_{rl${s}}\\cdot\\lambda_{cf${s}}\\right)\\cdot\\lambda_{rc${s}}=`, "AASHTO Eq. 5.10.8.2.1a-1", "in");
        if (e.kind === "hook") m(`l_{req${s}}\\coloneq\\max\\left(8\\cdot d_{b${s}},6\\mathrm{in},l_{d${s}}+R_{${s}}+\\frac{d_{b${s}}}{2}\\right)=`, "AASHTO Eq. 5.10.8.2.4a-1", "in");
        else m(`l_{req${s}}\\coloneq\\max\\left(12\\mathrm{in},l_{d${s}}\\right)=`, "AASHTO 5.10.8.2.1a", "in");
        if (e.basis) text(`Available length:- ${e.basis.replace(/\.?$/, ".")}`, "note", { keepWithNext: true });
        m(`l_{a${s}}\\coloneq ${num(e.available)}\\mathrm{in}`, "Available from the extended nodal zone to the bars' end, less cover");
        m(ok(`l_{req${s}}`, `l_{a${s}}`));
      });
    });
  }

  const bare = r.members.filter((x) => x.role === "tie" && !r.ties.some((t) => t.member === x.key));
  if (bare.length) text(`Ties without bars:- ${bare.map((x) => `${x.key} (${num(x.tension)} kip)`).join(", ")}. These ties are not designed, so the design is incomplete.`);

  if (r.faces.length) {
    text("Node faces (AASHTO 5.8.2.5)", "subheading", { keepWithNext: true });
    text("Strength of a node face:- φ m ν f'c Acn, where Acn is the face's width times the node's thickness, ν is from AASHTO Table 5.8.2.5.3a-1 for the node's type, and m = √(A2/A1) ≤ 2 where confinement is credited (AASHTO Eq. 5.8.2.5.3a-1).");
    r.faces.forEach((f, k) => {
      const n = k + 1;
      const nc = f;
      text(`Node ${f.node} (${f.nodeType}), ${FACE[f.type]}${f.source === "external" ? " carrying the applied load and reaction" : ` of ${f.source}`}${r.cases.length > 1 ? `, governing in ${r.cases[f.case].name}` : ""}.`, undefined, { keepWithNext: true });
      if (f.basis && (k === 0 || r.faces[k - 1].node !== f.node)) text(`Nodal zone:- ${f.basis.replace(/\.?$/, ".")}${f.type === "interface" ? " The strut's face is lb sin θ + ha cos θ, with a bearing shared among struts by their force components (AASHTO Figures 5.8.2.2-1 and C5.8.2.2-4)." : ""}`, "note", { keepWithNext: true });
      given(`P_{un${n}}\\coloneq ${num(f.demand)}\\mathrm{kip}`, "From the model");
      m(`A_{cn${n}}\\coloneq ${num(f.width)}\\mathrm{in}\\cdot ${num(nc.thickness)}\\mathrm{in}=`, f.basis ? "Face width from the node's geometry times its thickness" : "Face width times the node's thickness", "in^2");
      m(`\\nu_{${n}}\\coloneq ${num(f.nu)}`, r.grid ? "AASHTO Table 5.8.2.5.3a-1" : "No crack-control grid, AASHTO 5.8.2.5.3a");
      if (nc.confinement) m(`m_{${n}}\\coloneq\\min\\left(2,\\sqrt{\\frac{${num(nc.confinement.A2)}\\mathrm{in}^{2}}{${num(nc.confinement.A1)}\\mathrm{in}^{2}}}\\right)=`, "AASHTO Eq. 5.8.2.5.3a-1 and Article 5.6.5", "");
      else m(`m_{${n}}\\coloneq1`, "No confinement credited");
      if (f.steel) {
        m(`P_{sn${n}}\\coloneq ${num(f.steel)}\\mathrm{kip}`, "Yield of the compression bars within the back face, AASHTO 5.8.2.5.1");
        m(`P_{rn${n}}\\coloneq\\phi_c\\cdot\\left(m_{${n}}\\cdot\\nu_{${n}}\\cdot f'_{c}\\cdot A_{cn${n}}+P_{sn${n}}\\right)=`, "AASHTO Eqs. 5.8.2.3-1, 5.8.2.5.1-1 and 5.8.2.5.3a-1, augmented as 5.8.2.5.1 allows", "kip");
      } else m(`P_{rn${n}}\\coloneq\\phi_c\\cdot m_{${n}}\\cdot\\nu_{${n}}\\cdot f'_{c}\\cdot A_{cn${n}}=`, "AASHTO Eqs. 5.8.2.3-1, 5.8.2.5.1-1 and 5.8.2.5.3a-1", "kip");
      m(ok(`P_{un${n}}`, `P_{rn${n}}`));
      if (nc.confinement) text(`Notional area:- ${nc.confinement.basis.trim().replace(/\.?$/, ".")}`, "note");
    });
  }

  const geometry = r.coverage.filter((c) => (c.group === "strut" || c.group === "geometry") && (c.status === "pass" || c.status === "fail"));
  if (geometry.length) {
    text("Finite geometry (AASHTO 5.8.2.2, 5.8.2.5.2 and 5.10.3.1)", "subheading", { keepWithNext: true });
    text("Method:- Each strut is as wide as its face at a singular node and is held prismatic from there to midlength; toward a smeared node it may fan out. Each nodal zone is its bearing length by twice the chord's centroid distance from the face. Both must lie within the concrete, and neighboring zones must not overlap.");
    for (const c of geometry) text(`${c.item}:- ${c.status === "pass" ? "OK" : "NG"}. ${c.detail}`);
  }

  if (r.ledges.length) {
    text("Inverted-T ledges (AASHTO 5.8.4.3)", "subheading", { keepWithNext: true });
    text("Method:- At each girder's bearing on its ledge: shear friction at the stem's face (monolithic concrete, μ = 1.4, no cohesion for ledges), flexure with Nuc = 0.2 Vu, the primary bars and closed ties, punching shear, hangers at the strength and service limit states, and bearing with m from Article 5.6.5. Resistance factors 0.9 for shear and flexure, 0.7 for bearing.");
    for (const c of r.ledges) text(`${c.name}:- ${c.ok ? "OK" : "NG"}. ${num(c.demand)} against ${num(c.capacity)} ${c.unit}, ${c.ref}.${c.note ? ` ${c.note}` : ""}`);
  }

  r.services.forEach((s, k) => {
    const n = r.services.length > 1 ? `${k + 1}` : "";
    text(`Diagonal cracking under service loads${s.label !== "As entered" ? `, ${s.label.toLowerCase()}` : ""} (AASHTO C5.8.2.2)`, "subheading", { keepWithNext: true });
    if (s.label !== "As entered") text(`Service shear:- ${s.basis.replace(/\.?$/, ".")}`, "note", { keepWithNext: true });
    m(`V_{s${n}}\\coloneq ${num(s.V)}\\mathrm{kip}`, "Service shear");
    m(`a_{s${n}}\\coloneq ${num(s.a)}\\mathrm{in}`, "Shear span");
    m(`d_{s${n}}\\coloneq ${num(s.d)}\\mathrm{in}`, "Effective depth");
    m(`V_{cr${n}}\\coloneq\\max\\left(0.0632,\\min\\left(0.158,0.2-0.1\\cdot\\frac{a_{s${n}}}{d_{s${n}}}\\right)\\right)\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot b_w\\cdot d_{s${n}}=`, "AASHTO Eq. C5.8.2.2-1 with its limits", "kip");
    m(`\\operatorname{if}\\left(V_{s${n}}<V_{cr${n}},\\text{OK},\\text{NG}\\right)=`, "An estimate of cracking, not a strength check");
  });

  if (r.warnings.length) {
    text("Notes", "subheading", { keepWithNext: true });
    r.warnings.forEach((w, k) => text(`Note ${k + 1}:- ${w}`));
  }

  const open = r.coverage.filter((c) => c.status === "missing-input" || c.status === "not-checked" || c.status === "not-implemented" || c.status === "fail");
  if (open.length) {
    text("Checks not completed", "subheading", { keepWithNext: true });
    text("Scope:- The items below are not checked, or fail, in these calculations. A missing check is not a pass; the design is not complete until each is resolved.");
    const why: Record<string, string> = { "missing-input": "missing input", "not-checked": "not checked", "not-implemented": "not evaluated by these calculations", fail: "fails" };
    for (const c of open) text(`${c.item}:- ${why[c.status]}. ${c.detail}`);
  }
  return lines;
}
