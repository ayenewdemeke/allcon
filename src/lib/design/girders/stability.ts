// Lateral stability of a precast girder hanging from lifting devices or riding on a haul truck
// (AASHTO LRFD 5.5.4.3), by PCI's "Recommended Practice for Lateral Stability of Precast,
// Prestressed Concrete Bridge Girders" (CB-02-16-E), after Mast. The equations follow WSDOT's
// open-source implementation (WBFL Stability, used by PGSuper and PGStable) step for step, so the
// results can be checked against both.
//
// Units: kip, in, ksi, radians. Stresses are + in tension here (as PCI and WBFL), unlike the rest of
// the girder design. The girder is prismatic and symmetric about its vertical axis; it tilts to the
// left (the roll direction PCI's equations assume).

export const THETA_MAX = 0.4; // rad, the largest angle the small-angle equations are used to

export type StabilitySection = {
  A: number; // in²
  Ix: number; // in⁴, strong axis
  Iy: number; // in⁴, weak axis
  yt: number; // in, centroid below the top
  yb: number; // in, centroid above the bottom
  H: number; // in
  wTop: number; // in, top flange width
  wBot: number; // in, bottom flange width
};

/** A section along the girder: X in from the left end, the prestress force there and its eccentricity (+ below the centroid). */
export type StabilityPoint = { X: number; Fpe: number; e: number; label?: string };

type Common = {
  section: StabilitySection;
  L: number; // in, girder length
  w: number; // kip/in, self-weight
  Ec: number; // ksi
  fr: number; // ksi, modulus of rupture (tension +)
  left: number; // in, end to the left support (lift point or bunk)
  right: number; // in
  sweep: number; // in/in of length (e.g. 1/8 in per 10 ft = 0.00104)
  sweepGrowth?: number; // in
  placement: number; // in, support (lift loop or bunk) placement tolerance
  camber: number; // in, at midspan
  camberMultiplier?: number;
  impactUp: number; // fraction
  impactDown: number;
  windPressure?: number; // ksi on the girder's side
  points: StabilityPoint[];
};

export type LiftingProblem = Common & {
  liftAngle?: number; // rad from horizontal (π/2: vertical cables)
  yRollAxis?: number; // in, the lift points above the top of the girder (+ above)
};

export type HaulingProblem = Common & {
  Ktheta: number; // kip·in/rad, the truck's roll stiffness
  crown: number; // rad (slope), normal crown
  superelevation: number; // rad (slope), at maximum superelevation
  Hrc: number; // in, roll center above the roadway
  Hbg: number; // in, bottom of the girder above the roadway
  Wcc: number; // in, center-to-center of the dual tires
  velocity?: number; // in/s
  radius?: number; // in, turning radius
  cfAdverse?: boolean; // centrifugal force toward the tilt (default: favorable, as WSDOT)
  impactUsage?: "crown" | "superelevation" | "both"; // which case gets impact (WSDOT: the normal crown)
};

type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
const CORNERS: Corner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
const G = 386.089; // in/s²

function corners(s: StabilitySection): Record<Corner, { X: number; Y: number }> {
  return {
    topLeft: { X: -s.wTop / 2, Y: s.yt },
    topRight: { X: s.wTop / 2, Y: s.yt },
    bottomLeft: { X: -s.wBot / 2, Y: -s.yb },
    bottomRight: { X: s.wBot / 2, Y: -s.yb },
  };
}

/** Moment (kip·in, sagging +) at X from a uniform w on a beam of length L on supports a from the left and b from the right end. */
export function overhangMoment(w: number, L: number, a: number, b: number, X: number) {
  const s = L - a - b;
  const R1 = (w * L * (L / 2 - b)) / s;
  const R2 = w * L - R1;
  let M = (-w * X * X) / 2;
  if (X > a) M += R1 * (X - a);
  if (X > L - b) M += R2 * (X - (L - b));
  return M;
}

