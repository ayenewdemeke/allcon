import { bar } from "./aashto";

// Beam ledges of an inverted-T cap, AASHTO LRFD 10th Edition 5.8.4.3, at each girder's bearing:
// shear friction at the stem's face (5.8.4.3.2 with 5.7.4 and Eqs. 5.8.4.2.2-1, -2; monolithic normal
// weight concrete, c = 0 for ledges, μ = 1.4), flexure and horizontal force (5.8.4.3.3 with 5.8.4.2.1
// and Eqs. 5.8.4.2.2-5 to -7), punching shear (5.8.4.3.4), hanger reinforcement at the strength and
// service limit states (5.8.4.3.5), and bearing (5.8.4.3.6 with 5.6.5). Inches, kips, ksi. The
// in-plane strut-and-tie model carries the hanger forces up the stem; torsion (5.7.3.6) is not here.

export type LedgeInput = {
  fc: number;
  fy: number;
  bw: number; // stem width
  bl: number; // each ledge's projection from the stem's face
  hf: number; // ledge depth
  cover: number; // top of the ledge to the primary bars' centroid (de = hf − cover)
  bottomCover: number; // bottom of the ledge to the bottom longitudinal bars' centroid (df = hf − bottomCover)
  av: number; // the stem's face to the bearing's centerline
  W: number; // bearing pad along the ledge
  L: number; // bearing pad across the ledge
  primary: { size: number; spacing: number }; // ledge bars across the stem's face (As, Avf)
  ties: { size: number; spacing: number }; // closed ties in the ledge, within 2de/3 of the primary bars (Ah)
  hangers: { size: number; spacing: number }; // hanger legs (Ahr is one leg)
};

export type LedgeBearing = { label: string; Vu: number; Vs: number; S: number; c: number; exterior: boolean }; // S: to the next bearing along the ledge; c: to the ledge's end (in)

export type LedgeCheck = { id: string; name: string; demand: number; capacity: number; unit: string; ok: boolean; ref: string; note?: string };

const PHI_V = 0.9; // 5.5.4.2, shear (normal weight)
const PHI_F = 0.9; // flexure (tension-controlled)
const PHI_B = 0.7; // bearing on concrete

