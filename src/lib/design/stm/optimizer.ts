import { DesignError } from "../walls/cip";
import { topology, type Pt } from "./geometry";
import { screen } from "./stability";

// Ground-structure layout optimization for a strut-and-tie model: minimize Σ L (At + Ac) over
// every load case, with each case's member forces and reactions in equilibrium and the shared
// tension and compression study areas bounding the force envelopes. The study stresses are
// exploratory, not design strengths. Solved with HiGHS; the LP is passed as CPLEX LP text.

/** Solves a CPLEX-format LP: the status and each named column's value. */
export type LpSolver = (lp: string) => Promise<{ status: string; values: Record<string, number> }>;

export type OptimizeResult =
  | { ok: false; status: string; message: string }
  | {
      ok: true;
      objective: number;
      tensionArea: number[];
      compressionArea: number[];
      forces: number[][]; // [case][member], tension positive
      reactions: number[][]; // [case][support]
      active: [number, number][];
      activeIndex: number[];
      stability: ReturnType<typeof screen>;
      residual: number;
      deviation: number; // kip, Σ|reaction − target| when target reactions are given, else 0
    };

const term = (c: number, v: string) => `${c < 0 ? "-" : "+"} ${Math.abs(c)} ${v}`;

export async function optimize(
  nodesIn: Pt[],
  membersIn: [number, number][],
  supportsIn: [number, number][],
  loads: Pt[][], // [case][node] = [Fx, Fy]
  solve: LpSolver,
  tension = 30,
  compression = 2,
  compressionOnly: number[] = [], // indices into supports: vertical, upward only
  signs: number[] = [], // per member: −1 strut only, +1 tie only, 0 either (the engineer's roles)
  targets: (number | null)[][] | null = null, // [case][support]: reactions to stay as close to as statics allows (a boundary assumption)
): Promise<OptimizeResult> {
  const { nodes, edges: members, restraints: supports } = topology(nodesIn, membersIn, supportsIn);
  if (!Array.isArray(loads) || !loads.length || loads.some((c) => c.length !== nodes.length || c.some((f) => f.length !== 2 || !f.every(Number.isFinite)))) throw new DesignError("Each load case needs an x and y force at every node.");
  if (!(tension > 0) || !(compression > 0) || !Number.isFinite(tension) || !Number.isFinite(compression)) throw new DesignError("The study stresses must be positive.");
  if (nodes.length > 150 || loads.length > 20) throw new DesignError("The solver takes up to 150 nodes and 20 load cases.");
  for (const k of compressionOnly) {
    if (!Number.isInteger(k) || k < 0 || k >= supports.length) throw new DesignError("An upward-only support isn't in the support list.");
    if (supports[k][1] !== 1) throw new DesignError("Only vertical supports can be upward-only.");
  }
  if (!members.length) throw new DesignError("No members to build the model from.");
  const n = nodes.length;
  const lengths = members.map(([i, j]) => Math.hypot(nodes[j][0] - nodes[i][0], nodes[j][1] - nodes[i][1]));
  const units = members.map(([i, j], k) => [(nodes[j][0] - nodes[i][0]) / lengths[k], (nodes[j][1] - nodes[i][1]) / lengths[k]]);

  const obj: string[] = [];
  members.forEach((_, k) => obj.push(term(lengths[k], `at${k}`), term(lengths[k], `ac${k}`)));
  const rows: string[] = [];
  const bounds: string[] = [];
  loads.forEach((load, c) => {
    // Equilibrium at each node: Σ members + reactions = −applied.
    for (let i = 0; i < n; i++)
      for (const axis of [0, 1]) {
        const terms: string[] = [];
        members.forEach(([a, b], k) => {
          if (a === i) terms.push(term(units[k][axis], `q${c}_${k}`));
          if (b === i) terms.push(term(-units[k][axis], `q${c}_${k}`));
        });
        supports.forEach(([node, ax], r) => {
          if (node === i && ax === axis) terms.push(term(1, `r${c}_${r}`));
        });
        const rhs = -load[i][axis];
        if (!terms.length) continue; // a loaded node with nothing to carry its load is caught below
        rows.push(` e${c}_${i}_${axis}: ${terms.join("\n  ")} = ${rhs}`);
      }
    members.forEach((_, k) => {
      rows.push(` t${c}_${k}: + 1 q${c}_${k} - ${tension} at${k} <= 0`);
      rows.push(` c${c}_${k}: - 1 q${c}_${k} - ${compression} ac${k} <= 0`);
      const sign = signs[k] ?? 0;
      bounds.push(sign < 0 ? ` -inf <= q${c}_${k} <= 0` : sign > 0 ? ` q${c}_${k} >= 0` : ` q${c}_${k} free`);
    });
    supports.forEach((_, r) => bounds.push(compressionOnly.includes(r) ? ` r${c}_${r} >= 0` : ` r${c}_${r} free`));
  });
  // A loaded node no member or support reaches can't be in equilibrium.
  const reached = new Set([...members.flat(), ...supports.map((s) => s[0])]);
  if (loads.some((load) => load.some((f, i) => !reached.has(i) && (f[0] !== 0 || f[1] !== 0)))) return { ok: false, status: "Infeasible", message: "A loaded node isn't connected to the model." };

  // Target reactions, in two stages: first the least total departure from the targets (Σ|r − target|),
  // then the least volume with that departure held. The volume objective can't trade away the boundary.
  const dev: string[] = [];
  if (targets)
    targets.forEach((row, c) =>
      row.forEach((t, r) => {
        if (t === null || t === undefined || !Number.isFinite(t) || c >= loads.length || r >= supports.length) return;
        rows.push(` d${c}_${r}: + 1 r${c}_${r} - 1 dp${c}_${r} + 1 dn${c}_${r} = ${t}`);
        dev.push(`dp${c}_${r}`, `dn${c}_${r}`);
      }),
    );
  let deviation = 0;
  if (dev.length) {
    const first = await solve(`Minimize\n obj: ${dev.map((d) => `+ 1 ${d}`).join("\n  ")}\nSubject To\n${rows.join("\n")}\nBounds\n${bounds.join("\n")}\nEnd\n`);
    if (first.status !== "Optimal") return { ok: false, status: first.status, message: "No equilibrium is possible with these members, supports and target reactions." };
    deviation = dev.reduce((s, d) => s + (first.values[d] ?? 0), 0);
    rows.push(` dev: ${dev.map((d) => `+ 1 ${d}`).join("\n  ")} <= ${deviation + 1e-7 * Math.max(1, ...loads.flat(2).map(Math.abs))}`);
  }
  const lp = `Minimize\n obj: ${obj.join("\n  ")}\nSubject To\n${rows.join("\n")}\nBounds\n${bounds.join("\n")}\nEnd\n`;
  const sol = await solve(lp);
  if (sol.status !== "Optimal")
    return { ok: false, status: sol.status, message: sol.status === "Infeasible" ? `No equilibrium is possible with these members and supports${signs.some((s) => s) ? ", with the members' roles as set (strut or tie only)" : ""}.` : `The solver stopped: ${sol.status}.` };
  const v = (name: string) => sol.values[name] ?? 0;
  const tensionArea = members.map((_, k) => Math.max(0, v(`at${k}`)));
  const compressionArea = members.map((_, k) => Math.max(0, v(`ac${k}`)));
  const forces = loads.map((_, c) => members.map((__, k) => v(`q${c}_${k}`)));
  const reactions = loads.map((_, c) => supports.map((__, r) => v(`r${c}_${r}`)));

  // Independent equilibrium residual, as a check on the solver's answer.
  let residual = 0;
  loads.forEach((load, c) => {
    const sum = load.map((f) => [f[0], f[1]]);
    members.forEach(([a, b], k) => {
      for (const axis of [0, 1]) {
        sum[a][axis] += units[k][axis] * forces[c][k];
        sum[b][axis] -= units[k][axis] * forces[c][k];
      }
    });
    supports.forEach(([node, axis], r) => (sum[node][axis] += reactions[c][r]));
    for (const f of sum) residual = Math.max(residual, Math.abs(f[0]), Math.abs(f[1]));
  });
  const scale = Math.max(1, ...loads.flat(2).map(Math.abs));
  if (residual > 1e-6 * scale) return { ok: false, status: "Residual", message: "The solver's answer failed the equilibrium check." };

  const activeIndex = members.map((_, k) => k).filter((k) => forces.some((f) => Math.abs(f[k]) > 1e-9 * scale));
  const active = activeIndex.map((k) => members[k]);
  const required = nodes.map((_, i) => i).filter((i) => loads.some((l) => l[i][0] !== 0 || l[i][1] !== 0));
  const stability = screen(nodes, active, supports, required);
  const objective = members.reduce((s, _, k) => s + lengths[k] * (tensionArea[k] + compressionArea[k]), 0);
  return { ok: true, objective, tensionArea, compressionArea, forces, reactions, active, activeIndex, stability, residual, deviation };
}
