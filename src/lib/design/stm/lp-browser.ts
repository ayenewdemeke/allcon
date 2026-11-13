import type { LpSolver } from "./optimizer";

// HiGHS in the browser: its script and wasm are served from /wasm (copied there on install), not
// bundled, since the script reaches for Node's fs when it runs in Node.

type Highs = { solve: (lp: string, options?: Record<string, unknown>) => { Status: string; Columns: Record<string, { Primal?: number }> } };
type Loader = (o: { locateFile: (file: string) => string }) => Promise<Highs>;
let script: Promise<Loader> | null = null;
let instance: Promise<Highs> | null = null;

function loadScript(): Promise<Loader> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Module?: unknown };
    const before = w.Module;
    const tag = document.createElement("script");
    tag.src = "/wasm/highs.js";
    tag.async = true;
    tag.onload = () => {
      const loader = w.Module as Loader | undefined;
      w.Module = before; // the script defines a global Module; hand back whatever was there
      if (typeof loader === "function") resolve(loader);
      else reject(new Error("The solver didn't load"));
    };
    tag.onerror = () => reject(new Error("The solver couldn't be loaded"));
    document.head.appendChild(tag);
  });
}

async function load() {
  script ??= loadScript();
  const loader = await script;
  return loader({ locateFile: (file) => `/wasm/${file}` });
}

export const browserLpSolver: LpSolver = async (lp) => {
  instance ??= load();
  let highs = await instance;
  let out;
  try {
    out = highs.solve(lp, { time_limit: 60 });
  } catch {
    instance = load();
    highs = await instance;
    out = highs.solve(lp, { time_limit: 60 });
  }
  return { status: out.Status, values: Object.fromEntries(Object.entries(out.Columns).map(([k, c]) => [k, c.Primal ?? 0])) };
};
