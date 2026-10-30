"use client";

import { useState } from "react";
import { Calculator, ChartSpline, FileText, FolderKanban, Grid2x2, Grid3x3, Heading1, Heading2, LayoutTemplate, Loader2, Printer, Ruler, Send, Sigma, SquareFunction, StickyNote, Table2, Type } from "lucide-react";
import type { CalcDocument } from "@/lib/calcs/document";
import { CALC_COLORS } from "@/lib/calcs/colors";
import { materials } from "@/lib/calcs/library/materials";
import { layout, snippetLines, TEMPLATES } from "@/lib/calcs/library/templates";
import { PAGES, type Paper } from "@/lib/calcs/types";
import { cn } from "@/lib/utils";
import type { WorksheetHandle } from "./worksheet";

// The ribbon, as Mathcad Prime's: Math (regions, operators, calculus, Greek, units), Functions
// (functions, programming, solving), Matrices/Tables, Plots, Calculation (unit system, result
// format) and Document (paper, the calc paper's header, print).

type Tab = "math" | "functions" | "matrices" | "plots" | "library" | "calculation" | "document";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col border-r px-2 last:border-r-0">
      <div className="flex flex-1 items-start gap-1 pt-1">{children}</div>
      <div className="pb-0.5 text-center text-[10px] text-muted-foreground">{title}</div>
    </div>
  );
}

function Big({ icon: Icon, label, title, onClick, active }: { icon: React.ComponentType<{ className?: string }>; label: string; title?: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" title={title ?? label} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn("flex w-14 flex-col items-center gap-0.5 rounded px-1 py-1 text-center text-[11px] leading-tight hover:bg-accent", active && "bg-accent")}>
      <Icon className="size-6 shrink-0" />
      <span className="line-clamp-2">{label}</span>
    </button>
  );
}

/** A button that types math: keeps the focus in the math being edited. */
function Key({ label, title, onClick, wide }: { label: React.ReactNode; title: string; onClick: () => void; wide?: boolean }) {
  return (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn("flex h-6 items-center justify-center rounded border bg-background px-1 font-serif text-[13px] hover:border-primary hover:bg-accent", wide ? "min-w-12" : "min-w-6")}>
      {label}
    </button>
  );
}

const OPERATORS: [string, string, string][] = [
  [":=", "\\coloneq", "Definition (:)"],
  ["=", "=", "Evaluation (=)"],
  ["≤", "\\le", "Less than or equal (<=)"],
  ["≥", "\\ge", "Greater than or equal (>=)"],
  ["≠", "\\ne", "Not equal (!=)"],
  ["√", "\\sqrt{#0}", "Square root (sqrt)"],
  ["ⁿ√", "\\sqrt[#0]{#?}", "Nth root"],
  ["x²", "^{2}", "Squared"],
  ["xⁿ", "^{#0}", "Power (^)"],
  ["a/b", "\\frac{#@}{#?}", "Division (/)"],
  ["|x|", "\\left|#0\\right|", "Absolute value"],
  ["·", "\\cdot", "Multiplication (*)"],
];

const GREEK = "alpha beta gamma delta varepsilon zeta eta theta kappa lambda mu nu xi pi rho sigma tau phi chi psi omega Gamma Delta Theta Lambda Sigma Phi Psi Omega".split(" ");
const GREEK_CHARS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const FUNCTIONS: [string, string, string][] = [
  ["if", "\\operatorname{if}\\left(#0,#?,#?\\right)", "if(condition, value if true, value if false)"],
  ["max", "\\max\\left(#0\\right)", "Largest of the values"],
  ["min", "\\min\\left(#0\\right)", "Smallest of the values"],
  ["sin", "\\sin\\left(#0\\right)", "Sine (angles in rad or deg)"],
  ["cos", "\\cos\\left(#0\\right)", "Cosine"],
  ["tan", "\\tan\\left(#0\\right)", "Tangent"],
  ["atan", "\\arctan\\left(#0\\right)", "Inverse tangent"],
  ["ln", "\\ln\\left(#0\\right)", "Natural logarithm"],
  ["log", "\\log\\left(#0\\right)", "Base-10 logarithm"],
  ["exp", "\\exp\\left(#0\\right)", "e to the power"],
  ["round", "\\operatorname{round}\\left(#0,#?\\right)", "Round to n decimal places"],
  ["ceil", "\\operatorname{ceil}\\left(#0\\right)", "Round up"],
  ["floor", "\\operatorname{floor}\\left(#0\\right)", "Round down"],
];

