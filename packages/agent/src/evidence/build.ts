import type { Evidence } from "@paysherlock/types";

/** Deterministic, per-investigation-run evidence id sequence — never a
 * shared/global counter, so concurrent investigations can't collide or
 * race on ids. */
export function createEvidenceFactory() {
  let counter = 0;
  return function makeEvidence(partial: Omit<Evidence, "id">): Evidence {
    counter += 1;
    return { id: `ev_${counter}`, ...partial };
  };
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatPercentagePoints(value: number, digits = 1): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}pp`;
}
