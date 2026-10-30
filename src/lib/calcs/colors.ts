// Colors in a worksheet: what text and math can be set in (Mathcad's font color), and the
// colors check results show in on their own: OK green, NG red.

export const CALC_COLORS: { name: string; value: string | undefined }[] = [
  { name: "Black", value: undefined },
  { name: "Blue", value: "#1d4ed8" },
  { name: "Green", value: "#15803d" },
  { name: "Red", value: "#dc2626" },
  { name: "Orange", value: "#c2410c" },
  { name: "Purple", value: "#7e22ce" },
  { name: "Gray", value: "#6b7280" },
];

export const OK_COLOR = "#15803d";
export const NG_COLOR = "#dc2626";

/** A result's color when it's a check's verdict (the string OK, NG, Not OK, Pass or Fail). */
export function verdictColor(result: string | undefined): string | undefined {
  const text = result?.match(/^\\text\{(.*)\}$/)?.[1].trim().toLowerCase();
  if (text === "ok" || text === "pass") return OK_COLOR;
  if (text === "ng" || text === "not ok" || text === "fail") return NG_COLOR;
  return undefined;
}