const CALCULUS: [string, string, string][] = [
  ["Σ", "\\sum_{#0=#?}^{#?}#?", "Summation over i = a to b"],
  ["Σᵢ", "\\sum_{#0}#?", "Summation over a range variable's values"],
  ["Π", "\\prod_{#0=#?}^{#?}#?", "Product over i = a to b"],
  ["∫", "\\int_{#0}^{#?}#?\\,d#?", "Definite integral"],
  ["d/dx", "\\frac{d}{d#0}#?", "Derivative, at the variable's value"],
  ["d²/dx²", "\\frac{d^2}{d#0^2}#?", "Second derivative"],
  ["a..b", "#0..#?", "Range: first..last (;)"],
  ["a,b..c", "#0,#?..#?", "Range with a step: first, second..last"],
];

const PROGRAMMING: [string, string, string][] = [
  ["if … otherwise", "\\begin{cases}#0 & #?\\\\ #? & \\text{otherwise}\\end{cases}", "Piecewise: the value whose condition holds, else the otherwise value"],
  ["if ×3", "\\begin{cases}#0 & #?\\\\ #? & #?\\\\ #? & \\text{otherwise}\\end{cases}", "Piecewise with two conditions"],
  ["if( )", "\\operatorname{if}\\left(#0,#?,#?\\right)", "if(condition, value if true, value if false)"],
];

const SOLVING: [string, string, string][] = [
  ["root", "\\operatorname{root}\\left(#0,#?\\right)", "root(f(x), x): where f(x) = 0, from x's value as a guess; root(f(x), x, a, b) within a..b"],
  ["find", "\\operatorname{find}\\left(#0\\right)", "find(x, y): the solve block's answer, for its solver line"],
  ["minimize", "\\operatorname{minimize}\\left(#0,#?\\right)", "minimize(f, x): the x where f is least, from x's value"],
  ["maximize", "\\operatorname{maximize}\\left(#0,#?\\right)", "maximize(f, x): the x where f is greatest, from x's value"],
  ["polyroots", "\\operatorname{polyroots}\\left(#0\\right)", "polyroots(v): a polynomial's roots, from its coefficients (constant first)"],
];

const SYMBOLICS: [string, string, string][] = [
  ["→", "\\to", "Symbolic evaluation (Ctrl+. or ->): works the expression out with names kept as names"],
  ["simplify", "\\operatorname{simplify}\\left(#0\\right)\\to", "simplify(e): the simplest form"],
  ["expand", "\\operatorname{expand}\\left(#0\\right)\\to", "expand(e): products and powers multiplied out"],
  ["factor", "\\operatorname{factor}\\left(#0\\right)\\to", "factor(e): as a product of factors"],
  ["solve", "\\operatorname{solve}\\left(#0,#?\\right)\\to", "solve(equation, x): x in terms of the rest"],
  ["subs", "\\operatorname{subs}\\left(#0,#?=#?\\right)\\to", "subs(e, x = a): e with x replaced by a"],
  ["series", "\\operatorname{series}\\left(#0,#?\\right)\\to", "series(e, x, a, n): Taylor series about a (0) to order n (6)"],
  ["limit", "\\operatorname{limit}\\left(#0,#?,#?\\right)\\to", "limit(e, x, a): the limit as x goes to a"],
  ["partfrac", "\\operatorname{partfrac}\\left(#0\\right)\\to", "partfrac(e): partial fractions"],
  ["collect", "\\operatorname{collect}\\left(#0,#?\\right)\\to", "collect(e, x): grouped by powers of x"],
  ["float", "\\operatorname{float}\\left(#0,6\\right)\\to", "float(e, n): as a decimal, to n digits"],
];

