import type { RecommendationCandidate } from "@paysherlock/types";
import { validateRefundEligibility } from "./refundEligibility.js";

// Phase 5 brief section 9: "AI recommendation candidate → zod validation →
// deterministic business validation → risk policy → persist." This module
// is the "deterministic business validation" step — it never trusts a
// candidate's own claims (amount, target payment) without checking them
// against real, currently-persisted state. A candidate that fails here is
// rejected outright — it never becomes a Recommendation row at all.

/** The minimal, already-normalized view of a payment this module needs —
 * callers (apps/api) build this from a real `packages/database` Payment
 * row, never from client input. */
export interface TargetPaymentContext {
  id: string;
  merchantId: string;
  captured: boolean;
  amount: number;
  amountRefunded: number;
  currency: string;
}

export interface ValidateRecommendationCandidateContext {
  merchantId: string;
  /** `null` when the candidate has no targetPaymentId, or the referenced
   * payment doesn't exist / wasn't loaded — either way, treated as "not
   * found", never assumed valid. */
  targetPayment: TargetPaymentContext | null;
}

export type RecommendationValidationResult =
  | { valid: true; amountMinorUnits: number | null; currency: string | null }
  | { valid: false; reason: string };

export function validateRecommendationCandidate(
  candidate: RecommendationCandidate,
  ctx: ValidateRecommendationCandidateContext,
): RecommendationValidationResult {
  if (candidate.type === "NO_ACTION") {
    return { valid: true, amountMinorUnits: null, currency: null };
  }

  // REFUND_PAYMENT from here down.
  if (!candidate.targetPaymentId) {
    return { valid: false, reason: "REFUND_PAYMENT requires a target payment" };
  }
  if (!ctx.targetPayment) {
    return { valid: false, reason: "Target payment was not found" };
  }
  if (ctx.targetPayment.merchantId !== ctx.merchantId) {
    return { valid: false, reason: "Target payment does not belong to this merchant" };
  }
  if (!candidate.amountMinorUnits || candidate.amountMinorUnits <= 0) {
    return { valid: false, reason: "Refund amount must be a positive integer" };
  }
  if (!candidate.currency) {
    return { valid: false, reason: "Refund currency is required" };
  }

  const eligibility = validateRefundEligibility({
    captured: ctx.targetPayment.captured,
    totalAmountMinorUnits: ctx.targetPayment.amount,
    alreadyRefundedMinorUnits: ctx.targetPayment.amountRefunded,
    requestedAmountMinorUnits: candidate.amountMinorUnits,
    requestedCurrency: candidate.currency,
    paymentCurrency: ctx.targetPayment.currency,
  });
  if (!eligibility.eligible) {
    return { valid: false, reason: eligibility.reason };
  }

  return {
    valid: true,
    amountMinorUnits: candidate.amountMinorUnits,
    currency: candidate.currency,
  };
}
