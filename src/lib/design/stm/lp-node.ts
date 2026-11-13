import type { LpSolver } from "./optimizer";

// HiGHS in Node (the server's calc package and the tests): the package finds its own wasm.

type Highs = { solve: (lp: string, options?: Record<string, unknown>) => { Status: string; Columns: Record<string, { Primal?: number }> } };
let instance: Promise<Highs> | null = null;

async function load(): Promise<Highs> {
  const mod = (await import("highs")) as unknown as { default?: (o?: object) => Promise<Highs> } & ((o?: object) => Promise<Highs>);
  const loader = mod.default ?? mod;
  return loader({});
}

export const nodeLpSolver: LpSolver = async (lp) => {
  instance ??= load();
  let highs = await instance;
  let out;
  try {
    out = highs.solve(lp, { time_limit: 60 });
  } catch {
    // A failed solve can leave the wasm instance unusable: start a fresh one and try once more.
    instance = load();
    highs = await instance;
    out = highs.solve(lp, { time_limit: 60 });
  }
  return { status: out.Status, values: Object.fromEntries(Object.entries(out.Columns).map(([k, c]) => [k, c.Primal ?? 0])) };
};