const MATRIX_OPERATORS: [string, string, string][] = [
  ["Mᵀ", "^{T}", "Transpose"],
  ["M⁻¹", "^{-1}", "Inverse"],
  ["|M|", "\\left|#0\\right|", "Determinant (of a vector, its length)"],
  ["M[i]", "\\left[#0\\right]", "Element: v[i], M[i, j] (from 0, ORIGIN)"],
  ["·", "\\cdot", "Matrix product (*)"],
  ["a..b", "#0..#?", "Range (;)"],
];

const MATRIX_FUNCTIONS: [string, string][] = [
  ["rows", "Number of rows"],
  ["cols", "Number of columns"],
  ["length", "Number of elements"],
  ["last", "Index of the last element"],
  ["identity", "identity(n): the n × n identity matrix"],
  ["augment", "augment(A, B): side by side"],
  ["stack", "stack(A, B): one above the other"],
  ["sort", "Sorted, smallest first"],
  ["sum", "Sum of the elements"],
  ["mean", "Mean of the elements"],
  ["median", "Median of the elements"],
  ["stdev", "Standard deviation"],
];

/** An empty rows × cols matrix to fill in. */
const matrixLatex = (rows: number, cols: number) =>
  `\\begin{pmatrix}${Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 && c === 0 ? "#0" : "#?")).join("&")).join("\\\\")}\\end{pmatrix}`;

const UNITS: [string, string[]][] = [
  ["Force", ["kip", "lbf", "kN", "N", "tonf"]],
  ["Length", ["ft", "in", "m", "mm", "cm"]],
  ["Stress", ["ksi", "psi", "psf", "ksf", "MPa", "kPa"]],
  ["Load / length", ["klf", "plf", "kN/m"]],
  ["Unit weight", ["pcf", "kcf", "kN/m^3"]],
  ["Angle", ["deg", "rad"]],
];

/** A unit as math: kN/m → \frac{kN}{m}, kN/m^3 → \frac{kN}{m^{3}}. */
const unitLatex = (u: string) => {
  const [top, bottom] = u.split("/");
  const pow = (s: string) => s.replace(/\^(\d+)/, "^{$1}");
  return bottom ? `\\frac{${pow(top)}}{${pow(bottom)}}` : pow(top);
};

/** The worksheet's project (it can be filed under one), and publishing it to that project's Sheets. */
export type ProjectLink = { projects: { id: string; name: string }[]; projectId: string | null; onProject: (id: string | null) => void; onPublish: () => void; publishing: boolean };

