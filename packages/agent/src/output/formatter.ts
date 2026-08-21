// Currency formatting lives here ONLY — everywhere else in the agent
// (evidence, hypotheses, tool results) works in integer minor units. This
// is the presentation boundary (Phase 2 brief, section 17).

export function formatMinorUnitsAsINR(minorUnits: number): string {
  const rupees = Math.abs(minorUnits) / 100;
  const sign = minorUnits < 0 ? "-" : "";
  if (rupees >= 100_000) return `${sign}₹${(rupees / 100_000).toFixed(2)}L`;
  if (rupees >= 1_000) return `${sign}₹${(rupees / 1_000).toFixed(1)}K`;
  return `${sign}₹${rupees.toFixed(0)}`;
}
