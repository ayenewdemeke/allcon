import { roundSection } from "../piers/collision";
import { BARS, DesignError, type Check } from "../walls/cip";

// A cantilever sign structure's drilled shaft foundation: the dead and wind loads on the pole, arm
// and sign panel (AASHTO LRFD Specifications for Structural Supports for Highway Signs, Luminaires,
// and Traffic Signals, LTS, 3.5 and 3.8), the load groups at the top of the shaft (LTS Table 3.4-1),
// and the shaft's resistance (AASHTO LRFD): axial (10.8.3.5), axial load with bending by strain
// compatibility (5.6), shear (5.7.3.3, simplified) and whether torsion may be neglected (5.7.2.1),
// for the lateral soil response from a p–y analysis. Kip, foot and inch; pressures in psf.

export type SignInputs = {
  // Pole and arm (tapered round steel tubes)
  poleLength: number; // ft, top of the shaft to the pole's top
  poleBase: number; // in, outside diameter
  poleTop: number; // in
  poleWall: number; // in
  armDrop: number; // ft, pole's top down to the arm
  armLength: number; // ft
  armBase: number; // in
  armEnd: number; // in
  armWall: number; // in
  // Sign panel (aluminum)
  signLength: number; // ft
  signHeight: number; // ft
  signOffset: number; // ft, pole centerline to the panel's center
  signThickness: number; // in
  miscPct: number; // supports and anchors, % of the panel's weight
  // Wind (LTS 3.8)
  V: number; // mph, basic wind speed for the MRI
  Kd: number; // directionality (3.8.5)
  G: number; // gust effect (3.8.6)
  Cv: number; // velocity conversion (3.8.3)
  CdSign: number; // sign panel drag coefficient (Table 3.8.7-1)
  // Shaft
  shaftD: number; // in
  shaftLength: number; // ft
  cover: number; // in, clear to the ties
  bars: number;
  bar: number;
  tieBar: number;
  tieSpacing: number; // in
  fc: number; // ksi
  fy: number; // ksi
  phiM: number; // 5.5.4.2
  // Geotechnical
  qp: number; // ksf, unit tip resistance
  qs: number; // ksf, unit side resistance
  phiQp: number;
  phiQs: number;
  sideLength: number; // ft of shaft counted for side resistance
  // Lateral response (from a p–y analysis of the shaft under these loads)
  pyMoment: number; // kip·ft, the largest in the shaft
  pyShear: number; // kip
  pyDeflection: number; // in, at the top
};

/** The defaults: a 22 ft pole with a 16 ft arm and an 8 × 6 ft panel, on a 3 ft shaft 13 ft deep. */
export const SIGN_DEFAULTS: SignInputs = {
  poleLength: 22,
  poleBase: 15.5,
  poleTop: 12.5,
  poleWall: 0.1875,
  armDrop: 1.5,
  armLength: 16,
  armBase: 10,
  armEnd: 6.25,
  armWall: 0.1875,
  signLength: 8,
  signHeight: 6,
  signOffset: 11,
  signThickness: 7 / 32,
  miscPct: 50,
  V: 120,
  Kd: 0.85,
  G: 1.14,
  Cv: 1,
  CdSign: 1.19,
  shaftD: 36,
  shaftLength: 13,
  cover: 3,
  bars: 13,
  bar: 8,
  tieBar: 5,
  tieSpacing: 12,
  fc: 4,
  fy: 60,
  phiM: 0.75,
  qp: 18,
  qs: 1,
  phiQp: 0.4,
  phiQs: 0.45,
  sideLength: 5.5,
  pyMoment: 47.264,
  pyShear: 7.261,
  pyDeflection: 0.0043,
};

const STEEL = 0.49; // kcf
const ALUMINUM = 0.175; // kcf

/** Height and exposure factor, LTS Eq. 3.8.4-1 (exposure C, z at least 16 ft). */
export const Kz = (z: number) => 2.0 * (Math.max(z, 16) / 900) ** (2 / 9.5);