/** What both analyses share: the eccentricities, the lateral deflection of the weight applied sideways, and the roll axis. */
function prepare(p: Common, yRollAxis: number) {
  const s = p.section;
  const Lg = p.L;
  const a = Math.min(p.left, p.right);
  const b = Math.max(p.left, p.right);
  const La = Lg - 2 * a;
  const Ls = Lg - p.left - p.right;
  // The sweep's offset of the center of gravity from the supports' line (PCI: (ℓ/L)² − 1/3 for equal overhangs).
  let F = (La / Lg) ** 2 * (1 - (2 * (b - a)) / La) - 1 / 3;
  if (Math.abs(F) < 1e-12) F = 0;
  const lateralSweep = p.sweep * Lg + (p.sweepGrowth ?? 0);
  const ei = F * lateralSweep + p.placement;
  const Wg = p.w * Lg;
  const Wwind = (p.windPressure ?? 0) * s.H * Lg;
  const m = p.camberMultiplier ?? 1;
  // The wind's resultant at mid-depth, from the roll axis, raised by the camber.
  const yw = -s.H / 2 - yRollAxis;
  const Ywind = Math.abs(yw) + Math.sign(yw || 1) * F * m * p.camber;
  // The center of gravity from the roll axis, adjusted for the camber (Dra: + when the roll axis is above it).
  const Yr = yRollAxis + s.yt;
  const Dra = Math.abs(Yr) - Math.sign(Yr || 1) * F * m * p.camber;
  // Lateral deflection of the center of gravity with the whole weight applied sideways (weak axis).
  const l = Ls;
  const EI = p.Ec * s.Iy;
  const zo = (Wg / (24 * EI * Lg * Lg)) * (l ** 5 / 5 - (a * a + b * b) * l ** 3 + 2 * (a ** 4 + a * a * b * b + b ** 4) * l + (6 * (a ** 5 + b ** 5)) / 5);
  const IM = [1, 1 - p.impactUp, 1 + p.impactDown];
  return { a, b, Ls, F, lateralSweep, ei, Wg, Wwind, Ywind, Yr, Dra, zo, IM, m };
}

const IMPACTS = ["none", "up", "down"] as const;
export type ImpactName = (typeof IMPACTS)[number];
const WINDS = ["left", "right"] as const;

// --- lifting ---------------------------------------------------------------------------------------

