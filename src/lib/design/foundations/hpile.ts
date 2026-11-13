// Steel H-piles: the sections (AISC Shapes Database v16, the repo's src/lib/calcs/library table) and
// their structural resistance by AASHTO LRFD (10th Edition): axial compression (6.9.4.1.1 with the
// effective width of slender flanges, 6.9.4.2.2), flexure about either axis (6.12.2.2.1 for the weak
// axis; the strong axis by the same flange local buckling, the pile braced by the soil so lateral–
// torsional buckling does not apply), axial with flexure (6.9.2.2.1) and the pile's resistance
// factors (6.5.4.2, 6.15.2). Kip and inch.

export type HpSection = { W: number; A: number; d: number; bf: number; tw: number; tf: number; Ix: number; Zx: number; Sx: number; Iy: number; Zy: number; Sy: number };

export const HP_SECTIONS: Record<string, HpSection> = {
  "HP8x36": { W: 36, A: 10.6, d: 8.02, bf: 8.16, tw: 0.445, tf: 0.445, Ix: 119, Zx: 33.6, Sx: 29.8, Iy: 40.3, Zy: 15.2, Sy: 9.88 },
  "HP10x42": { W: 42, A: 12.4, d: 9.7, bf: 10.1, tw: 0.415, tf: 0.42, Ix: 210, Zx: 48.3, Sx: 43.4, Iy: 71.7, Zy: 21.8, Sy: 14.2 },
  "HP10x57": { W: 57, A: 16.7, d: 9.99, bf: 10.2, tw: 0.565, tf: 0.565, Ix: 294, Zx: 66.5, Sx: 58.8, Iy: 101, Zy: 30.3, Sy: 19.7 },
  "HP12x53": { W: 53, A: 15.5, d: 11.8, bf: 12, tw: 0.435, tf: 0.435, Ix: 393, Zx: 74, Sx: 66.7, Iy: 127, Zy: 32.2, Sy: 21.1 },
  "HP12x63": { W: 63, A: 18.4, d: 11.9, bf: 12.1, tw: 0.515, tf: 0.515, Ix: 472, Zx: 88.3, Sx: 79.1, Iy: 153, Zy: 38.7, Sy: 25.3 },
  "HP12x74": { W: 74, A: 21.8, d: 12.1, bf: 12.2, tw: 0.605, tf: 0.61, Ix: 569, Zx: 105, Sx: 93.8, Iy: 186, Zy: 46.6, Sy: 30.4 },
  "HP12x84": { W: 84, A: 24.6, d: 12.3, bf: 12.3, tw: 0.685, tf: 0.685, Ix: 650, Zx: 120, Sx: 106, Iy: 213, Zy: 53.2, Sy: 34.6 },
  "HP14x73": { W: 73, A: 21.4, d: 13.6, bf: 14.6, tw: 0.505, tf: 0.505, Ix: 729, Zx: 118, Sx: 107, Iy: 261, Zy: 54.6, Sy: 35.8 },
  "HP14x89": { W: 89, A: 26.1, d: 13.8, bf: 14.7, tw: 0.615, tf: 0.615, Ix: 904, Zx: 146, Sx: 131, Iy: 326, Zy: 67.7, Sy: 44.3 },
  "HP14x102": { W: 102, A: 30.1, d: 14, bf: 14.8, tw: 0.705, tf: 0.705, Ix: 1050, Zx: 169, Sx: 150, Iy: 380, Zy: 78.8, Sy: 51.4 },
  "HP14x117": { W: 117, A: 34.4, d: 14.2, bf: 14.9, tw: 0.805, tf: 0.805, Ix: 1220, Zx: 194, Sx: 172, Iy: 443, Zy: 91.4, Sy: 59.5 },
};

/** CDOT pay items for steel piling by section (Master Item Code Book). */
export const HP_PAY_ITEM: Record<string, string> = {
  "HP8x36": "502-10836",
  "HP10x57": "502-11057",
  "HP12x53": "502-11253",
  "HP12x63": "502-11263",
  "HP12x74": "502-11274",
  "HP12x84": "502-11284",
  "HP14x73": "502-11473",
  "HP14x89": "502-11489",
  "HP14x102": "502-14102",
  "HP14x117": "502-14117",
};

export const ES = 29000;

