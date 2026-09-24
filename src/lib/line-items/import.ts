import { normalizeUnit } from "./units";

// Turning a spreadsheet (rows of cells) into line items. Pure functions, shared by the
// import screen (preview) and the server (the actual import).

export type Field = "code" | "description" | "unit" | "quantity" | "rate" | "amount";
export type ColumnMap = Partial<Record<Field, number>>; // field -> column index

export const FIELDS: { field: Field; label: string; required?: boolean }[] = [
  { field: "code", label: "Code" },
  { field: "description", label: "Description", required: true },
  { field: "unit", label: "Unit" },
  { field: "quantity", label: "Quantity" },
  { field: "rate", label: "Unit rate" },
  { field: "amount", label: "Amount / scheduled value" },
];

const HEADER_HINTS: Record<Field, RegExp> = {
  code: /^(item\s*)?(code|no\.?|number|#|ref(erence)?|cost\s*code|csi|section|item)$/i,
  description: /(desc|description|item\s*description|work|scope|name|particulars)/i,
  unit: /^(unit|units|uom|u\/m|um)$/i,
  quantity: /^(qty|quantity|quant|contract\s*qty|contract\s*quantity|est\.?\s*qty)$/i,
  rate: /(rate|unit\s*(price|cost)|price\s*per|\$\s*\/\s*unit)/i,
  amount: /(amount|total|value|scheduled\s*value|extension|sum|cost)$/i,
};

const clean = (v: unknown) => (v == null ? "" : String(v).trim());

/** The first row in the top 20 that looks like a header: several cells matching known titles. */
export function detectHeaderRow(rows: unknown[][]) {
  let best = { index: 0, score: 0 };
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map(clean);
    const score = (Object.keys(HEADER_HINTS) as Field[]).filter((f) => cells.some((c) => HEADER_HINTS[f].test(c))).length;
    if (score > best.score) best = { index: i, score };
  }
  return best.score >= 2 ? best.index : 0;
}

/** Guesses which column holds which field from the header titles. */
export function guessColumns(header: unknown[]): ColumnMap {
  const cells = header.map(clean);
  const map: ColumnMap = {};
  const taken = new Set<number>();
  // Most specific fields first, so "Unit rate" becomes the rate, not the unit.
  for (const field of ["rate", "quantity", "unit", "code", "amount", "description"] as Field[]) {
    const index = cells.findIndex((c, i) => !taken.has(i) && c && HEADER_HINTS[field].test(c));
    if (index >= 0) {
      map[field] = index;
      taken.add(index);
    }
  }
  return map;
}

/** Reads a number the way bills write them: $1,234.50, (1,234) for negatives, 12%. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = clean(v);
  if (!s || s === "-" || s === "—") return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()$£€,\s]/g, "").replace(/%$/, "");
  const n = Number(s);
  if (!Number.isFinite(n) || s === "") return null;
  return negative ? -n : n;
}

export type ParsedItem = {
  row: number; // 1-based spreadsheet row, for messages
  code: string | null;
  description: string;
  unit: string | null;
  billingType: "unit_price" | "lump_sum";
  contractQuantity: number | null;
  rate: number | null;
  scheduledValue: number | null;
  isHeading: boolean;
  warning: string | null;
};

/**
 * Builds line items from the rows below the header.
 *  - A row with a description but no unit, quantity, rate or amount is a section heading.
 *  - LS / lump-sum units, or an amount with no quantity, make a lump-sum line.
 *  - A missing rate is derived from amount / quantity when both are present.
 */
export function buildItems(rows: unknown[][], headerRow: number, map: ColumnMap): ParsedItem[] {
  const items: ParsedItem[] = [];
  const cell = (r: unknown[], f: Field) => (map[f] === undefined ? undefined : r[map[f]!]);

  rows.slice(headerRow + 1).forEach((r, i) => {
    const description = clean(cell(r, "description"));
    const code = clean(cell(r, "code")) || null;
    if (!description && !code) return; // blank row

    const { unit } = normalizeUnit(clean(cell(r, "unit")));
    const quantity = parseNumber(cell(r, "quantity"));
    let rate = parseNumber(cell(r, "rate"));
    const amount = parseNumber(cell(r, "amount"));
    const row = headerRow + i + 2;

    if (!unit && quantity === null && rate === null && amount === null) {
      items.push({ row, code, description: description || code!, unit: null, billingType: "unit_price", contractQuantity: null, rate: null, scheduledValue: null, isHeading: true, warning: null });
      return;
    }

    // Subtotal lines repeat values already counted in the lines above.
    if (/^(sub\s*-?\s*total|total)\b/i.test(description) && !quantity) return;

    const lumpSum = unit === "LS" || (quantity === null && rate === null && amount !== null);
    if (!lumpSum && rate === null && amount !== null && quantity) rate = amount / quantity;

    let warning: string | null = null;
    if (!description) warning = "No description";
    else if (!lumpSum && (quantity === null || rate === null)) warning = "Missing quantity or rate";
    else if (!lumpSum && amount !== null && quantity !== null && rate !== null && Math.abs(quantity * rate - amount) > Math.max(1, Math.abs(amount) * 0.01)) {
      warning = "Quantity × rate doesn't match the amount";
    }

    items.push({
      row,
      code,
      description: description || code!,
      unit: lumpSum ? unit ?? "LS" : unit,
      billingType: lumpSum ? "lump_sum" : "unit_price",
      contractQuantity: lumpSum ? quantity : quantity,
      rate: lumpSum ? null : rate,
      scheduledValue: lumpSum ? (amount ?? (quantity && rate ? quantity * rate : null)) : null,
      isHeading: false,
      warning,
    });
  });
  return items;
}

/** Value of a line: quantity x rate, or the scheduled value for lump sums. */
export function lineValue(item: { billingType: string; contractQuantity: number | null; rate: number | null; scheduledValue: number | null }) {
  if (item.billingType === "lump_sum") return item.scheduledValue ?? 0;
  return (item.contractQuantity ?? 0) * (item.rate ?? 0);
}
