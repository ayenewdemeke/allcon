/** Money in the project's currency, e.g. $1,234,567.00. */
export function formatMoney(value: number, currency = "USD", options: { compact?: boolean } = {}) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.compact ? 1 : 2,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}
