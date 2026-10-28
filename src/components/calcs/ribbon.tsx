"use client";

import { useState } from "react";
import { Calculator, FileText, Heading1, Heading2, Printer, Ruler, Sigma, StickyNote, Type } from "lucide-react";
import type { CalcDocument } from "@/lib/calcs/document";
import { PAGES, type Paper } from "@/lib/calcs/types";
import { cn } from "@/lib/utils";
import type { WorksheetHandle } from "./worksheet";

// The ribbon, as Mathcad Prime's: Math (regions, operators, Greek, functions, units),
// Calculation (unit system, result format) and Document (paper, the calc paper's header, print).

type Tab = "math" | "calculation" | "document";

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

export function CalcRibbon({ doc, worksheet, quickAccess, status }: { doc: CalcDocument; worksheet: React.RefObject<WorksheetHandle | null>; quickAccess: React.ReactNode; status: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("math");
  const insert = (latex: string) => worksheet.current?.insertMath(latex);
  return (
    <div className="no-print border-b bg-muted/40">
      <div className="flex items-end gap-0.5 px-2 pt-1 text-xs">
        <div className="mr-2 flex items-center gap-0.5 self-center pb-0.5">{quickAccess}</div>
        {(
          [
            ["math", "Math"],
            ["calculation", "Calculation"],
            ["document", "Document"],
          ] as const
        ).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-t px-3 py-1", tab === t ? "bg-background font-medium text-foreground shadow-[0_-1px_0_0] shadow-border" : "text-muted-foreground hover:text-foreground")}>
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
            </Panel>
            <Panel title="Operators">
              <div className="grid grid-cols-6 gap-0.5 pt-0.5">
                {OPERATORS.map(([label, latex, title]) => (
                  <Key key={title} label={label} title={title} onClick={() => insert(latex)} />
                ))}
              </div>
            </Panel>
            <Panel title="Greek">
              <div className="grid grid-cols-10 gap-0.5 pt-0.5">
                {GREEK.slice(0, 20).map((g) => (
                  <Key key={g} label={GREEK_CHARS[g]} title={`${g.replace("var", "")} (type ${g.replace("var", "")})`} onClick={() => insert(`\\${g}`)} />
                ))}
              </div>
            </Panel>
            <Panel title="Functions">
              <div className="grid grid-cols-5 gap-0.5 pt-0.5">
                {FUNCTIONS.slice(0, 10).map(([label, latex, title]) => (
                  <Key key={label} label={<span className="font-sans text-[11px]">{label}</span>} title={title} wide onClick={() => insert(latex)} />
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
            <Panel title="Header">
              <HeaderFields doc={doc} />
            </Panel>
            <Panel title="Output">
              <Big icon={Printer} label="Print / PDF" title="Print, or save as PDF (Ctrl+P)" onClick={() => window.print()} />
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
