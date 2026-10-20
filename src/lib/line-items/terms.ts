// What the contract's list of priced work is called, by the project's measurement standard:
// a bill of quantities (BoQ) under NRM2, SMM7 and most of the world, a schedule of values
// (SOV) in the US (CSI). The data is the same; only the words change.

export type BoqTerms = {
  /** "Bill of quantities" / "Schedule of values" */
  title: string;
  /** "BoQ" / "SOV" */
  short: string;
  /** "item" / "line" */
  item: string;
  /** "items" / "lines" */
  items: string;
  /** "an item" / "a line" */
  anItem: string;
};

const BOQ: BoqTerms = { title: "Bill of quantities", short: "BoQ", item: "item", items: "items", anItem: "an item" };
const SOV: BoqTerms = { title: "Schedule of values", short: "SOV", item: "line", items: "lines", anItem: "a line" };

export const boqTerms = (standard: string | null | undefined): BoqTerms => (standard === "CSI" ? SOV : BOQ);

/** "item" → "Item" */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
