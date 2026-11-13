import { num } from "../calc-style";

// Pieces of the quantity sheets' worked-out math (Calcs LaTeX with units), for the take-offs.

export const inT = (v: number) => `${num(v)}\\mathrm{in}`;
export const ftT = (v: number) => `${num(v)}\\mathrm{ft}`;
/** A rate per foot: CY/LF or lb/LF. */
export const perFtT = (v: number, u: "yd^3" | "lb") => `${num(v)}\\frac{${u === "lb" ? "\\mathrm{lb}" : "\\mathrm{yd}^{3}"}}{\\mathrm{ft}}`;
/** (a + b) / 2: an average, or a if they're equal. */
export const avgT = (a: string, b: string) => (a === b ? a : `\\frac{${a}+${b}}{2}`);
/** 1'-6" each side (M-206-1/-2): x + 2·18 in. */
export const plus18T = (x: string, sides = 2) => `\\left(${x}+${sides === 1 ? "" : `${sides}\\cdot `}18\\mathrm{in}\\right)`;
/** A sum in brackets when it has more than one term. */
export const sumT = (terms: string[]) => (terms.length > 1 ? `\\left(${terms.join("+")}\\right)` : terms[0]);
