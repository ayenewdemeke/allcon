import { describe, expect, it } from "vitest";
import { compareBeamForces, parseBeamForces } from "./compare";
import { mctList, parseMct } from "./mct";
import { analyze } from "./solver";

// A midas MCT model read, converted and analyzed: a two-span continuous beam in kN and m, laid out
// as midas writes the file, against the closed-form answers.

const MCT = `
*VERSION
   9.4.5
*UNIT    ; Unit System
; FORCE, LENGTH, HEAT, TEMPER
   KN   , M, KJ, C
*NODE    ; Nodes
; iNO, X, Y, Z
     1, 0, 0, 0
     2, 10, 0, 0
     3, 20, 0, 0
     4, 30, 0, 0
     5, 40, 0, 0
*ELEMENT    ; Elements
; iEL, TYPE, iMAT, iPRO, iN1, iN2, ANGLE, iSUB, EXVAL
     1, BEAM  ,    1,     1,     1,     2,     0,     0
     2, BEAM  ,    1,     1,     2,     3,     0,     0
     3, BEAM  ,    1,     1,     3,     4,     0,     0
     4, BEAM  ,    1,     2,     4,     5,     0,     0
     9, PLATE ,    1,     1,     1,     2,     3,     4, 1, 0
*MATERIAL    ; Material
; iMAT, TYPE, MNAME, SPHEAT, HEATCO, PLAST, TUNIT, bMASS, DAMPRATIO, [DATA1]
    1, USER , Conc30            , 0, 0, , C, NO, 0.05, 2, 3.0000e+07,   0.2, 1.0000e-05,    25,     0
*SECTION    ; Section
; iSEC, TYPE, SNAME, [OFFSET], bSD, bWE, SHAPE, [DATA1], [DATA2]
    1, DBUSER    , Rect 1.0x0.5     , CC, 0, 0, 0, 0, 0, 0, YES, NO, SB , 2, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0
    2, VALUE     , Same by value    , CC, 0, 0, 0, 0, 0, 0, YES, NO, SB , BUILT, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0
       0.5, 0.41667, 0.41667, 0.028610, 0.041667, 0.010417
       0.25, 0.25, 0.5, 0.5, 0.0625, 0.03125, 3, 0
*CONSTRAINT    ; Supports
; NODE_LIST, CONST(Dx,Dy,Dz,Rx,Ry,Rz), GROUP
   1, 111100,
   3 5, 011100,
*STLDCASE    ; Static Load Cases
; LCNAME, LCTYPE, DESC
   DL   , D ,
   UDL  , USER , 10 kN/m
*USE-STLD, DL
*SELFWEIGHT, 0, 0, -1,
*USE-STLD, UDL
*BEAMLOAD    ; Element Beam Loads
; ELEM_LIST, CMD, TYPE, DIR, bPROJ, [ECCEN], [VALUE], GROUP
    1to4, BEAM   , UNILOAD, GZ, NO , NO, aDir[1], , , , 0, -10, 1, -10, 0, 0, 0, 0, , NO, 0, 0, NO,
*CONLOAD    ; Nodal Loads
; NODE_LIST, FX, FY, FZ, MX, MY, MZ, GROUP
   2, 0, 0, 0, 0, 0, 0,
*LOADCOMB    ; Combinations
   NAME=c1, GEN, ACTIVE, 0, 0, , 0, 0
*ENDDATA
`;

const KN = 0.2248089431;
const M = 3.280839895;

describe("midas MCT import", () => {
  it("reads lists as midas writes them", () => {
    expect(mctList("1 2 5to8 20to30by5")).toEqual([1, 2, 5, 6, 7, 8, 20, 25, 30]);
  });

  const { model, report } = parseMct(MCT);
  it("takes in the model in kip and ft, and says what it didn't read", () => {
    expect(report.units).toEqual({ force: "KN", length: "M" });
    expect(report.read).toMatchObject({ nodes: 5, "beam elements": 4, materials: 1, sections: 2, supports: 3, "load cases": 2, "beam loads": 4, "self-weight": 1 });
    expect(report.notRead).toEqual(["LOADCOMB"]);
    expect(report.warnings.join(" ")).toMatch(/PLATE aren't read/);
    expect(model.nodes[4].x).toBeCloseTo(40 * M, 6);
    expect(model.materials[0].E).toBeCloseTo((3e7 * KN) / (M * M), 3);
    // The rectangle from its dimensions, and the same section by value.
    expect(model.sections[0].Iy).toBeCloseTo(((0.5 * 1 ** 3) / 12) * M ** 4, 6);
    expect(model.sections[1].Iy).toBeCloseTo(0.041667 * M ** 4, 4);
    expect(model.sections[0].A).toBeCloseTo(model.sections[1].A, 6);
  });

  it("analyzes to the closed-form results: wL²/8 over the pier, 1.25wL at it, self-weight by density", () => {
    const a = analyze(model);
    const udl = model.loadCases.findIndex((c) => c.name === "UDL");
    const w = 10; // kN/m
    const Lm = 20;
    // Within half a percent: the sections' shear areas add a little shear deformation.
    expect(Math.abs(a.forcesAt(udl, 1, 1).My / (KN * M) + (w * Lm * Lm) / 8)).toBeLessThan(2.5);
    expect(Math.abs(a.cases[udl].reactions[1].R[2] / KN - 1.25 * w * Lm)).toBeLessThan(1.25);
    const dl = model.loadCases.findIndex((c) => c.name === "DL");
    expect(a.cases[dl].equilibrium.applied[2] / KN).toBeCloseTo(-25 * 0.5 * 40, 1);
  });

  it("compares with a pasted beam force table, by magnitude, in the table's units", () => {
    const a = analyze(model);
    // As midas's Beam Force table copies: Elem, Load, Part, Axial, Shear-y, Shear-z, Torsion, Moment-y, Moment-z.
    const table = ["Elem\tLoad\tPart\tAxial\tShear-y\tShear-z\tTorsion\tMoment-y\tMoment-z", "1\tUDL\tI[1]\t0\t0\t-75\t0\t0\t0", "2\tUDL\tJ[3]\t0\t0\t125\t0\t-500\t0", "2\tUDL\tJ[3]\t0\t0\t125\t0\t-520\t0", "7\tUDL\tI[9]\t0\t0\t1\t0\t1\t0"].join("\n");
    expect(parseBeamForces(table)).toHaveLength(4);
    const c = compareBeamForces(model, a, table, { force: "KN", length: "M" });
    expect(c.rows).toHaveLength(3);
    expect(c.unmatched).toBe(1);
    expect(Math.abs(c.rows[0].ours[2]) / KN).toBeCloseTo(75, 1);
    expect(Math.abs(c.rows[0].diff[2])).toBeLessThan(0.05);
    expect(Math.abs(c.rows[1].diff[4])).toBeLessThan(1);
    // The third row is 4% off in moment: it shows as the worst difference.
    expect(c.worst[4].percent).toBeGreaterThan(3);
    expect(c.worst[4].percent).toBeLessThan(5.5);
    expect(c.within).toBeGreaterThan(0.85);
  });
});
