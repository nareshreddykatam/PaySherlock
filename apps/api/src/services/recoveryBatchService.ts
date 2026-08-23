import {
  createRecommendation,
  findRecommendedPaymentIds,
  getIssueById,
  listCapturedPaymentsInWindow,
  recordAuditEvent,
  type Database,
  type PaymentMethod,
} from "@paysherlock/database";
import {
  determineRiskLevel,
  generateRefundRecommendationCandidate,
  selectRecoveryCandidates,
  validateRecommendationCandidate,
  type RecoveryBatchLimits,
  type RejectedRecoveryCandidate,
} from "@paysherlock/actions";
import { DEFAULT_WINDOW_DURATION_MS } from "@paysherlock/detection";
import type { InvestigationResult } from "@paysherlock/types";
import { toRecommendationResponse } from "./recommendationService.js";

// Track 03 (AI Revenue Recovery) — turns one already-investigated
// PAYMENT_METHOD_DEGRADATION issue into a bounded batch of individually
// approvable REFUND_PAYMENT recommendations. Deliberately NOT a new
// financial action type or a new approval endpoint: every recommendation
// this produces is persisted and approved through the exact same
// createRecommendation / POST /recommendations/:id/approve pipeline Phase 5
// already built and Phase 6 already hardened. "Batch" here means "many
// individually-gated recommendations grouped by issueId", never "one
// approval that triggers many refunds."

/** Hardcoded, server-side-only — never client-configurable (the client
 * cannot request a larger batch or a higher amount ceiling; these exist
 * specifically so a compromised or buggy caller can't turn a demo batch
 * into a large blast radius). Chosen to comfortably bound a Buildathon demo
 * batch: at most 10 candidates, at most ₹5,000 total. */
export const RECOVERY_BATCH_LIMITS: RecoveryBatchLimits = {
  maxCandidates: 10,
  maxTotalAmountMinorUnits: 500_000,
};

export type GenerateRecoveryBatchOutcome =
  | { kind: "issue_not_found" }
  | { kind: "not_eligible"; reason: string }
  | { kind: "ok"; batch: RecoveryBatchSummary };

export interface RecoveryBatchSummary {
  issueId: string;
  rootCause: string;
  windowStart: string;
  windowEnd: string;
  limits: RecoveryBatchLimits;
  candidatesScanned: number;
  eligibleCount: number;
  rejectedCount: number;
  amountEligibleMinorUnits: number;
  stoppedReason: "max_candidates_reached" | "max_amount_reached" | null;
  rejectedCandidates: RejectedRecoveryCandidate[];
  recommendations: ReturnType<typeof toRecommendationResponse>[];
}

export interface GenerateRecoveryBatchParams {
  merchantId: string;
  issueId: string;
}

/**
 * The only entry point that creates a recovery batch. Requires the issue to
 * already be IDENTIFIED (investigated, root cause found) and of type
 * PAYMENT_METHOD_DEGRADATION with a method (`dimension`) recorded — the
 * same anomaly the existing single-payment "Investigate this payment" demo
 * already uses, just applied to every eligible payment in the same
 * detection window instead of one. Calling this twice for the same issue
 * is safe: findRecommendedPaymentIds excludes payments already
 * recommended, so a second call only ever adds newly-eligible payments,
 * never duplicates.
 */
export async function generateRecoveryBatch(
  deps: { db: Database },
  params: GenerateRecoveryBatchParams,
): Promise<GenerateRecoveryBatchOutcome> {
  const issue = await getIssueById(deps.db, { id: params.issueId, merchantId: params.merchantId });
  if (!issue) return { kind: "issue_not_found" };

  if (issue.type !== "PAYMENT_METHOD_DEGRADATION") {
    return {
      kind: "not_eligible",
      reason: "Recovery batches are only generated for PAYMENT_METHOD_DEGRADATION issues",
    };
  }
  if (issue.status !== "IDENTIFIED" || !issue.rootCause) {
    return {
      kind: "not_eligible",
      reason: "Issue has not been investigated to a root cause yet",
    };
  }
  if (!issue.dimension) {
    return { kind: "not_eligible", reason: "Issue has no affected payment method recorded" };
  }
  const investigation = issue.investigationResult as InvestigationResult | null;
  if (!investigation) {
    return { kind: "not_eligible", reason: "Issue has no cached investigation result" };
  }

  const windowEnd = issue.detectedAt;
  const windowStart = new Date(windowEnd.getTime() - DEFAULT_WINDOW_DURATION_MS);

  const candidatePayments = await listCapturedPaymentsInWindow(deps.db, {
    merchantId: params.merchantId,
    method: issue.dimension as PaymentMethod,
    start: windowStart,
    end: windowEnd,
  });

  const alreadyRecommended = await findRecommendedPaymentIds(deps.db, {
    merchantId: params.merchantId,
    paymentIds: candidatePayments.map((payment) => payment.id),
  });

  const selection = selectRecoveryCandidates(
    candidatePayments,
    RECOVERY_BATCH_LIMITS,
    alreadyRecommended,
  );

  const recommendations: ReturnType<typeof toRecommendationResponse>[] = [];
  for (let index = 0; index < selection.eligible.length; index += 1) {
    const candidatePayment = candidatePayments.find(
      (payment) => payment.id === selection.eligible[index]!.paymentId,
    );
    if (!candidatePayment) continue; // unreachable — selection only returns scanned payments

    const candidate = generateRefundRecommendationCandidate(investigation, {
      payment: candidatePayment,
    });
    if (!candidate) continue; // defense in depth — selection already validated eligibility

    candidate.issueId = issue.id;

    const validation = validateRecommendationCandidate(candidate, {
      merchantId: params.merchantId,
      targetPayment: candidatePayment,
    });
    if (!validation.valid) continue; // re-validation failed — never persist an unvalidated candidate

    const riskLevel = determineRiskLevel({
      type: candidate.type,
      amountMinorUnits: validation.amountMinorUnits,
    });

    const recommendation = await createRecommendation(deps.db, {
      merchantId: params.merchantId,
      issueId: issue.id,
      investigationId: candidate.investigationId ?? null,
      type: candidate.type,
      title: candidate.title,
      explanation: candidate.explanation,
      riskLevel,
      targetPaymentId: candidate.targetPaymentId,
      amountMinorUnits: validation.amountMinorUnits,
      currency: validation.currency,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      initialStatus: "PENDING_APPROVAL",
    });

    await recordAuditEvent(deps.db, {
      merchantId: params.merchantId,
      eventType: "RECOMMENDATION_CREATED",
      recommendationId: recommendation.id,
      metadata: {
        type: recommendation.type,
        riskLevel: recommendation.riskLevel,
        recoveryBatch: true,
        batchIssueId: issue.id,
        batchIndex: index,
        batchSize: selection.eligible.length,
      },
    });

    recommendations.push(toRecommendationResponse(recommendation));
  }

  return {
    kind: "ok",
    batch: {
      issueId: issue.id,
      rootCause: issue.rootCause,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      limits: RECOVERY_BATCH_LIMITS,
      candidatesScanned: selection.candidatesScanned,
      eligibleCount: selection.eligible.length,
      rejectedCount: selection.rejected.length,
      amountEligibleMinorUnits: selection.amountEligibleMinorUnits,
      stoppedReason: selection.stoppedReason,
      rejectedCandidates: selection.rejected,
      recommendations,
    },
  };
}