export function CalcRibbon({
  doc,
  worksheet,
  quickAccess,
  status,
  project,
}: {
  doc: CalcDocument;
  worksheet: React.RefObject<WorksheetHandle | null>;
  quickAccess: React.ReactNode;
  status: React.ReactNode;
  project: ProjectLink;
}) {
  const [tab, setTab] = useState<Tab>("math");
  const insert = (latex: string) => worksheet.current?.insertMath(latex);
  const [size, setSize] = useState({ rows: 2, cols: 2 });
  const keys = (items: [string, string, string][], columns: string) => (
    <div className={cn("grid gap-0.5 pt-0.5", columns)}>
      {items.map(([label, latex, title]) => (
        <Key key={title} label={label} title={title} onClick={() => insert(latex)} wide={label.length > 2} />
      ))}
    </div>
  );
  return (
    <div data-ribbon className="no-print border-b bg-muted/40">
      <div className="flex items-end gap-0.5 px-2 pt-1 text-xs">
        <div className="mr-2 flex items-center gap-0.5 self-center pb-0.5">{quickAccess}</div>
        {(
          [
            ["math", "Math"],
            ["functions", "Functions"],
            ["matrices", "Matrices/Tables"],
            ["plots", "Plots"],
            ["library", "Library"],
            ["calculation", "Calculation"],
            ["document", "Document"],
          ] as const
        ).map(([t, label]) => (
          <button key={t} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setTab(t)} className={cn("rounded-t px-3 py-1", tab === t ? "bg-background font-medium text-foreground shadow-[0_-1px_0_0] shadow-border" : "text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
        <div className="ml-auto self-center pb-0.5">{status}</div>
      </div>
      <div className="flex h-[5.25rem] overflow-x-auto bg-background">
        {tab === "math" && (
          <>
            <Panel title="Regions">
              <Big icon={Sigma} label="Math" title="A math region at the crosshair (or just start typing)" onClick={() => insert("")} />
              <Big icon={Type} label="Text" title='A text region (" or Ctrl+T)' onClick={() => worksheet.current?.addText("normal")} />
              <div className="flex flex-col gap-0.5 pt-0.5">
                <SmallButton icon={Heading1} label="Heading" onClick={() => worksheet.current?.addText("heading")} />
                <SmallButton icon={Heading2} label="Subheading" onClick={() => worksheet.current?.addText("subheading")} />
                <SmallButton icon={StickyNote} label="Note" onClick={() => worksheet.current?.addText("note")} />
              </div>
              <Big icon={SquareFunction} label="Solve block" title="A solve block: guess values, constraints and a solver (find)" onClick={() => worksheet.current?.addSolve()} />
            </Panel>
            <Panel title="Color">
              <div className="grid grid-cols-4 gap-1 pt-1">
                {CALC_COLORS.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    title={`${c.name}: the selected text and math`}
                    aria-label={`Color ${c.name}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => worksheet.current?.setColor(c.value)}
                    className="size-5 rounded-full border border-black/10 hover:ring-2 hover:ring-primary/40"
                    style={{ background: c.value ?? "#171717" }}
                  />
                ))}
              </div>
            </Panel>
            <Panel title="Operators">
              <div className="grid grid-cols-6 gap-0.5 pt-0.5">
                {OPERATORS.map(([label, latex, title]) => (
                  <Key key={title} label={label} title={title} onClick={() => insert(latex)} />
                ))}
              </div>
            </Panel>
            <Panel title="Calculus">{keys(CALCULUS, "grid-cols-4")}</Panel>
            <Panel title="Greek">
              <div className="grid grid-cols-10 gap-0.5 pt-0.5">
                {GREEK.slice(0, 20).map((g) => (
                  <Key key={g} label={GREEK_CHARS[g]} title={`${g.replace("var", "")} (type ${g.replace("var", "")})`} onClick={() => insert(`\\${g}`)} />
                ))}
              </div>
            </Panel>
            <Panel title="Units">
              <div className="grid grid-flow-col grid-rows-2 gap-x-2 gap-y-1 pt-0.5">
                {UNITS.map(([group, units]) => (
                  <select
                    key={group}
                    value=""
                    title={group}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => e.target.value && insert(unitLatex(e.target.value))}
                    className="h-6 w-28 rounded border bg-background px-1 text-[11px]"
                  >
                    <option value="">{group}</option>
                    {units.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            </Panel>
          </>
        )}
        {tab === "functions" && (
          <>
            <Panel title="Functions">
              <div className="grid grid-cols-7 gap-0.5 pt-0.5">
                {FUNCTIONS.map(([label, latex, title]) => (
                  <Key key={label} label={<span className="font-sans text-[11px]">{label}</span>} title={title} wide onClick={() => insert(latex)} />
                ))}
              </div>
            </Panel>
            <Panel title="Programming">{keys(PROGRAMMING, "grid-cols-1")}</Panel>
            <Panel title="Symbolics">{keys(SYMBOLICS, "grid-cols-4")}</Panel>
            <Panel title="Solving">
              <Big icon={SquareFunction} label="Solve block" title="A solve block: guess values, constraints and a solver (find)" onClick={() => worksheet.current?.addSolve()} />
              {keys(SOLVING, "grid-cols-3")}
            </Panel>
          </>
        )}
        {tab === "matrices" && (
          <>
            <Panel title="Insert">
              <Big icon={Grid3x3} label="Matrix" title={`A ${size.rows} × ${size.cols} matrix`} onClick={() => insert(matrixLatex(size.rows, size.cols))} />
              <div className="flex flex-col gap-1 pt-1 text-[11px]">
                {(["rows", "cols"] as const).map((k) => (
                  <label key={k} className="flex items-center justify-between gap-1">
                    {k === "rows" ? "Rows" : "Columns"}
                    <select value={size[k]} onChange={(e) => setSize({ ...size, [k]: Number(e.target.value) })} className="h-6 rounded border bg-background px-1">
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <Big icon={Table2} label="Table" title="A table: each column a vector, named and in its unit" onClick={() => worksheet.current?.addTable()} />
            </Panel>
            <Panel title="Operators">{keys(MATRIX_OPERATORS, "grid-cols-3")}</Panel>
            <Panel title="Functions">
              <div className="grid grid-cols-6 gap-0.5 pt-0.5">
                {MATRIX_FUNCTIONS.map(([name, title]) => (
                  <Key key={name} label={<span className="font-sans text-[11px]">{name}</span>} title={title} wide onClick={() => insert(`\\operatorname{${name}}\\left(#0\\right)`)} />
                ))}
              </div>
            </Panel>
          </>
        )}
        {tab === "plots" && (
          <Panel title="Plots">
            <Big icon={ChartSpline} label="XY plot" title="An X-Y plot of expressions or vectors" onClick={() => worksheet.current?.addPlot()} />
            <p className="max-w-64 pt-1 text-[11px] leading-snug text-muted-foreground">Plot y against x: functions, ranges or vectors (table columns too). A function of an undefined x plots from −10 to 10 (QuickPlot).</p>
          </Panel>
        )}
        {tab === "library" && (
          <>
            <Panel title="Steel">
              <Big icon={IBeam} label="Section" title="A steel shape from the AISC tables: defines A, I_x, Z_x... (also section(&quot;W14X22&quot;, &quot;Zx&quot;))" onClick={() => worksheet.current?.addSection()} />
            </Panel>
            <Panel title="Materials and parts">
              <div className="grid grid-flow-col grid-rows-2 gap-x-2 gap-y-1 pt-0.5">
                {materials(doc.settings.system).map((group) => (
                  <select
                    key={group.id}
                    value=""
                    title={`Insert ${group.title.toLowerCase()} properties at the crosshair`}
                    onChange={(e) => {
                      const item = group.items[Number(e.target.value)];
                      if (item) worksheet.current?.insertRegions(layout(snippetLines(item), { x: 0, y: 0 }));
                    }}
                    className="h-6 w-32 rounded border bg-background px-1 text-[11px]"
                  >
                    <option value="">{group.title}</option>
                    {group.items.map((item, i) => (
                      <option key={item.label} value={i}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            </Panel>
            <Panel title="Templates">
              <div className="flex flex-col gap-1 pt-1 text-[11px]">
                <label className="flex items-center gap-2">
                  <LayoutTemplate className="size-4" />
                  <select
                    value=""
                    onChange={(e) => {
                      const t = TEMPLATES.find((x) => x.id === e.target.value);
                      if (t) worksheet.current?.insertRegions(layout(t.lines, { x: 0, y: 0 }, doc.paper));
                    }}
                    className="h-6 w-56 rounded border bg-background px-1"
                  >
                    <option value="">Insert a calc…</option>
                    {TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id} title={t.description}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="max-w-64 text-muted-foreground">AISC 360-22 and ACI 318-19, LRFD: edit the inputs and the checks follow.</span>
              </div>
            </Panel>
          </>
        )}
        {tab === "calculation" && (
          <>
            <Panel title="Units">
              <Big icon={Ruler} label="US customary" title="Results in kip, ft, ksi" onClick={() => doc.setMeta({ settings: { ...doc.settings, system: "USCS" } })} active={doc.settings.system === "USCS"} />
              <Big icon={Ruler} label="SI" title="Results in kN, m, MPa" onClick={() => doc.setMeta({ settings: { ...doc.settings, system: "SI" } })} active={doc.settings.system === "SI"} />
            </Panel>
            <Panel title="Results">
              <div className="flex flex-col gap-1 pt-1 text-[11px]">
                <label className="flex items-center gap-2">
                  <Calculator className="size-4" />
                  Decimal places
                  <select value={doc.settings.decimals} onChange={(e) => doc.setMeta({ settings: { ...doc.settings, decimals: Number(e.target.value) } })} className="h-6 rounded border bg-background px-1">
                    {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <span className="text-muted-foreground">Results recalculate as you type.</span>
              </div>
            </Panel>
          </>
        )}
        {tab === "document" && (
          <>
            <Panel title="Page">
              <div className="flex flex-col gap-1 pt-1 text-[11px]">
                <label className="flex items-center gap-2">
                  <FileText className="size-4" />
                  Paper
                  <select value={doc.paper} onChange={(e) => doc.setMeta({ paper: e.target.value as Paper })} className="h-6 rounded border bg-background px-1">
                    {(Object.keys(PAGES) as Paper[]).map((p) => (
                      <option key={p} value={p}>
                        {PAGES[p].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Panel>
            <Panel title="Grid">
              <Big icon={Grid2x2} label="Show Grid" title="Show and print the gridlines regions line up on" onClick={() => doc.setMeta({ grid: { ...doc.grid, show: !doc.grid.show } })} active={doc.grid.show} />
              <div className="flex flex-col gap-1 pt-1 text-[11px]">
                <label className="flex items-center gap-2">
                  Grid Size
                  <select value={doc.grid.size} onChange={(e) => doc.setMeta({ grid: { ...doc.grid, size: e.target.value as "standard" | "fine" } })} className="h-6 rounded border bg-background px-1">
                    <option value="standard">Standard</option>
                    <option value="fine">Fine</option>
                  </select>
                </label>
                <span className="max-w-40 text-muted-foreground">Regions snap to the grid, shown or not.</span>
              </div>
            </Panel>
            <Panel title="Header">
              <HeaderFields doc={doc} />
            </Panel>
            <Panel title="Project">
              <div className="flex flex-col gap-1 pt-1 text-[11px]">
                <label className="flex items-center gap-2">
                  <FolderKanban className="size-4" />
                  <select value={project.projectId ?? ""} onChange={(e) => project.onProject(e.target.value || null)} className="h-6 w-48 rounded border bg-background px-1" aria-label="Project">
                    <option value="">Not filed under a project</option>
                    {project.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="max-w-56 text-muted-foreground">Publishing adds it to the project&apos;s Sheets, a sheet per page.</span>
              </div>
            </Panel>
            <Panel title="Output">
              <Big icon={Printer} label="Print / PDF" title="Print, or save as PDF (Ctrl+P)" onClick={() => window.print()} />
              <Big
                icon={project.publishing ? Loader2 : Send}
                label="Publish to Sheets"
                title={project.projectId ? "Add this worksheet to the project's Sheets as a PDF" : "File the worksheet under a project first"}
                onClick={() => project.projectId && !project.publishing && project.onPublish()}
                active={false}
              />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function SmallButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="flex h-6 items-center gap-1.5 rounded px-1.5 text-[11px] hover:bg-accent">
      <Icon className="size-4" />
      {label}
    </button>
  );
}

/** The calc paper's header fields, edited in place. */
function HeaderFields({ doc }: { doc: CalcDocument }) {
  const fields: [keyof CalcDocument["header"], string][] = [
    ["project", "Project"],
    ["title", "Subject"],
    ["number", "Calc no."],
    ["by", "By"],
    ["checked", "Checked"],
    ["date", "Date"],
  ];
  return (
    <div className="grid grid-cols-3 gap-x-2 gap-y-1 pt-0.5">
      {fields.map(([key, label]) => (
        <input
          key={`${key}:${doc.header[key]}`}
          defaultValue={doc.header[key]}
          placeholder={label}
          title={label}
          onBlur={(e) => e.target.value !== doc.header[key] && doc.setMeta({ header: { ...doc.header, [key]: e.target.value } })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-6 w-36 rounded border bg-background px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-primary"
        />
      ))}
    </div>
  );
}

/** A wide-flange section, for the Section button. */
function IBeam({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className={className}>
      <path d="M5 4h14v3h-5.5v10H19v3H5v-3h5.5V7H5z" />
    </svg>
  );
}
