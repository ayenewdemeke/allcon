import { emptyModel, type Direction, type Dof6, type LoadType, type Model, type Section } from "./model";

// Reading a midas Civil text model (an MCT file: File > Export > midas Civil MCT File) into the
// analysis model. It reads what a frame analysis needs: units, nodes, beam and truss elements,
// materials, sections, supports, point springs, elastic links, beam end releases, static load
// cases with nodal loads, beam loads and self-weight. Everything else in the file (plates,
// tendons, construction stages, moving loads, rigid links, combinations) is listed as not read,
// never dropped silently. Converted to kip and ft.

export type MctReport = {
  units: { force: string; length: string };
  read: Record<string, number>; // what was taken in, by kind
  notRead: string[]; // commands in the file this reader doesn't take
  warnings: string[]; // what was assumed or left out within the commands it reads
};

const FORCE: Record<string, number> = { N: 2.248089431e-4, KN: 0.2248089431, KGF: 2.204622622e-3, TONF: 2.204622622, LBF: 1e-3, KIPS: 1 };
const LENGTH: Record<string, number> = { MM: 3.280839895e-3, CM: 3.280839895e-2, M: 3.280839895, IN: 1 / 12, FT: 1 };
const READ = new Set(["UNIT", "NODE", "ELEMENT", "MATERIAL", "SECTION", "CONSTRAINT", "SPRING", "ELASTICLINK", "FRAME-RLS", "STLDCASE", "USE-STLD", "CONLOAD", "BEAMLOAD", "SELFWEIGHT", "VERSION", "ENDDATA", "PROJINFO", "STRUCTYPE", "REBAR-MATL-CODE", "GROUP", "BNDR-GROUP", "LOAD-GROUP", "DGN-MATL", "DGN-SECT", "SECT-COLOR", "MATL-COLOR"]);
const SECTION_TYPES = /^(DBUSER|VALUE|SRC|COMBINED|TAPERED|CONSTRUCT|COMPOSITE|PSC|SOD|COMPOSITE-[A-Z0-9-]+)$/;
const LINKS = /^(GEN|RIGID|TENS|COMP|MULTI LINEAR|SADDLE|RAIL INTERACT)$/;

const isNum = (s: string) => s !== "" && Number.isFinite(Number(s));
/** A list such as "1 2 5to9 20to30by5". */
export function mctList(field: string): number[] {
  const out: number[] = [];
  for (const part of field.trim().split(/\s+/)) {
    const m = /^(\d+)to(\d+)(?:by(\d+))?$/i.exec(part);
    if (m) for (let v = +m[1]; v <= +m[2]; v += +(m[3] ?? 1)) out.push(v);
    else if (/^\d+$/.test(part)) out.push(+part);
  }
  return out;
}

