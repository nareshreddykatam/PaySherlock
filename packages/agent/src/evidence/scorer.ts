import type { Evidence } from "@paysherlock/types";

/**
 * Deterministic confidence score for a SUPPORTED hypothesis, derived
 * entirely from its evidence's `significance` tags — never an
 * LLM-supplied number (Phase 2 brief: "do not let the LLM arbitrarily set
 * confidence=91%"). Base 0.5 for meeting the SUPPORTED bar at all, plus a
 * bonus per corroborating evidence item, capped well short of 1.0 since
 * this is correlational analysis, not proof.
 */
export function computeConfidenceScore(evidence: Evidence[]): number {
  let score = 0.5;
  for (const item of evidence) {
    if (item.significance === "high") score += 0.15;
    else if (item.significance === "medium") score += 0.08;
    else score += 0.02;
  }
  return Math.min(score, 0.95);
}

export function confidenceBand(score: number): "low" | "medium" | "high" {
  if (score >= 0.75) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

/**
 * Ranking score used to pick the root cause among multiple SUPPORTED
 * hypotheses: confidence first, evidence count as a tiebreaker. Magnitude
 * and revenue impact are already reflected in confidence (via evidence
 * significance), so this stays a simple, auditable combination rather than
 * a second independent weighting scheme.
 */
export function computeRankingScore(confidence: number, evidenceCount: number): number {
  return confidence + evidenceCount * 0.01;
}
