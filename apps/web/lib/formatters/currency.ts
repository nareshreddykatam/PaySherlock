// Every amount from the API is an integer minor unit (paise) — see
// packages/types money.ts / docs/decisions. Formatting only ever happens
// here, at the presentation boundary; nothing in this app recomputes a
// business number, it only displays what the API returned.

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Full Indian-grouped rupee string, e.g. 17240000 -> "₹1,72,400". */
export function formatINR(minorUnits: number): string {
  return inrFormatter.format(minorUnits / 100);
}

/** Compact lakh/crore-style string for headline metrics, e.g. "₹1.72L". */
export function formatCompactINR(minorUnits: number): string {
  const sign = minorUnits < 0 ? "-" : "";
  const rupees = Math.abs(minorUnits) / 100;
  if (rupees >= 1_00_00_000) return `${sign}₹${(rupees / 1_00_00_000).toFixed(2)}Cr`;
  if (rupees >= 1_00_000) return `${sign}₹${(rupees / 1_00_000).toFixed(2)}L`;
  if (rupees >= 1_000) return `${sign}₹${(rupees / 1_000).toFixed(1)}K`;
  return `${sign}₹${rupees.toFixed(0)}`;
}

/** A fraction (0-1) as a percentage string, e.g. 0.942 -> "94.2%". */
export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** A fraction representing a relative change, e.g. 0.084 -> "+8.4%". */
export function formatSignedPercent(fraction: number, digits = 1): string {
  const sign = fraction >= 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(digits)}%`;
}

/** A fraction representing a percentage-POINT change (not percent-of-percent). */
export function formatPercentagePoints(value: number, digits = 1): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}pp`;
}
