import { describe, expect, it } from "vitest";
import { contentSize } from "../types";
import { layout, type Line } from "./templates";

// Page breaks in a laid-out worksheet: a heading never ends a page, and lines marked keepWithNext go
// to the next page with the table or figure they introduce.

const page = contentSize("letter").height;
const filler = (n: number): Line[] => Array.from({ length: n }, (_, k) => ({ math: `a_{${k}}\\coloneq${k}` }));
const yOf = (regions: ReturnType<typeof layout>, text: string) => regions.find((r) => r.kind === "text" && r.text === text)!.y;
const pageOf = (y: number) => Math.floor(y / page);

describe("page breaks", () => {
  it("keeps a heading and its note on the page of the figure they introduce", () => {
    const figure: Line = { region: { kind: "image", width: 600, height: 500, svg: "<svg/>" } as never };
    const lines: Line[] = [...filler(14), { text: "Comparison", style: "subheading", keepWithNext: true }, { text: "What the table shows.", keepWithNext: true }, figure];
    const out = layout(lines, { x: 0, y: 0 });
    const img = out.find((r) => r.kind === "image")!;
    expect(pageOf(yOf(out, "Comparison"))).toBe(pageOf(img.y));
    expect(pageOf(yOf(out, "What the table shows."))).toBe(pageOf(img.y));
    expect(pageOf(img.y)).toBe(1);
  });
  it("never leaves a heading alone at the foot of a page", () => {
    // Enough lines to bring a heading to the last line of the first page.
    for (let n = 18; n <= 26; n++) {
      const out = layout([...filler(n), { text: "Section", style: "subheading" }, { math: "b\\coloneq1" }], { x: 0, y: 0 });
      const b = out.find((r) => r.kind === "math" && r.latex === "b\\coloneq1")!;
      expect(pageOf(yOf(out, "Section"))).toBe(pageOf(b.y));
    }
  });
  it("leaves the flow alone when everything fits", () => {
    const out = layout([{ text: "A", style: "subheading" }, { text: "note", keepWithNext: true }, { math: "c\\coloneq1" }], { x: 0, y: 0 });
    expect(out.map((r) => r.y)).toEqual([0, 48, 88]);
  });
});
