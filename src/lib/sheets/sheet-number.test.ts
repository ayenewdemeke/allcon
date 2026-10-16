import { describe, expect, it } from "vitest";
import { guessSheetNumber, type PlacedText } from "./sheet-number";

const W = 1224, H = 792;
const t = (text: string, x: number, y: number, size = 5): PlacedText => ({ text, x, y, size });

describe("guessSheetNumber", () => {
  it("takes the sheet, not the count, from 'B1 of B56' (Jewell title block)", () => {
    const items = [
      t("Sheet Number", 1086, 749),
      t("74", 1162, 749, 10),
      t("Subset Sheets:", 978, 752),
      t("B56", 1061, 752), // listed before B1 in the content stream
      t("B1", 1034, 752),
      t("of", 1047, 753),
    ];
    expect(guessSheetNumber(items, W, H)).toBe("B1");
  });

  it("reads inserted sheets like B28a", () => {
    const items = [t("Subset Sheets:", 978, 752), t("B56", 1061, 752), t("B28a", 1027, 753), t("of", 1047, 753)];
    expect(guessSheetNumber(items, W, H)).toBe("B28a");
  });

  it("prefers the number next to a 'Sheet No.' label over other codes", () => {
    const items = [t("C2", 900, 700, 12), t("SHEET NO.", 1100, 740, 6), t("A-101", 1150, 740, 9)];
    expect(guessSheetNumber(items, W, H)).toBe("A-101");
  });

  it("falls back to the largest sheet-number-like text in the corner", () => {
    const items = [t("S2.01", 1150, 760, 14), t("M3", 1000, 700, 6), t("A101", 100, 100, 30)];
    expect(guessSheetNumber(items, W, H)).toBe("S2.01");
  });

  it("returns null when there's nothing like a sheet number", () => {
    expect(guessSheetNumber([t("GENERAL NOTES", 1000, 700)], W, H)).toBeNull();
  });
});