export function analyzeLifting(p: LiftingProblem) {
  const s = p.section;
  const yRoll = p.yRollAxis ?? 0;
  const base = prepare(p, yRoll);
  const { Wg, Wwind, Ywind, Dra, zo, IM, F, Ls } = base;
  const angle = p.liftAngle ?? Math.PI / 2;
  const Pcrit = (Math.PI ** 2 * p.Ec * s.Iy) / (Ls * Ls);
  let Plift = -(Wg / 2) * Math.tan(Math.PI / 2 - angle);
  if (Math.abs(Plift) < 1e-9) Plift = 0;
  const pts = corners(s);

  const cases = IMPACTS.map((imp, i) => {
    const im = IM[i];
    const emag = Plift < 0 ? 1 / (1 - Math.abs((im * Plift) / Pcrit)) : 1;
    const ei = base.ei * emag;
    const Zo = im * zo * emag;
    const ZoWind = ((zo * Wwind) / Wg) * emag;
    const EccWind = (Wwind * Ywind) / (im * Wg);
    const winds = WINDS.map((wind) => {
      const ws = wind === "left" ? 1 : -1;
      const stable = !(Dra < 0 || F < 0 || Dra < Zo + (ei + ws * (ZoWind - EccWind)) / THETA_MAX);
      const thetaEq = stable ? (ei + ws * (ZoWind - EccWind)) / (Dra - Zo) : NaN;
      return { wind, ws, stable, thetaEq };
    });
    return { impact: imp, im, emag, ei, Zo, ZoWind, EccWind, winds };
  });

  const sections = p.points.map((pt) => {
    const Mg = overhangMoment(p.w, p.L, p.left, p.right, pt.X);
    const Mw = Wwind > 0 ? overhangMoment(Wwind / p.L, p.L, p.left, p.right, pt.X) : 0;
    // Eccentricity of the inclined cables' horizontal force at this section.
    let FX = ((p.L - 2 * base.a) / p.L) ** 2 - ((p.L - 2 * pt.X) / p.L) ** 2;
    if (Math.abs(FX) < 1e-12) FX = 0;
    const between = pt.X >= p.left && pt.X <= p.L - p.right;
    const P = between ? Plift : 0;
    const out = CORNERS.map((c) => {
      const { X, Y } = pts[c];
      const fps = (pt.Fpe * pt.e * Y) / s.Ix - pt.Fpe / s.A;
      const fg = (-Mg * Y) / s.Ix;
      const fw = (-Mw * X) / s.Iy;
      const fcable = (P * Dra * Y) / s.Ix + P / s.A;
      const byCase = cases.map((k) => {
        const fDirect = fps + k.im * (fg + fcable);
        const byWind = k.winds.map((w) => {
          if (!w.stable) return { f: NaN, fscr: 0, thetaCrack: NaN };
          const eh = P === 0 ? 0 : p.placement * k.emag * (1 - FX) + (k.ei + w.ws * k.ZoWind) * FX;
          const Mh = -P * eh;
          const My = -k.im * ((Mg - P * k.Zo) * w.thetaEq + Mh);
          const fTilt = (My * X) / s.Iy;
          const f = fDirect + w.ws * fw + fTilt;
          // Cracking: the extra lateral moment to reach the modulus of rupture, and the tilt that gives it.
          let mcr = 0;
          const fd = fDirect + w.ws * fw;
          if (fd < p.fr) {
            const basic = ((fd - p.fr) * s.Iy) / X;
            mcr = basic - Mh;
            if (basic >= 0 && mcr < 0) mcr = 0;
          }
          const mm = k.im * Mg - P * k.Zo;
          let thetaCrack = Math.abs(mm) < 1e-12 ? Math.sign(w.thetaEq) * THETA_MAX : mcr / mm;
          thetaCrack = Math.max(-THETA_MAX, Math.min(THETA_MAX, thetaCrack));
          let fscr: number;
          if (w.thetaEq < 0) {
            if (thetaCrack < 0) {
              const Mr = k.ei + k.ZoWind + (k.Zo - Dra) * thetaCrack;
              fscr = Math.abs(k.EccWind) < 1e-12 ? Infinity : Mr / k.EccWind;
            } else fscr = Infinity;
          } else if (thetaCrack < 0) fscr = Infinity;
          else {
            const Mr = Dra * thetaCrack;
            const Ma = k.Zo * thetaCrack + k.ei + w.ws * (k.ZoWind - k.EccWind);
            fscr = Math.abs(Ma) < 1e-12 ? Infinity : Mr / Ma;
          }
          return { f, fscr, thetaCrack };
        });
        return { fDirect, byWind };
      });
      return { corner: c, fps, fg, fw, fcable, byCase };
    });
    return { X: pt.X, label: pt.label, Mg, Mw, corners: out };
  });

  // Factor of safety against failure, each impact and wind.
  const failure = cases.map((k) =>
    k.winds.map((w) => {
      if (!w.stable) return { thetaMax: NaN, FSf: 0, adjFSf: 0 };
      let thetaMax: number;
      if (w.thetaEq < 0) thetaMax = (k.Zo - Dra - w.ws * 2.5 * k.ZoWind) / (5 * k.Zo);
      else thetaMax = Math.sqrt(Math.max(0, (k.ei + w.ws * (k.ZoWind - k.EccWind)) / (2.5 * k.Zo)));
      thetaMax = Math.max(-THETA_MAX, Math.min(THETA_MAX, thetaMax));
      let FSf: number;
      if (w.thetaEq < 0) {
        const Mr = k.ei - Dra * thetaMax + (k.ZoWind + k.Zo * thetaMax) * (1 - 2.5 * thetaMax);
        FSf = Math.abs(k.EccWind) < 1e-12 ? Infinity : Mr / k.EccWind;
      } else {
        const Mr = Dra * thetaMax;
        const Ma = (1 + 2.5 * thetaMax) * (k.Zo * thetaMax + w.ws * k.ZoWind) - w.ws * k.EccWind + k.ei;
        FSf = Math.abs(Ma) < 1e-12 ? Infinity : Mr / Ma;
      }
      return { thetaMax, FSf, adjFSf: FSf };
    }),
  );
  // FSf is not less than FScr: a girder that doesn't crack doesn't fail.
  cases.forEach((k, i) =>
    k.winds.forEach((w, j) => {
      if (!w.stable) return;
      const minScr = Math.min(...sections.flatMap((sec) => sec.corners.map((c) => c.byCase[i].byWind[j].fscr)));
      failure[i][j].adjFSf = Math.max(failure[i][j].FSf, minScr);
    }),
  );
  return { kind: "lifting" as const, ...base, Plift, Pcrit, cases, sections, failure, summary: summarize(sections.map((sec) => ({ X: sec.X, corners: sec.corners.map((c) => ({ corner: c.corner, cases: c.byCase })) })), failure, cases.every((k) => k.winds.every((w) => w.stable))) };
}

// --- hauling ---------------------------------------------------------------------------------------

