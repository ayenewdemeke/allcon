import { describe, expect, it } from "vitest";
import { boxOfLines, groupLines } from "./lines";
import { rankSections } from "./retrieve";
import { parseHeading, splitManual } from "./sections";
import { issueNoteText } from "./types";

describe("parseHeading", () => {
  it.each([
    ["5.4.3 Clear Cover", "5.4.3", "Clear Cover"],
    ["SECTION 5 CONCRETE STRUCTURES", "5", "CONCRETE STRUCTURES"],
    ["2. Preliminary Design", "2", "Preliminary Design"],
    ["A. GENERAL POLICY", "A", "GENERAL POLICY"],
    ["BDM_Section 1_2024", null, "Section 1"], // bookmark named after a file
    ["Bridge_Design_Manual_Cover", null, "Bridge Design Manual Cover"],
    ["Appendix A List of Examples", null, "Appendix A List of Examples"],
  ])("%s", (raw, number, title) => {
    const h = parseHeading(raw);
    expect(h.number).toBe(number);
    expect(h.title).toBe(title);
  });
});

describe("splitManual", () => {
  const footer = "CDOT Bridge Design Manual February 2026";
  const pages = [
    { page: 1, lines: ["TABLE OF CONTENTS", "5.4.3 Clear Cover 5-4", footer] },
    { page: 2, lines: ["5.4 REINFORCED CONCRETE", "General text.", "Table 5-4: laps with 2.0 in. Clear Cover", footer] },
    { page: 3, lines: ["5.4.3 Clear Cover", "Cover shall be 2.5 in.", footer] },
    { page: 4, lines: ["5.4.4 Spacing", "Spacing shall be 6 in. min.", footer] },
    { page: 5, lines: ["More spacing text.", footer] },
  ];

  it("splits on headings when there are no bookmarks, dropping running footers and contents lines", () => {
    const s = splitManual(pages, []);
    expect(s.map((x) => x.number)).toEqual(["5.4", "5.4.3", "5.4.4"]);
    expect(s[1].text).toBe("5.4.3 Clear Cover\nCover shall be 2.5 in.");
    expect(s[2].text).toContain("More spacing text.");
    expect(s.some((x) => x.text.includes(footer))).toBe(false);
  });

  it("uses bookmarks, starting each section at its heading rather than a caption that mentions it", () => {
    const outline = [
      { title: "BDM_Table of Contents_2026", page: 1 },
      { title: "5.4 REINFORCED CONCRETE", page: 2 },
      { title: "5.4.3 Clear Cover", page: 2 }, // bookmark points at the page before the heading
      { title: "5.4.4 Spacing", page: 4 },
      ...Array.from({ length: 6 }, (_, i) => ({ title: `9.${i} Filler`, page: 99 })),
    ];
    const s = splitManual(pages, outline);
    expect(s.map((x) => x.title)).toEqual(["REINFORCED CONCRETE", "Clear Cover", "Spacing"]); // contents dropped
    expect(s[1].text.startsWith("Table 5-4")).toBe(false);
  });
});

describe("rankSections", () => {
  const sections = [
    { id: "a", number: "5.4.3", title: "Clear Cover", text: "Concrete cover to reinforcing bars shall be 2.5 in." },
    { id: "b", number: "2.2.2", title: "Vertical Clearances", text: "Minimum vertical clearance over roadways shall be 16.50 ft." },
    { id: "c", number: "3.6", title: "Vehicular Live Load", text: "HL-93 loading shall be used." },
  ];

  it("ranks by relevance to the sheet text and stays within budget", () => {
    const ranked = rankSections("VERTICAL CLEARANCE 16'-6\" MIN over roadway", sections, 10_000);
    expect(ranked[0].id).toBe("b");
    expect(ranked.find((s) => s.id === "c")).toBeUndefined();
    expect(rankSections("cover clearance", sections, 70)).toHaveLength(1);
  });
});

describe("groupLines", () => {
  it("joins pieces on a row, splits columns, and orders top to bottom", () => {
    const lines = groupLines([
      { text: "GENERAL", box: [10, 10, 60, 20] },
      { text: "NOTES", box: [63, 10, 100, 20] },
      { text: "INDEX", box: [400, 11, 440, 21] }, // far right: another column
      { text: "Concrete Class D", box: [10, 30, 110, 40] },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["GENERAL NOTES", "INDEX", "Concrete Class D"]);
    expect(lines[0].box).toEqual([10, 10, 100, 20]);
    expect(boxOfLines(lines, [1, 3], 0)).toEqual([10, 10, 110, 40]);
    expect(boxOfLines(lines, [99])).toBeNull();
  });
});

describe("issueNoteText", () => {
  it("wraps to the note width and keeps the citation within the line limit", () => {
    const text = issueNoteText({
      title: "Clear cover below manual minimum",
      detail: "Deck top bars show 2 in. clear cover; the manual requires 2.5 in. for the top of bridge decks. ".repeat(3),
      citation: "CDOT Bridge Design Manual §5.4.3 Clear Cover",
    });
    const lines = text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(lines.every((l) => l.length <= 42)).toBe(true);
    expect(lines[0]).toBe("Clear cover below manual minimum");
    expect(lines.slice(-2).join(" ")).toContain("§5.4.3 Clear Cover"); // the citation may wrap
    expect(text).toContain("…");
  });
});
