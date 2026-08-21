import type { Evidence, Hypothesis } from "@paysherlock/types";
import { createEvidenceFactory } from "../evidence/build.js";
import { computeConfidenceScore, computeRankingScore } from "../evidence/scorer.js";
import type { Findings } from "../evidence/findings.js";
import { HYPOTHESIS_CHECKS } from "./rules.js";

export interface VerificationResult {
  hypotheses: Hypothesis[];
  evidence: Evidence[];
}

/**
 * Runs each PENDING hypothesis through its deterministic rule check
 * (hypotheses/rules.ts) and sets status/evidenceIds/confidence/score from
 * the result. This is the single place a hypothesis's status is decided —
 * never the LLM. See docs/decisions.
 */
export function verifyHypotheses(pending: Hypothesis[], findings: Findings): VerificationResult {
  const makeEvidence = createEvidenceFactory();
  const allEvidence: Evidence[] = [];

  const verified = pending.map((hypothesis): Hypothesis => {
    const check = HYPOTHESIS_CHECKS[hypothesis.id];
    if (!check) {
      // Not one of our known, checkable hypotheses — shouldn't happen since
      // the planner only ever proposes catalog ids, but fail safe rather
      // than crash the investigation.
      return { ...hypothesis, status: "INCONCLUSIVE" };
    }

    const result = check(findings, makeEvidence);
    allEvidence.push(...result.evidence);
    const evidenceIds = result.evidence.map((item) => item.id);

    if (result.status === "SUPPORTED") {
      const confidence = computeConfidenceScore(result.evidence);
      return {
        ...hypothesis,
        status: result.status,
        evidenceIds,
        confidence,
        score: computeRankingScore(confidence, evidenceIds.length),
      };
    }

    return { ...hypothesis, status: result.status, evidenceIds };
  });

  return { hypotheses: verified, evidence: allEvidence };
}