export function analyzeHauling(p: HaulingProblem) {
  const s = p.section;
  // The roll axis: the truck's roll center, below the girder's bottom.
  const yRoll = -(p.Hbg - p.Hrc) - s.H;
  const base = prepare(p, yRoll);
  const { Wg, Wwind, Ywind, Dra, zo, IM } = base;
  const V = p.velocity ?? 0;
  const R = p.radius ?? 1e9;
  const Wcf = (Wg * V * V) / (G * R);
  const cfSign = p.cfAdverse ? 1 : -1;
  const ZoWind0 = (zo * Wwind) / Wg;
  const ZoCF = (zo * Wcf) / Wg;
  const MotWind = Wwind * Ywind;
  const MotCF = Wcf * Dra;
  const usage = p.impactUsage ?? "crown";
  const pts = corners(s);
  const ei = base.ei;

  const slopes = (["crown", "superelevation"] as const).map((slope) => {
    const alpha = slope === "crown" ? p.crown : p.superelevation;
    const cases = IMPACTS.map((imp, i) => {
      const im = usage === "both" || usage === slope ? IM[i] : 1;
      const winds = WINDS.map((wind) => {
        const ws = wind === "left" ? 1 : -1;
        let Zt = ws * ZoWind0;
        let Mot = ws * MotWind;
        if (slope === "superelevation") {
          Zt += cfSign * ZoCF;
          Mot += cfSign * MotCF;
        }
        const thetaEq = (p.Ktheta * alpha + im * Wg * (ei + Zt) + Mot) / (p.Ktheta - im * Wg * (Dra + im * zo));
        const stable = Math.abs(thetaEq) <= THETA_MAX;
        // Stresses and cracking use the impact on the wind's deflection too (as WBFL).
        let ZtS = ws * im * ZoWind0;
        if (slope === "superelevation") ZtS += cfSign * ZoCF;
        return { wind, ws, thetaEq, stable, Zt, ZtS, Mot };
      });
      return { impact: imp, im, winds };
    });

    const sections = p.points.map((pt) => {
      const Mg = overhangMoment(p.w, p.L, p.left, p.right, pt.X);
      const Mw = Wwind > 0 ? overhangMoment(Wwind / p.L, p.L, p.left, p.right, pt.X) : 0;
      const Mcf = (Mg * Wcf) / Wg;
      const out = CORNERS.map((c) => {
        const { X, Y } = pts[c];
        const fps = (pt.Fpe * pt.e * Y) / s.Ix - pt.Fpe / s.A;
        const fg = (-Mg * Y) / s.Ix;
        const fw = (-Mw * X) / s.Iy;
        const fcf = (Mcf * X) / s.Iy;
        const byCase = cases.map((k) => {
          const fDirect = fps + k.im * fg;
          const byWind = k.winds.map((w) => {
            if (!w.stable) return { f: NaN, fscr: 0, thetaCrack: NaN };
            const My = -k.im * Mg * w.thetaEq;
            const fTilt = (My * X) / s.Iy;
            let f = fDirect + fTilt + w.ws * fw;
            if (slope === "superelevation") f -= cfSign * fcf;
            let fd = fDirect + w.ws * fw;
            if (slope === "superelevation") fd -= cfSign * fcf;
            let fscr = 0;
            let thetaCrack = 0;
            if (fd < p.fr) {
              const mcr = ((fd - p.fr) * s.Iy) / X;
              const mm = k.im * Mg;
              thetaCrack = Math.abs(mm) < 1e-12 ? Math.sign(w.thetaEq) * THETA_MAX : mcr / mm;
              thetaCrack = Math.max(-THETA_MAX, Math.min(THETA_MAX, thetaCrack));
              if (thetaCrack < 0) fscr = Infinity;
              else {
                const Mr = p.Ktheta * (thetaCrack - alpha);
                const Ma = k.im * Wg * ((Dra + k.im * zo) * thetaCrack + ei + w.ZtS) + w.Mot;
                fscr = Math.abs(Ma) < 1e-12 ? Infinity : Math.max(0, Mr / Ma);
              }
            }
            return { f, fscr, thetaCrack };
          });
          return { fDirect, byWind };
        });
        return { corner: c, fps, fg, fw, fcf, byCase };
      });
      return { X: pt.X, label: pt.label, Mg, Mw, Mcf, corners: out };
    });

    // Failure and rollover, each impact and wind.
    const failure = cases.map((k) =>
      k.winds.map((w) => {
        if (!w.stable) return { thetaMax: NaN, FSf: 0, adjFSf: 0, thetaRoll: NaN, FSr: 0 };
        let thetaMax = 0;
        let FSf = Infinity;
        const sign = w.thetaEq < 0 ? -1 : 1;
        if (!(w.thetaEq > 0 && w.thetaEq <= alpha)) {
          const Zt = w.ws * k.im * ZoWind0 + (slope === "superelevation" ? cfSign * ZoCF : 0);
          const Z = Zt + ei + w.Mot / (k.im * Wg) + (k.im * zo + Dra + sign * 2.5 * Zt) * alpha;
          const S = alpha * alpha + (sign * Z) / (2.5 * k.im * zo);
          thetaMax = alpha + sign * Math.sqrt(Math.max(0, S));
          thetaMax = Math.max(-THETA_MAX, Math.min(THETA_MAX, thetaMax));
          const Mr = p.Ktheta * (thetaMax - alpha);
          const Ma = k.im * Wg * ((k.im * zo * thetaMax + Zt) * (1 + 2.5 * Math.abs(thetaMax)) + Dra * thetaMax + ei) + w.Mot;
          FSf = Ma <= 0 ? Infinity : Mr / Ma;
        }
        // Rollover: the angle at which the truck's tires on one side lift.
        const Zt = w.ws * k.im * ZoWind0 + (slope === "superelevation" ? cfSign * ZoCF : 0);
        const Zmax = p.Wcc / 2;
        const Wro = w.ws * Wwind + (slope === "superelevation" ? cfSign * Wcf : 0);
        const Mro = Wro * (p.Hrc + sign * Zmax * alpha);
        const mr = k.im * Wg * (Zmax - sign * p.Hrc * alpha);
        const ma = sign * Mro;
        let thetaRoll = NaN;
        let FSr = 0;
        if (mr >= ma) {
          thetaRoll = (sign * (mr - ma)) / p.Ktheta + alpha;
          const Mr = p.Ktheta * (thetaRoll - alpha);
          const Ma = k.im * Wg * ((Zt + k.im * zo * thetaRoll) * (1 + 2.5 * Math.abs(thetaRoll)) + Dra * thetaRoll + ei) + w.Mot;
          FSr = Math.abs(Ma) < 1e-12 ? Infinity : Mr / Ma;
        }
        return { thetaMax, FSf, adjFSf: FSf, thetaRoll, FSr };
      }),
    );
    cases.forEach((k, i) =>
      k.winds.forEach((w, j) => {
        if (!w.stable) return;
        const minScr = Math.min(...sections.flatMap((sec) => sec.corners.map((c) => c.byCase[i].byWind[j].fscr)));
        failure[i][j].adjFSf = Math.max(failure[i][j].FSf, minScr);
      }),
    );
    const stable = cases.every((k) => k.winds.every((w) => w.stable));
    const summary = summarize(sections.map((sec) => ({ X: sec.X, corners: sec.corners.map((c) => ({ corner: c.corner, cases: c.byCase })) })), failure, stable);
    const FSr = stable ? Math.min(...failure.flat().map((f) => f.FSr)) : 0;
    return { slope, alpha, cases, sections, failure, summary: { ...summary, FSr } };
  });
  return { kind: "hauling" as const, ...base, Wcf, ZoWind0, ZoCF, MotWind, MotCF, crown: slopes[0], superelevation: slopes[1] };
}

