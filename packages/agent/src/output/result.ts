import type { BusinessImpact, Evidence, Hypothesis, InvestigationResult } from "@paysherlock/types";
import type { CalculateRevenueImpactOutput } from "@paysherlock/tools";
import { confidenceBand } from "../evidence/scorer.js";
import type { Narration } from "../provider/types.js";

/**
 * Root-cause ranking (Phase 2 brief, section 16): among SUPPORTED
 * hypotheses, the highest `score` (confidence + evidence-count tiebreaker,
 * computed in hypotheses/verifier.ts) wins. No hypothesis reaching
 * SUPPORTED means no significant anomaly was found.
 */
export function selectRootCause(hypotheses: Hypothesis[]): Hypothesis | undefined {
  const supported = hypotheses.filter((h) => h.status === "SUPPORTED");
  if (supported.length === 0) return undefined;
  return [...supported].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
}

export interface AssembleResultParams {
  question: string;
  hypotheses: Hypothesis[];
  evidence: Evidence[];
  revenueImpact?: CalculateRevenueImpactOutput | undefined;
  narration: Narration;
  investigationId: string;
  stepsExecuted: number;
  toolCallCount: number;
  providerName: string;
}

/** Assembles the final, auditable InvestigationResult. Every field traces
 * back to something computed deterministically above — `narration` is the
 * only LLM-authored part, and it's text only (summary/recommendations),
 * never a number. */
export function assembleInvestigationResult(params: AssembleResultParams): InvestigationResult {
  const rootCauseHypothesis = selectRootCause(params.hypotheses);
  const rejectedHypotheses = params.hypotheses
    .filter((h) => h.status === "REJECTED")
    .map((h) => h.statement);

  let businessImpact: BusinessImpact | undefined;
  if (rootCauseHypothesis && params.revenueImpact) {
    businessImpact = {
      estimatedImpactMinorUnits: params.revenueImpact.estimatedImpactMinorUnits,
      currency: params.revenueImpact.currency,
      basis: params.revenueImpact.basis,
    };
  }

  return {
    question: params.question,
    summary: params.narration.summary,
    rootCause: rootCauseHypothesis?.statement,
    confidence:
      rootCauseHypothesis?.confidence !== undefined
        ? confidenceBand(rootCauseHypothesis.confidence)
        : undefined,
    businessImpact,
    evidence: rootCauseHypothesis
      ? params.evidence.filter((item) =>
          item.supportsHypothesisIds.includes(rootCauseHypothesis.id),
        )
      : [],
    rejectedHypotheses,
    recommendations: params.narration.recommendations,
    meta: {
      investigationId: params.investigationId,
      stepsExecuted: params.stepsExecuted,
      toolCalls: params.toolCallCount,
      provider: params.providerName,
    },
  };
}
