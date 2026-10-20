// What the contract's list of priced work is called. It's a schedule of values (SOV) in the
// US and a bill of quantities (BoQ) in most other places; conkit names both so everyone
// recognizes it.

export const BOQ = {
  /** The section and the document */
  title: "SOV / BoQ",
  /** One of its rows */
  item: "item",
  items: "items",
  anItem: "an item",
} as const;

/** "item" → "Item" */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