/** Section properties (in the file's length unit) of a midas user shape from its dimensions, or null for a shape this reader doesn't know. */
function userShape(shape: string, d: number[]): Omit<Section, "id" | "name"> | null {
  const rectJ = (a: number, c: number) => {
    const b = Math.max(a, c);
    const t = Math.min(a, c);
    return b * t ** 3 * (1 / 3 - 0.21 * (t / b) * (1 - t ** 4 / (12 * b ** 4)));
  };
  if (shape === "SB") {
    const [H, B] = d;
    return H > 0 && B > 0 ? { A: H * B, Asy: (5 / 6) * H * B, Asz: (5 / 6) * H * B, J: rectJ(H, B), Iy: (B * H ** 3) / 12, Iz: (H * B ** 3) / 12 } : null;
  }
  if (shape === "SR") {
    const [D] = d;
    const A = (Math.PI * D * D) / 4;
    const I = (Math.PI * D ** 4) / 64;
    return D > 0 ? { A, Asy: 0.9 * A, Asz: 0.9 * A, J: 2 * I, Iy: I, Iz: I } : null;
  }
  if (shape === "P") {
    const [D, t] = d;
    const di = D - 2 * t;
    const A = (Math.PI * (D * D - di * di)) / 4;
    const I = (Math.PI * (D ** 4 - di ** 4)) / 64;
    return D > 0 && t > 0 ? { A, Asy: A / 2, Asz: A / 2, J: 2 * I, Iy: I, Iz: I } : null;
  }
  if (shape === "B") {
    const [H, B, tw, tf] = d;
    const hi = H - 2 * tf;
    const bi = B - 2 * tw;
    if (!(H > 0 && B > 0 && tw > 0 && tf > 0)) return null;
    const Am = (H - tf) * (B - tw);
    return { A: H * B - hi * bi, Asy: 2 * B * tf, Asz: 2 * H * tw, J: (4 * Am * Am) / (2 * (H - tf) / tw + 2 * (B - tw) / tf), Iy: (B * H ** 3 - bi * hi ** 3) / 12, Iz: (H * B ** 3 - hi * bi ** 3) / 12 };
  }
  if (shape === "H") {
    const [H, B1, tw, tf1, B2raw, tf2raw] = d;
    const B2 = B2raw > 0 ? B2raw : B1;
    const tf2 = tf2raw > 0 ? tf2raw : tf1;
    if (!(H > 0 && B1 > 0 && tw > 0 && tf1 > 0)) return null;
    const hw = H - tf1 - tf2;
    const parts = [
      { A: B1 * tf1, y: H - tf1 / 2, I: (B1 * tf1 ** 3) / 12 },
      { A: hw * tw, y: tf2 + hw / 2, I: (tw * hw ** 3) / 12 },
      { A: B2 * tf2, y: tf2 / 2, I: (B2 * tf2 ** 3) / 12 },
    ];
    const A = parts.reduce((s, p) => s + p.A, 0);
    const yb = parts.reduce((s, p) => s + p.A * p.y, 0) / A;
    return { A, Asy: (5 / 6) * (B1 * tf1 + B2 * tf2), Asz: H * tw, J: (B1 * tf1 ** 3 + B2 * tf2 ** 3 + hw * tw ** 3) / 3, Iy: parts.reduce((s, p) => s + p.I + p.A * (p.y - yb) ** 2, 0), Iz: (tf1 * B1 ** 3 + tf2 * B2 ** 3 + hw * tw ** 3) / 12 };
  }
  return null;
}

