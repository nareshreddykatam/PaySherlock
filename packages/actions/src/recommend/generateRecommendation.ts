import type { InvestigationResult, RecommendationCandidate } from "@paysherlock/types";

// The deterministic bridge from "an investigation completed" to "here is a
// recommendation candidate" (Phase 5 brief section 9). Phase 2's
// InvestigationResult has no concept of recommendations at all — this is
// new Phase 5 logic, not a rewrite of the agent. It only ever reuses
// numbers/text the investigation already computed (rootCause, summary,
// the payment's *current* refundable amount) — it never invents a number.
// The result is still just a *candidate*: apps/api runs it through
// validation/recommendationValidation.ts before it can ever be persisted.

export interface RefundCandidateContext {
  payment: {
    id: string;
    captured: boolean;
    amount: number;
    amountRefunded: number;
    currency: string;
  };
}

function formatTitleAmount(amountMinorUnits: number, currency: string): string {
  const major = amountMinorUnits / 100;
  if (currency === "INR") {
    const formatted = major.toLocaleString("en-IN", {
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    });
    return `Refund ₹${formatted}`;
  }
  return `Refund ${major.toFixed(2)} ${currency}`;
}

/**
 * Only produces a candidate when the investigation actually found a root
 * cause AND the payment still has refundable room — otherwise returns
 * `null` (no recommendation at all, not a degraded one). Never called for
 * an investigation that wasn't scoped to a specific payment in the first
 * place (see `InvestigationRequest.targetPaymentId`).
 */
export function generateRefundRecommendationCandidate(
  investigation: Pick<InvestigationResult, "rootCause" | "summary" | "meta">,
  ctx: RefundCandidateContext,
): RecommendationCandidate | null {
  if (!investigation.rootCause) return null;
  if (!ctx.payment.captured) return null;

  const refundableAmountMinorUnits = ctx.payment.amount - ctx.payment.amountRefunded;
  if (refundableAmountMinorUnits <= 0) return null;

  return {
    type: "REFUND_PAYMENT",
    title: formatTitleAmount(refundableAmountMinorUnits, ctx.payment.currency),
    explanation: investigation.summary,
    investigationId: investigation.meta.investigationId,
    targetPaymentId: ctx.payment.id,
    amountMinorUnits: refundableAmountMinorUnits,
    currency: ctx.payment.currency,
  };
}

/** The always-available fallback candidate — "PaySherlock investigated and
 * is explicitly recommending no action", a first-class outcome per the
 * brief, not an absence of one. */
export function generateNoActionCandidate(
  investigation: Pick<InvestigationResult, "summary" | "meta">,
): RecommendationCandidate {
  return {
    type: "NO_ACTION",
    title: "No action required",
    explanation: investigation.summary,
    investigationId: investigation.meta.investigationId,
  };
}