/**
 * The embedment for a fixed pile head (CDOT BDM 10.5.3): the flange bearing on the cap's concrete,
 * Mp = 0.85·φ·f'c·bf·L² / 3.6 (the embedded-steel bearing formula of Marcakis and Mitchell, PCI), so
 * L = √(3.6·Mp / (0.85·φ·f'c·bf)) with φ = 0.7 (AASHTO 5.5.4.2). With f'c = 4.5 ksi it gives the BDM's
 * Table 10-1 (HP 12x53 20 in, 12x74 24 in, 14x89 26 in) to the nearest inch.
 */
export function fixityEmbedment(s: HpSection, Fy: number, fc: number) {
  const Mp = Fy * s.Zx;
  return Math.sqrt((3.6 * Mp) / (0.85 * 0.7 * fc * s.bf));
}

/** Axial compressive resistance (kip) for an effective length KL (in) about the weaker axis, AASHTO 6.9.4.1.1 / 6.9.4.2.2. */
export function axialResistance(s: HpSection, Fy: number, KL: number) {
  const r = Math.sqrt(Math.min(s.Ix, s.Iy) / s.A);
  const Po = Fy * s.A;
  const Pe = KL > 0 ? (Math.PI ** 2 * ES * s.A) / (KL / r) ** 2 : Infinity;
  const Pcr = Po / Pe <= 2.25 ? 0.658 ** (Po / Pe) * Po : 0.877 * Pe; // Eqs. 6.9.4.1.1-1, -2 as Pcr
  const Fcr = Pcr / s.A;
  // Slender flanges (Table 6.9.4.2.1-1: rolled I-flanges λr = 0.56√(E/Fy), b = half the flange).
  const b = s.bf / 2;
  const lam = b / s.tf;
  const lr = 0.56 * Math.sqrt(ES / Fy);
  let Aeff = s.A;
  if (lam > lr * Math.sqrt(Fy / Fcr)) {
    const c1 = 0.22;
    const c2 = (1 - Math.sqrt(1 - 4 * c1)) / (2 * c1); // 1.49, AASHTO Table 6.9.4.2.2b-1 case "all other elements"
    const Fel = ((c2 * lr) / lam) ** 2 * Fy;
    const be = b * (1 - c1 * Math.sqrt(Fel / Fcr)) * Math.sqrt(Fel / Fcr);
    Aeff = s.A - 4 * (b - Math.min(b, be)) * s.tf;
  }
  return { Pn: Fcr * Aeff, Po, Pe, Fcr, Aeff, slender: Aeff < s.A, r };
}

/** Flexural resistance (kip·in) about the strong ("x") or weak ("y") axis: yielding and flange local buckling. */
export function flexuralResistance(s: HpSection, Fy: number, axis: "x" | "y") {
  const lam = s.bf / (2 * s.tf);
  const lp = 0.38 * Math.sqrt(ES / Fy);
  const lr = 1.0 * Math.sqrt(ES / Fy);
  const Z = axis === "x" ? s.Zx : s.Zy;
  const S = axis === "x" ? s.Sx : s.Sy;
  const Mp = Math.min(Fy * Z, axis === "y" ? 1.6 * Fy * S : Infinity);
  const Mn = lam <= lp ? Mp : lam <= lr ? Mp - (Mp - 0.7 * Fy * S) * ((lam - lp) / (lr - lp)) : (0.69 * ES * S) / lam ** 2;
  return { Mn: Math.min(Mp, Mn), Mp, compact: lam <= lp, lam, lp, lr };
}

/** The interaction of AASHTO 6.9.2.2.1 (Eqs. -1 and -2 for sections compact in flexure, otherwise -3). */
export function interaction(Pu: number, Pr: number, Mux: number, Mrx: number, Muy: number, Mry: number, compact: boolean) {
  const m = Math.abs(Mux) / Mrx + Math.abs(Muy) / Mry;
  const p = Math.max(0, Pu) / Pr;
  if (!compact) return { value: p + m, eq: "6.9.2.2.1-3" };
  return p < 0.2 ? { value: p / 2 + m, eq: "6.9.2.2.1-1" } : { value: p + (8 / 9) * m, eq: "6.9.2.2.1-2" };
}

/** AASHTO 6.5.4.2 resistance factors for H-piles. */
export const PHI_PILE = {
  axialSevere: 0.5, // compression only, severe driving
  axialGood: 0.6, // compression only, good driving
  combinedAxial: 0.7, // axial in the axial–flexure interaction
  flexure: 1.0,
};
