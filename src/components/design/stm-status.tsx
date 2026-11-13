import { Card, CardContent } from "@/components/ui/card";
import type { StmResult } from "@/lib/design/stm/strut-tie";
import { cn } from "@/lib/utils";
import { fmt } from "./design-kit";

// The model's details, closed by default: what still needs input, the model's state (equilibrium
// checked case by case apart from the solver, angles, crossings, mechanisms), and the supports'
// reactions by case. The checks table already shows the passes; here only what isn't checked.

const OPEN = new Set(["missing-input", "not-checked"]);
const STATUS: Record<string, { text: string; cls: string }> = {
  fail: { text: "Fail", cls: "text-red-700 dark:text-red-400" },
  "missing-input": { text: "Needs input", cls: "text-amber-700 dark:text-amber-400" },
  "not-checked": { text: "Not checked", cls: "text-amber-700 dark:text-amber-400" },
};
const OK = "text-emerald-700 dark:text-emerald-400";
const BAD = "text-red-700 dark:text-red-400";

/** How many items need input or aren't checked (shown in the results banner). */
export const openItems = (r: StmResult) => r.coverage.filter((c) => OPEN.has(c.status)).length;

export function StmModelStatus({ result: r }: { result: StmResult }) {
  const open = r.coverage.filter((c) => OPEN.has(c.status));
  const notEvaluated = r.coverage.filter((c) => c.status === "not-implemented");
  const failing = r.coverage.filter((c) => c.status === "fail");
  const worst = Math.max(...r.perCase.map((p) => p.equilibrium.nodal));
  return (
    <Card>
      <CardContent className="py-1 text-xs">
        <details className="group">
          <summary className="cursor-pointer py-2 font-semibold">
            Model details{" "}
            <span className="font-normal text-muted-foreground">
              · {r.status.equilibrium ? "equilibrium in every case" : <span className={BAD}>not in equilibrium in every case</span>}
              {open.length > 0 && ` · ${open.length} item${open.length > 1 ? "s need" : " needs"} input`}
            </span>
          </summary>
          <div className="space-y-3 overflow-x-auto pb-3">
            {failing.length > 0 && (
              <div>
                <p className="pb-1 font-medium">Failing</p>
                <table className="w-full">
                  <tbody>
                    {failing.map((c, k) => (
                      <tr key={k} className="border-b border-border/40 align-top">
                        <td className="py-0.5 pr-2">{c.item}</td>
                        <td className={cn("pr-2 whitespace-nowrap", STATUS.fail.cls)}>{STATUS.fail.text}</td>
                        <td className="text-muted-foreground">{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {open.length > 0 && (
              <div>
                <p className="pb-1 font-medium">Needs input or not checked (not counted as passing)</p>
                <table className="w-full">
                  <tbody>
                    {open.map((c, k) => (
                      <tr key={k} className="border-b border-border/40 align-top">
                        <td className="py-0.5 pr-2">{c.item}</td>
                        <td className={cn("pr-2 whitespace-nowrap", STATUS[c.status].cls)}>{STATUS[c.status].text}</td>
                        <td className="text-muted-foreground">{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {notEvaluated.length > 0 && <p className="text-muted-foreground">Not evaluated by the tool: {[...new Set(notEvaluated.filter((c) => c.group !== "strut").map((c) => c.item.toLowerCase()))].concat(notEvaluated.some((c) => c.group === "strut") ? ["strut widths and their fit"] : []).join("; ")}.</p>}

            <div>
              <p className="pb-1 font-medium">Model</p>
              <ul className="space-y-0.5">
                <li>
                  Equilibrium, checked case by case from the forces, loads and reactions: <span className={r.status.equilibrium ? OK : BAD}>{r.status.equilibrium ? `all ${r.perCase.length} cases (largest residual ${worst.toExponential(1)} kip)` : "fails in some cases"}</span>
                </li>
                <li>
                  Strut-tie angles over 25° (5.8.2.2): <span className={r.status.angles ? OK : BAD}>{r.status.angles ? "every case" : "fails in some cases"}</span>
                  {" "}(smallest {Math.min(...r.perCase.map((p) => p.smallestAngle ?? 90)).toFixed(1)}°)
                </li>
                <li>Crossing members: {r.status.crossings} · Truss mechanisms: {r.status.mechanisms} (restrained by the concrete)</li>
                <li>
                  Finite geometry (strut widths, nodal zones, bar fit):{" "}
                  {r.status.finiteGeometry === "not-implemented" ? (
                    <span className="text-muted-foreground">worked out only for a model built from a standard cap</span>
                  ) : (
                    <span className={r.status.finiteGeometry === "pass" ? OK : BAD}>{r.status.finiteGeometry === "pass" ? "fits" : "see the failing items"}</span>
                  )}
                </li>
                <li>Column boundary: {r.boundary.kind === "solver" ? "reactions from statics" : `near the column's linear stress (departure ${fmt(r.boundary.deviation, 1)} kip)`}</li>
              </ul>
            </div>

            <div>
              <p className="pb-1 font-medium">Support reactions by case (kip, + up)</p>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="font-normal">Support</th>
                    {r.perCase.map((_, k) => (
                      <th key={k} className="text-right font-normal" title={r.perCase[k].name}>
                        {k + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.supportReport.map((s, k) => (
                    <tr key={k} className="border-b border-border/40">
                      <td>
                        {s.node} {s.direction === "y" ? "↕" : "↔"}
                        {s.upwardOnly ? " up only" : ""}
                      </td>
                      {s.reactions.map((v, c) => (
                        <td key={c} className="text-right tabular-nums" title={s.target && s.target[c] !== null ? `Linear-stress target ${fmt(s.target[c]!, 1)} kip` : undefined}>
                          {fmt(v, 1)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
