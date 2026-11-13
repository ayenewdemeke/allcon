// CDOT's rating vehicles for Load Factor Rating: wheel-line loads (kip, half of each axle) and axle
// spacings (ft), from CDOT's LFR rating workbook truck sheets. A vehicle's weight in tons is the sum
// of its wheel-line loads (2 × wheel line kip ÷ 2 kip per ton). Checked against the posted weights:
// Type 3 = 27 T, Type 3S2 = 42.5 T, the permit truck = 96 T.

export type VehicleClass = "design" | "legal" | "su" | "ev" | "permit";
export type Vehicle = { name: string; cls: VehicleClass; P: number[]; S: number[] };

export const CDOT_VEHICLES: Vehicle[] = [
  { name: "HS-20", cls: "design", P: [4, 16, 16], S: [14, 14] },
  { name: "CO Type 3", cls: "legal", P: [7, 10, 10], S: [13.5, 4] },
  { name: "CO Type 3S2", cls: "legal", P: [6, 10, 10, 8.25, 8.25], S: [12, 4, 25, 4] },
  { name: "CO Type 3-2", cls: "legal", P: [6, 10, 10, 8.25, 8.25], S: [14, 4, 16, 16] },
  { name: "SU4", cls: "su", P: [6, 4, 8.5, 8.5], S: [10, 4, 4] },
  { name: "SU5", cls: "su", P: [6, 4, 4, 8.5, 8.5], S: [10, 4, 4, 4] },
  { name: "CO SU6", cls: "su", P: [5.75, 4, 4, 8.5, 8.5, 4], S: [10, 4, 4, 4, 4] },
  { name: "CO SU7", cls: "su", P: [5.75, 4, 4, 8.5, 8.5, 4, 4], S: [10, 4, 4, 4, 4, 4] },
  { name: "NRL", cls: "su", P: [3, 4, 4, 8.5, 8.5, 4, 4, 4], S: [6, 4, 4, 4, 4, 4, 4] },
  { name: "EV2", cls: "ev", P: [12, 16.75], S: [15] },
  { name: "EV3", cls: "ev", P: [12, 15.5, 15.5], S: [15, 4] },
  { name: "CO Permit", cls: "permit", P: [13.5, 12.5, 12.5, 12.5, 12.5, 10.84, 10.84, 10.84], S: [14, 4, 12, 4, 35, 4, 4] },
  { name: "CO Mod Tandem", cls: "permit", P: [12.5, 12.5, 12.5, 12.5], S: [4, 12, 4] },
];

/** A vehicle's weight in tons. */
export const tons = (v: Vehicle) => v.P.reduce((a, b) => a + b, 0);

/** HS-20 lane loading per wheel line (SSHB 3.7.1.2): 0.32 klf, with 9 kip (moment) or 13 kip (shear). */
export const HS20_LANE = { w: 0.32, Pm: 9, Pv: 13 };

/**
 * The largest moment and shear a train of wheel loads gives at x on a simple span L (per wheel line,
 * no impact), moved in both directions in fine steps with each axle also placed exactly on x.
 */
export function trainAt(v: Pick<Vehicle, "P" | "S">, L: number, x: number, step = 0.05) {
  let M = 0;
  let V = 0;
  for (const dir of [1, -1]) {
    const loads = dir === 1 ? v.P : [...v.P].reverse();
    const sp = dir === 1 ? v.S : [...v.S].reverse();
    const off = [0];
    for (const s of sp) off.push(off[off.length - 1] + s);
    const len = off[off.length - 1];
    const starts: number[] = [];
    for (let x0 = -len; x0 <= L + 1e-9; x0 += step) starts.push(x0);
    for (const o of off) starts.push(x - o, x - o + 1e-6); // an axle on the section, and just past it
    for (const x0 of starts) {
      let m = 0;
      let vv = 0;
      off.forEach((o, i) => {
        const a = x0 + o;
        if (a < 0 || a > L) return;
        m += a <= x ? (loads[i] * a * (L - x)) / L : (loads[i] * x * (L - a)) / L;
        vv += a <= x ? -(loads[i] * a) / L : (loads[i] * (L - a)) / L;
      });
      if (m > M) M = m;
      if (Math.abs(vv) > V) V = Math.abs(vv);
    }
  }
  return { M, V };
}

/** The absolute largest moment a train gives on a simple span, and where (as the hand method: 0.01 ft steps). */
export function trainMax(v: Pick<Vehicle, "P" | "S">, L: number) {
  let best = { M: 0, at: 0 };
  for (const dir of [1, -1]) {
    const loads = dir === 1 ? v.P : [...v.P].reverse();
    const sp = dir === 1 ? v.S : [...v.S].reverse();
    const off = [0];
    for (const s of sp) off.push(off[off.length - 1] + s);
    const len = off[off.length - 1];
    for (let k = 0, x0 = -len; x0 <= L + 1e-9; k++, x0 = -len + k * 0.01) {
      const xs = off.map((o) => x0 + o);
      let sumP = 0;
      let sumPx = 0;
      xs.forEach((x, i) => {
        if (x >= 0 && x <= L) {
          sumP += loads[i];
          sumPx += loads[i] * x;
        }
      });
      if (!sumP) continue;
      const RL = sumP - sumPx / L;
      for (const a of xs) {
        if (a < 0 || a > L) continue;
        let M = RL * a;
        xs.forEach((x, i) => {
          if (x >= 0 && x < a) M -= loads[i] * (a - x);
        });
        if (M > best.M) best = { M, at: a };
      }
    }
  }
  return best;
}

/** HS-20 lane loading at x per wheel line: moment and shear. */
export function laneAt(L: number, x: number) {
  return { M: (HS20_LANE.w * x * (L - x)) / 2 + (HS20_LANE.Pm * x * (L - x)) / L, V: (HS20_LANE.w * (L - x) ** 2) / (2 * L) + (HS20_LANE.Pv * (L - x)) / L };
}
