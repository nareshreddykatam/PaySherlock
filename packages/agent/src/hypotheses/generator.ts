import type { CandidateHypothesis, Hypothesis } from "@paysherlock/types";

/**
 * Materializes the planner's candidate hypotheses as PENDING — nothing is
 * declared supported yet (Phase 2 brief: "do not allow the agent to
 * immediately declare the first hypothesis correct"). Only
 * `hypotheses/verifier.ts`, working from real evidence, ever changes that.
 */
export function generateHypotheses(candidates: CandidateHypothesis[]): Hypothesis[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    statement: candidate.statement,
    status: "PENDING",
    evidenceIds: [],
  }));
}