export function ledgeChecks(i: LedgeInput, b: LedgeBearing): LedgeCheck[] {
  const de = i.hf - i.cover;
  const df = i.hf - i.bottomCover;
  const sqrt = Math.sqrt(i.fc);
  const out: LedgeCheck[] = [];
  const perIn = (g: { size: number; spacing: number }) => bar(g.size).area / g.spacing; // in²/in
  // Shear friction across the stem's face (5.8.4.3.2): b ≤ the lesser of W + 4av (or 2c) and S.
  const bSF = Math.min(i.W + 4 * i.av, b.S, ...(b.exterior ? [2 * b.c] : []));
  const Avf = (perIn(i.primary) + perIn(i.ties)) * bSF;
  const mu = 1.4; // 5.7.4.4, normal weight concrete placed monolithically; c = 0 for ledges
  const VnSF = Math.min(mu * Avf * i.fy, 0.2 * i.fc * bSF * de, 0.8 * bSF * de);
  out.push({ id: `sf-${b.label}`, name: `Ledge at ${b.label}: shear friction at the stem's face (b = ${bSF.toFixed(1)} in)`, demand: b.Vu, capacity: PHI_V * VnSF, unit: "kip", ok: b.Vu <= PHI_V * VnSF, ref: "AASHTO 5.8.4.3.2, Eqs. 5.7.4.3-3, 5.8.4.2.2-1, -2" });
  // Flexure and horizontal force (5.8.4.3.3): Mu = Vu av + Nuc (h − de), Nuc ≥ 0.2 Vu; As over (W + 5av) or 2c, not more than S.
  const bF = Math.min(i.W + 5 * i.av, b.S, ...(b.exterior ? [2 * b.c] : []));
  const As = perIn(i.primary) * bF;
  const Nuc = 0.2 * b.Vu;
  const Mu = b.Vu * i.av + Nuc * (i.hf - de);
  const An = Nuc / (PHI_F * i.fy);
  // Flexure as an ordinary member (rectangular block on the ledge's width bF): As fy (de − a/2) with a = As fy / (0.85 f'c bF).
  const a = ((As - An) * i.fy) / (0.85 * i.fc * bF);
  const Mr = PHI_F * (As - An) * i.fy * (de - a / 2);
  out.push({ id: `fl-${b.label}`, name: `Ledge at ${b.label}: flexure with Nuc = 0.2 Vu (bars over ${bF.toFixed(1)} in)`, demand: Mu, capacity: Mr, unit: "kip·in", ok: Mu <= Mr && As > An, ref: "AASHTO 5.8.4.3.3, Eq. 5.8.4.2.1-1" });
  const AvfReq = b.Vu / (PHI_V * mu * i.fy);
  const AsMin = Math.max((2 * AvfReq) / 3 + An, (0.04 * i.fc * bF * de) / i.fy);
  out.push({ id: `as-${b.label}`, name: `Ledge at ${b.label}: primary bars, 2Avf/3 + An and 0.04 f'c/fy`, demand: AsMin, capacity: As, unit: "in²", ok: As >= AsMin, ref: "AASHTO Eq. 5.8.4.2.2-5, 5.8.4.2.1" });
  const Ah = perIn(i.ties) * bF;
  const AhMin = 0.5 * Math.max(0, As - An);
  out.push({ id: `ah-${b.label}`, name: `Ledge at ${b.label}: closed ties within 2de/3`, demand: AhMin, capacity: Ah, unit: "in²", ok: Ah >= AhMin, ref: "AASHTO Eq. 5.8.4.2.2-6" });
  // Punching (5.8.4.3.4): Vn = 0.125 √f'c bo df; failure surfaces mustn't overlap.
  const overlapAlong = b.S < 2 * df + i.W;
  const overlapAcross = i.bw + 2 * i.av < i.L + 2 * df;
  const boInt = i.W + 2 * i.L + 2 * df;
  const bo = b.exterior ? Math.min(0.5 * i.W + i.L + df + b.c, boInt) : boInt;
  const VnP = 0.125 * sqrt * bo * df;
  out.push({
    id: `pu-${b.label}`,
    name: `Ledge at ${b.label}: punching shear (bo = ${bo.toFixed(1)} in)`,
    demand: b.Vu,
    capacity: PHI_V * VnP,
    unit: "kip",
    ok: b.Vu <= PHI_V * VnP && !overlapAlong && !overlapAcross,
    ref: b.exterior ? "AASHTO Eqs. 5.8.4.3.4-3, -5" : "AASHTO Eqs. 5.8.4.3.4-3, -4",
    note: overlapAlong || overlapAcross ? `The failure surfaces overlap (${overlapAlong ? "S < 2df + W" : "bw + 2av < L + 2df"}): investigate the combined surface (5.8.4.3.4).` : undefined,
  });
  // Hangers (5.8.4.3.5): strength, the lesser of (Ahr fy / s) S and 0.063 √f'c bf df + (Ahr fy / s)(W + 2df); service, 0.5 Ahr fy (W + 3av) / s.
  const Ahr = bar(i.hangers.size).area;
  const s = i.hangers.spacing;
  const bf = i.bw + 2 * i.bl;
  const S2 = Math.min(b.S, ...(b.exterior ? [2 * b.c] : []));
  const VnH = Math.min(((Ahr * i.fy) / s) * S2, 0.063 * sqrt * bf * df + ((Ahr * i.fy) / s) * (i.W + 2 * df));
  out.push({ id: `hs-${b.label}`, name: `Ledge at ${b.label}: hangers, strength`, demand: b.Vu, capacity: PHI_V * VnH, unit: "kip", ok: b.Vu <= PHI_V * VnH, ref: "AASHTO Eqs. 5.8.4.3.5-2, -3" });
  const spread = Math.min(i.W + 3 * i.av, b.exterior ? 2 * b.c : b.S);
  const VnHs = (0.5 * Ahr * i.fy * spread) / s;
  out.push({ id: `hv-${b.label}`, name: `Ledge at ${b.label}: hangers, service`, demand: b.Vs, capacity: VnHs, unit: "kip", ok: b.Vs <= VnHs, ref: "AASHTO Eq. 5.8.4.3.5-1" });
  // Bearing (5.8.4.3.6, 5.6.5): φ 0.85 f'c A1 m, m = √(A2/A1) ≤ 2, A2 similar and concentric within the ledge (1V:2H).
  const A1 = i.W * i.L;
  const toEdge = Math.min(i.bl - i.av - i.L / 2, i.av - i.L / 2); // across: to the ledge's edge and to the stem's face
  const along = Math.min(b.S / 2 - i.W / 2, b.exterior ? b.c - i.W / 2 : Infinity);
  const k = Math.max(1, Math.min((i.L + 2 * Math.max(0, toEdge)) / i.L, (i.W + 2 * Math.max(0, along)) / i.W, (Math.min(i.L, i.W) + 4 * i.hf) / Math.min(i.L, i.W)));
  const m = Math.min(2, k);
  const Pr = PHI_B * 0.85 * i.fc * A1 * m;
  out.push({ id: `br-${b.label}`, name: `Ledge at ${b.label}: bearing (m = ${m.toFixed(2)})`, demand: b.Vu, capacity: Pr, unit: "kip", ok: b.Vu <= Pr, ref: "AASHTO 5.8.4.3.6, Eqs. 5.6.5-1 to -3" });
  return out;
}
