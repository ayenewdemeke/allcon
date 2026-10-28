"use client";

import type { MathfieldElement } from "mathlive";

// MathLive, loaded on first use (it's browser-only): the math field regions are typed in, and
// static rendering for regions that aren't being edited. Set up to type like Mathcad: ":" is
// the definition operator, "*" the multiplication dot, and names spelled out become symbols.

type MathLive = typeof import("mathlive");
let loading: Promise<MathLive> | null = null;

export function loadMathLive() {
  loading ??= import("mathlive").then((ml) => {
    ml.MathfieldElement.fontsDirectory = null; // the fonts come with mathlive/fonts.css
    ml.MathfieldElement.soundsDirectory = null;
    return ml;
  });
  return loading;
}

/** Names spelled out that become symbols as you type (no "in": that's inches here). */
const SHORTCUTS: Record<string, string> = {
  alpha: "\\alpha",
  beta: "\\beta",
  gamma: "\\gamma",
  delta: "\\delta",
  epsilon: "\\varepsilon",
  zeta: "\\zeta",
  theta: "\\theta",
  kappa: "\\kappa",
  lambda: "\\lambda",
  mu: "\\mu",
  nu: "\\nu",
  xi: "\\xi",
  pi: "\\pi",
  rho: "\\rho",
  sigma: "\\sigma",
  tau: "\\tau",
  phi: "\\phi",
  chi: "\\chi",
  psi: "\\psi",
  omega: "\\omega",
  Gamma: "\\Gamma",
  Delta: "\\Delta",
  Theta: "\\Theta",
  Lambda: "\\Lambda",
  Sigma: "\\Sigma",
  Phi: "\\Phi",
  Omega: "\\Omega",
  sqrt: "\\sqrt{#0}",
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  ln: "\\ln",
  log: "\\log",
  exp: "\\exp",
  max: "\\max",
  min: "\\min",
  "<=": "\\le",
  ">=": "\\ge",
  "!=": "\\ne",
};

/** A math field set up for worksheet math. Some options apply only once it's in the page, so
 * they're set when it mounts. */
export function makeField(ml: MathLive, latex: string): MathfieldElement {
  const mf = new ml.MathfieldElement();
  mf.value = latex;
  mf.addEventListener(
    "mount",
    () => {
      mf.mathModeSpace = "\\,";
      mf.smartFence = true;
      mf.smartSuperscript = true;
      mf.mathVirtualKeyboardPolicy = "manual";
      mf.menuItems = [];
      mf.inlineShortcuts = SHORTCUTS;
      mf.keybindings = [
        ...mf.keybindings,
        { key: ":", ifMode: "math", command: ["insert", "\\coloneq"] },
        { key: "*", ifMode: "math", command: ["insert", "\\cdot"] },
      ];
    },
    { once: true },
  );
  return mf;
}

export type { MathfieldElement };