/** Drag coefficient of a round member, LTS Table 3.8.7-1, by Cv V d (mph·ft). */
export const roundCd = (CvVd: number) => (CvVd < 39 ? 1.1 : CvVd <= 78 ? 129 / CvVd ** 1.3 : 0.45);

/** A tapered tube's weight (kip) and centroid from its base (ft), and its projected area's centroid. */
function tube(length: number, base: number, end: number, wall: number) {
  const area = (d: number) => Math.PI * (d - wall) * wall; // in²
  const weight = (((area(base) + area(end)) / 2) * length * STEEL) / 144;
  const centroid = (length / 3) * ((area(base) + 2 * area(end)) / (area(base) + area(end)));
  const projected = ((base + end) / 2 / 12) * length; // ft²
  const projCentroid = (length / 3) * ((base + 2 * end) / (base + end));
  return { weight, centroid, projected, projCentroid };
}

export function designSign(i: SignInputs) {
  if (i.poleLength <= i.armDrop || i.shaftD <= 0) throw new DesignError("The arm must be on the pole, and the shaft needs a diameter.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });

  // --- dead loads (LTS 3.5) --------------------------------------------------------------------------
  const pole = tube(i.poleLength, i.poleBase, i.poleTop, i.poleWall);
  const arm = tube(i.armLength, i.armBase, i.armEnd, i.armWall);
  const signArea = i.signLength * i.signHeight;
  const sign = (signArea * (i.signThickness / 12) * ALUMINUM);
  const misc = (i.miscPct / 100) * sign;
  const DC = pole.weight + arm.weight + sign + misc;
  const MDC = arm.weight * arm.centroid + (sign + misc) * i.signOffset; // about the pole, kip·ft

  // --- wind (LTS 3.8): P = 0.00256 Kz Kd G V² Cd ------------------------------------------------------
  const zArm = i.poleLength - i.armDrop;
  const kz = Kz(zArm); // at the arm and sign, taken for all members
  const dAvg = (i.poleBase + i.poleTop) / 2 / 12;
  const CvVd = i.Cv * i.V * dAvg;
  const CdMember = roundCd(CvVd);
  const qMember = 0.00256 * kz * i.Kd * i.G * i.V ** 2 * CdMember; // psf (LTS Eq. 3.8.1-1)
  const qSign = 0.00256 * kz * i.Kd * i.G * i.V ** 2 * i.CdSign;
  const Wpole = (qMember * pole.projected) / 1000; // kip
  const Warm = (qMember * arm.projected) / 1000;
  const Wsign = (qSign * signArea) / 1000;
  // Wind normal to the sign: overturning about the shaft's top, and torsion from the arm's reach.
  const Mx = (Wsign + Warm) * zArm + Wpole * pole.projCentroid;
  const T = Wsign * i.signOffset + Warm * arm.projCentroid;
  const H = Wsign + Warm + Wpole;

  // --- load groups at the top of the shaft (LTS Table 3.4-1) -------------------------------------------------
  const groups = [
    { name: "Strength I", gDC: 1.25, gW: 0 },
    { name: "Extreme I (max)", gDC: 1.1, gW: 1 },
    { name: "Extreme I (min)", gDC: 0.9, gW: 1 },
    { name: "Service I", gDC: 1.0, gW: 1 },
  ].map((g) => ({ ...g, P: g.gDC * DC, M: Math.hypot(g.gW * Mx, g.gDC * MDC), T: g.gW * T, V: g.gW * H }));
  const extreme = groups[1];

  // --- the shaft --------------------------------------------------------------------------------------------
  const bar = BARS[i.bar];
  const tie = BARS[i.tieBar];
  const Dr = i.shaftD - 2 * i.cover - 2 * tie.dia - bar.dia;
  const shaftWeight = ((Math.PI * (i.shaftD / 12) ** 2) / 4) * i.shaftLength * 0.15;
  // Axial (AASHTO 10.8.3.5): tip and side resistance.
  const tipArea = (Math.PI * (i.shaftD / 12) ** 2) / 4;
  const Rp = i.phiQp * i.qp * tipArea;
  const Rs = i.phiQs * i.qs * Math.PI * (i.shaftD / 12) * i.sideLength;
  const Pu = Math.max(...groups.map((g) => g.P)) + shaftWeight;
  add({ id: "axial", name: "Axial resistance (tip and side)", demand: Pu, capacity: Rp + Rs, unit: "kip", ref: "AASHTO 10.8.3.5" });
  // Axial load with bending (5.6), at the smallest axial load with the largest moment.
  const section = roundSection(i.shaftD, Dr, i.bars, bar.area, i.fc, i.fy);
  const Mu = Math.max(...groups.map((g) => g.M), i.pyMoment);
  const atMin = section.momentAt(Math.min(...groups.filter((g) => g.gW).map((g) => g.P)));
  const Mn = atMin.M / 12;
  add({ id: "flexure", name: "Axial load and bending", demand: Mu, capacity: i.phiM * Mn, unit: "kip·ft", ref: "AASHTO 5.6.4" });
  // Shear (5.7.3.3, simplified β = 2, θ = 45°) with C5.7.2.8's depths for a circular section.
  const de = i.shaftD / 2 + Dr / Math.PI;
  const Af = (i.bars * bar.area) / 2; // half the bars in tension
  const dv = Math.max((Mn * 12) / (Af * i.fy), 0.9 * de, 0.72 * i.shaftD);
  const Vu = Math.max(...groups.map((g) => g.V), i.pyShear);
  const Av = 2 * tie.area;
  const Vc = 0.0316 * 2 * Math.sqrt(i.fc) * i.shaftD * dv;
  const Vs = (Av * i.fy * dv) / i.tieSpacing;
  const Vn = Math.min(Vc + Vs, 0.25 * i.fc * i.shaftD * dv);
  add({ id: "shear", name: "Shear", demand: Vu, capacity: 0.9 * Vn, unit: "kip", ref: "AASHTO 5.7.3.3" });
  const AvMin = (0.0316 * Math.sqrt(i.fc) * i.shaftD * i.tieSpacing) / i.fy;
  add({ id: "ties-min", name: "Minimum transverse reinforcement", demand: AvMin, capacity: Av, unit: "in²", ref: "AASHTO 5.7.2.5" });
  const vu = Vu / (0.9 * i.shaftD * dv);
  const sMax = vu < 0.125 * i.fc ? Math.min(0.8 * dv, 24) : Math.min(0.4 * dv, 12);
  add({ id: "ties-spacing", name: "Tie spacing", demand: i.tieSpacing, capacity: sMax, unit: "in", ref: "AASHTO 5.7.2.6" });
  // Torsion may be neglected below a quarter of the cracking torque (5.7.2.1).
  const Acp = (Math.PI * i.shaftD ** 2) / 4;
  const pc = Math.PI * i.shaftD;
  const Tcr = (0.126 * Math.sqrt(i.fc) * Acp ** 2) / pc; // kip·in, AASHTO Eq. 5.7.2.1-4 (no prestress)
  const Tu = Math.max(...groups.map((g) => g.T));
  add({ id: "torsion", name: "Torsion may be neglected: Tu ≤ 0.25 φ Tcr", demand: Tu * 12, capacity: 0.25 * 0.9 * Tcr, unit: "kip·in", ref: "AASHTO 5.7.2.1" });

  return {
    ok: checks.every((c) => c.ok),
    checks,
    dead: { pole: pole.weight, arm: arm.weight, armCentroid: arm.centroid, sign, misc, DC, MDC },
    wind: { kz, CvVd, CdMember, qMember, qSign, poleArea: pole.projected, armArea: arm.projected, signArea, Wpole, Warm, Wsign, zArm, poleCentroid: pole.projCentroid, armCentroid: arm.projCentroid, Mx, T, H },
    groups,
    extreme,
    shaft: { Dr, shaftWeight, Rp, Rs, Pu, Mu, Mn, de, Af, dv, Vu, Av, Vc, Vs, Vn, AvMin, vu, sMax, Acp, pc, Tcr, Tu, beta1: section.beta1 },
  };
}

export type SignResult = ReturnType<typeof designSign>;