type CaseStress = { fDirect: number; byWind: { f: number; fscr: number }[] };

/** The extremes over every section, corner, impact and wind. */
function summarize(sections: { X: number; corners: { corner: Corner; cases: CaseStress[] }[] }[], failure: { FSf: number; adjFSf: number }[][], stable: boolean) {
  let maxDirect = -Infinity;
  let minDirect = Infinity;
  let maxStress = -Infinity;
  let minStress = Infinity;
  let FScr = Infinity;
  let at = { maxDirect: 0, minDirect: 0, maxStress: 0, minStress: 0, FScr: 0 };
  for (const sec of sections)
    for (const c of sec.corners)
      for (const k of c.cases) {
        if (k.fDirect > maxDirect) {
          maxDirect = k.fDirect;
          at = { ...at, maxDirect: sec.X };
        }
        if (k.fDirect < minDirect) {
          minDirect = k.fDirect;
          at = { ...at, minDirect: sec.X };
        }
        for (const w of k.byWind) {
          if (!Number.isFinite(w.f)) continue;
          if (w.f > maxStress) {
            maxStress = w.f;
            at = { ...at, maxStress: sec.X };
          }
          if (w.f < minStress) {
            minStress = w.f;
            at = { ...at, minStress: sec.X };
          }
          if (w.fscr < FScr) {
            FScr = w.fscr;
            at = { ...at, FScr: sec.X };
          }
        }
      }
  const FSf = stable ? Math.min(...failure.flat().map((f) => f.FSf)) : 0;
  const adjFSf = stable ? Math.min(...failure.flat().map((f) => f.adjFSf)) : 0;
  return { stable, maxDirect, minDirect, maxStress, minStress, FScr: stable ? FScr : 0, FSf, adjFSf, at };
}

export type LiftingResult = ReturnType<typeof analyzeLifting>;
export type HaulingResult = ReturnType<typeof analyzeHauling>;