export function parseMct(text: string): { model: Model; report: MctReport } {
  const model = emptyModel();
  const report: MctReport = { units: { force: "KN", length: "M" }, read: {}, notRead: [], warnings: [] };
  const count = (k: string, n = 1) => (report.read[k] = (report.read[k] ?? 0) + n);
  const warn = (w: string) => report.warnings.length < 60 && !report.warnings.includes(w) && report.warnings.push(w);

  // The file as commands, each with its header's arguments and its data lines' fields.
  const blocks: { name: string; args: string[]; rows: string[][] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(";")[0].trim();
    if (!line) continue;
    if (line.startsWith("*")) {
      const [head, ...args] = line.slice(1).split(",").map((s) => s.trim());
      blocks.push({ name: head.toUpperCase(), args, rows: [] });
    } else if (blocks.length) blocks[blocks.length - 1].rows.push(line.split(",").map((s) => s.trim()));
  }
  const unit = blocks.find((b) => b.name === "UNIT")?.rows[0];
  if (unit) report.units = { force: (unit[0] ?? "KN").toUpperCase(), length: (unit[1] ?? "M").toUpperCase() };
  else warn("The file has no *UNIT: taken as kN and m.");
  const F = FORCE[report.units.force];
  const L = LENGTH[report.units.length];
  if (!F || !L) throw new Error(`The file's units (${report.units.force}, ${report.units.length}) aren't ones this reader knows.`);

  const pending: { kind: "self"; case: string; g: [number, number, number] }[] = [];
  const beamLoads: { case: string; elements: number[]; type: string; dir: Direction; v: number[] }[] = [];
  let current = "";
  for (const b of blocks) {
    if (!READ.has(b.name)) {
      if (!report.notRead.includes(b.name)) report.notRead.push(b.name);
      continue;
    }
    if (b.name === "NODE") for (const r of b.rows) if (isNum(r[0])) { model.nodes.push({ id: +r[0], x: +r[1] * L, y: +r[2] * L, z: +r[3] * L }); count("nodes"); }
    if (b.name === "ELEMENT")
      for (const r of b.rows) {
        const type = (r[1] ?? "").toUpperCase();
        if (type === "BEAM" || type === "TRUSS" || type === "TENSTR" || type === "COMPTR") {
          if (type === "TENSTR" || type === "COMPTR") warn("Tension-only and compression-only members are read as ordinary truss members (a linear analysis).");
          model.elements.push({ id: +r[0], type: type === "BEAM" ? "beam" : "truss", mat: +r[2], sec: +r[3], n1: +r[4], n2: +r[5], ...(isNum(r[6]) && +r[6] ? { angle: +r[6] } : {}) });
          count(type === "BEAM" ? "beam elements" : "truss elements");
        } else {
          count(`elements not read (${type || "?"})`);
          warn(`Elements of type ${type || "?"} aren't read: only beams and trusses are.`);
        }
      }
    if (b.name === "MATERIAL")
      for (const r of b.rows) {
        if (!isNum(r[0])) continue;
        const type = (r[1] ?? "").toUpperCase();
        const name = r[2] || `Material ${r[0]}`;
        // User data: "2, E, Poisson, thermal, density" somewhere after the name.
        let E = 0, nu = 0.2, alpha = 0, density = 0;
        const k = r.findIndex((t, i) => i > 2 && t === "2" && isNum(r[i + 1]) && +r[i + 1] > 100 && isNum(r[i + 2]) && +r[i + 2] < 0.6);
        if (k > 0) {
          E = (+r[k + 1] * F) / (L * L);
          nu = +r[k + 2];
          alpha = isNum(r[k + 3]) ? +r[k + 3] : 0;
          density = isNum(r[k + 4]) ? (+r[k + 4] * F) / L ** 3 : 0;
        } else if (type === "STEEL") {
          E = 29000 * 144;
          nu = 0.3;
          alpha = 6.5e-6;
          density = 0.49;
          warn(`Material ${r[0]} (${name}) is from midas's database: taken as steel, E = 29,000 ksi.`);
        } else {
          // A concrete grade from the database: its strength from the name, Ec = 57·√f'c (psi) ksi.
          const all = r.slice(2).join(" ");
          const psi = /C\s*(\d{4,5})\b/i.exec(all);
          const mpa = /C\s*(\d{2,3})(?:\/\d+)?\b/i.exec(all);
          const fc = psi ? +psi[1] : mpa ? +mpa[1] * 145.038 : 4000;
          E = 57 * Math.sqrt(fc) * 144;
          alpha = 6e-6;
          density = 0.15;
          warn(`Material ${r[0]} (${name}) is from midas's database: taken as concrete with f'c ${Math.round(fc)} psi, Ec = 57√f'c. Check it.`);
        }
        // Temperatures in °C: thermal coefficients per °F.
        model.materials.push({ id: +r[0], name, E, G: E / (2 * (1 + nu)), density, alpha: alpha > 0 && k > 0 ? alpha / 1.8 : alpha });
        count("materials");
      }
    if (b.name === "SECTION") {
      for (let i = 0; i < b.rows.length; i++) {
        const r = b.rows[i];
        const type = (r[1] ?? "").toUpperCase();
        if (!isNum(r[0]) || !SECTION_TYPES.test(type)) continue;
        const id = +r[0];
        const name = r[2] || `Section ${id}`;
        let props: Omit<Section, "id" | "name"> | null = null;
        if (type === "VALUE") {
          // The next line of six or more numbers: AREA, ASy, ASz, Ixx (torsion), Iyy, Izz.
          const next = b.rows.slice(i + 1, i + 4).find((x) => x.filter(isNum).length >= 6 && isNum(x[0]) && !SECTION_TYPES.test((x[1] ?? "").toUpperCase()));
          if (next) {
            const v = next.map(Number);
            props = { A: v[0], Asy: v[1], Asz: v[2], J: v[3], Iy: v[4], Iz: v[5] };
          }
        } else if (type === "DBUSER") {
          // "... SHAPE, 2, d1, d2, …" for dimensions entered; "... SHAPE, 1, DB, NAME" for a database shape.
          const s = r.findIndex((t, j) => j > 2 && /^[A-Z]{1,4}$/.test(t) && !["YES", "NO", "CC", "CT", "CB", "LT", "LC", "LB", "RT", "RC", "RB"].includes(t) && (r[j + 1] === "1" || r[j + 1] === "2"));
          if (s > 0 && r[s + 1] === "2") props = userShape(r[s].toUpperCase(), r.slice(s + 2).filter(isNum).map(Number));
        }
        if (props) {
          model.sections.push({ id, name, A: props.A * L * L, Asy: props.Asy * L * L, Asz: props.Asz * L * L, J: props.J * L ** 4, Iy: props.Iy * L ** 4, Iz: props.Iz * L ** 4 });
          count("sections");
        } else {
          model.sections.push({ id, name: `${name} (not read)`, A: 1, Asy: 0, Asz: 0, J: 0.1, Iy: 0.1, Iz: 0.1 });
          count("sections not read");
          warn(`Section ${id} (${name}, ${type}) couldn't be read: it has placeholder properties (A = 1 ft², I = 0.1 ft⁴). Results in members with it are wrong until it's a VALUE or a user-dimension section.`);
        }
      }
    }
    if (b.name === "CONSTRAINT")
      for (const r of b.rows) {
        const code = (r[1] ?? "").padEnd(6, "0");
        if (!/^[01]{6,7}$/.test(code)) continue;
        const fixed = [0, 1, 2, 3, 4, 5].map((d) => code[d] === "1") as Dof6<boolean>;
        for (const node of mctList(r[0])) { model.supports.push({ node, fixed }); count("supports"); }
      }
    if (b.name === "SPRING")
      for (const r of b.rows) {
        const v = r.slice(1).filter(isNum).map(Number);
        if (v.length < 6) continue;
        const k = [v[0] * (F / L), v[1] * (F / L), v[2] * (F / L), v[3] * F * L, v[4] * F * L, v[5] * F * L] as Dof6<number>;
        for (const node of mctList(r[0])) { model.springs.push({ node, k }); count("springs"); }
      }
    if (b.name === "ELASTICLINK")
      for (const r of b.rows) {
        const t = r.findIndex((x) => LINKS.test(x.toUpperCase()));
        if (t < 2) continue;
        const kind = r[t].toUpperCase();
        const n1 = +r[t - 2];
        const n2 = +r[t - 1];
        const angle = isNum(r[t + 1]) ? +r[t + 1] : 0;
        const v = r.slice(t + 2).filter(isNum).map(Number);
        const stiff = 1e7;
        let k: Dof6<number>;
        if (kind === "GEN" && v.length >= 6) k = [v[0] * (F / L), v[1] * (F / L), v[2] * (F / L), v[3] * F * L, v[4] * F * L, v[5] * F * L];
        else if (kind === "RIGID") k = [stiff, stiff, stiff, stiff, stiff, stiff];
        else {
          k = [(v[0] ?? 0) * (F / L) || stiff, 0, 0, 0, 0, 0];
          warn(`A ${kind} elastic link is read as a linear spring along its axis.`);
        }
        model.links.push({ id: model.links.length + 1, n1, n2, k, ...(angle ? { angle } : {}) });
        count("elastic links");
      }
    if (b.name === "FRAME-RLS")
      for (let i = 0; i + 1 < b.rows.length; i += 2) {
        const a = b.rows[i];
        const c = b.rows[i + 1];
        const bits = (row: string[], from: number) => row.slice(from).filter((x) => x === "0" || x === "1").slice(0, 6).map((x) => x === "1");
        const ri = bits(a, 2);
        const rj = bits(c, 1);
        if (ri.length < 6 || rj.length < 6) continue;
        for (const id of mctList(a[0])) {
          const e = model.elements.find((x) => x.id === id);
          if (e) {
            e.releases = { i: ri as Dof6<boolean>, j: rj as Dof6<boolean> };
            count("beam end releases");
          }
        }
      }
    if (b.name === "STLDCASE")
      for (const r of b.rows) {
        if (!r[0]) continue;
        const t = (r[1] ?? "").toUpperCase();
        const type: LoadType = t === "D" || t === "DC" ? "DC" : t === "DW" ? "DW" : t === "L" || t === "LL" ? "LL" : t === "T" || t === "TU" ? "TU" : t === "W" || t === "WS" ? "WS" : "USER";
        model.loadCases.push({ name: r[0], type, description: r[2] || undefined });
        count("load cases");
      }
    if (b.name === "USE-STLD") current = b.args[0] ?? "";
    if (b.name === "SELFWEIGHT") {
      const g = b.args.filter(isNum).map(Number);
      if (g.length >= 3) pending.push({ kind: "self", case: current, g: [g[0], g[1], g[2]] });
    }
    if (b.name === "CONLOAD")
      for (const r of b.rows) {
        const v = r.slice(1, 7).map((x) => (isNum(x) ? +x : 0));
        const Fv = [v[0] * F, v[1] * F, v[2] * F, v[3] * F * L, v[4] * F * L, v[5] * F * L] as Dof6<number>;
        for (const node of mctList(r[0])) { model.loads.push({ case: current, kind: "nodal", node, F: Fv }); count("nodal loads"); }
      }
    if (b.name === "BEAMLOAD")
      for (const r of b.rows) {
        const dir = (r[3] ?? "").toUpperCase();
        if (!/^(G|L)[XYZ]$/.test(dir)) continue;
        const v = r.slice(4).filter(isNum).map(Number);
        if (v.length >= 4) beamLoads.push({ case: current, elements: mctList(r[0]), type: (r[2] ?? "").toUpperCase(), dir: dir as Direction, v: v.slice(0, 8) });
      }
  }

  // Loads that need the elements: beam loads (positions are ratios of the length) and self-weight.
  const nodeAt = new Map(model.nodes.map((n) => [n.id, n]));
  const lengthOf = (id: number) => {
    const e = model.elements.find((x) => x.id === id);
    const a = e && nodeAt.get(e.n1);
    const c = e && nodeAt.get(e.n2);
    return a && c ? Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z) : 0;
  };
  for (const bl of beamLoads)
    for (const id of bl.elements) {
      const len = lengthOf(id);
      if (!len) continue;
      if (bl.type === "UNILOAD") {
        const [d1, p1, d2, p2] = bl.v;
        if (Math.abs(d1) > 1e-6 || Math.abs(d2 - 1) > 1e-6 || Math.abs(p1 - p2) > 1e-9 * Math.max(1, Math.abs(p1))) warn("A beam load that is partial or varies along its element is read as uniform over the whole element, at its average.");
        model.loads.push({ case: bl.case, kind: "uniform", element: id, dir: bl.dir, w: (((p1 + p2) / 2) * (d2 - d1) * F) / L });
        count("beam loads");
      } else if (bl.type === "CONLOAD") {
        for (let k = 0; k + 1 < bl.v.length; k += 2) if (bl.v[k + 1]) { model.loads.push({ case: bl.case, kind: "point", element: id, dir: bl.dir, P: bl.v[k + 1] * F, a: bl.v[k] * len }); count("beam loads"); }
      } else warn(`Beam loads of type ${bl.type} aren't read.`);
    }
  for (const p of pending) {
    for (const e of model.elements) {
      const m = model.materials.find((x) => x.id === e.mat);
      const s = model.sections.find((x) => x.id === e.sec);
      if (!m || !s || !m.density) continue;
      (["GX", "GY", "GZ"] as const).forEach((dir, k) => p.g[k] && model.loads.push({ case: p.case, kind: "uniform", element: e.id, dir, w: p.g[k] * m.density * s.A }));
    }
    count("self-weight");
  }
  if (model.loads.some((l) => !model.loadCases.some((c) => c.name === l.case))) {
    warn("Some loads aren't under a load case in the file: they're left out.");
    model.loads = model.loads.filter((l) => model.loadCases.some((c) => c.name === l.case));
  }
  // Members that point at something missing can't be analyzed: leave them out, and say so.
  const mats = new Set(model.materials.map((m) => m.id));
  const secs = new Set(model.sections.map((s) => s.id));
  const before = model.elements.length;
  model.elements = model.elements.filter((e) => nodeAt.has(e.n1) && nodeAt.has(e.n2) && mats.has(e.mat) && secs.has(e.sec));
  if (model.elements.length < before) warn(`${before - model.elements.length} elements refer to a node, material or section that isn't in the file: left out.`);
  const kept = new Set(model.elements.map((e) => e.id));
  model.loads = model.loads.filter((l) => l.kind === "nodal" || kept.has(l.element));
  return { model, report };
}
