// Deterministic refund-eligibility checks (Phase 5 brief section 10). Used
// twice by design: once when a recommendation candidate is first
// validated (against our own DB's Payment row), and again — mandatorily —
// immediately before execution, against Razorpay's *live* payment state
// (packages/actions/src/refund/executeRefund.ts). Never trust a cached
// frontend value or a stale local read for the second check.

export interface RefundEligibilityInput {
  /** Only a captured payment can be refunded at all. */
  captured: boolean;
  totalAmountMinorUnits: number;
  alreadyRefundedMinorUnits: number;
  requestedAmountMinorUnits: number;
  requestedCurrency: string;
  paymentCurrency: string;
}

export type RefundEligibilityResult =
  { eligible: true; refundableAmountMinorUnits: number } | { eligible: false; reason: string };

export function validateRefundEligibility(input: RefundEligibilityInput): RefundEligibilityResult {
  if (!Number.isInteger(input.requestedAmountMinorUnits) || input.requestedAmountMinorUnits <= 0) {
    return {
      eligible: false,
      reason: "Refund amount must be a positive integer number of minor units",
    };
  }
  if (input.requestedCurrency !== input.paymentCurrency) {
    return { eligible: false, reason: "Refund currency does not match the payment's currency" };
  }
  if (!input.captured) {
    return { eligible: false, reason: "Payment has not been captured and cannot be refunded" };
  }

  const refundableAmountMinorUnits = input.totalAmountMinorUnits - input.alreadyRefundedMinorUnits;
  if (refundableAmountMinorUnits <= 0) {
    return { eligible: false, reason: "Payment has already been fully refunded" };
  }
  if (input.requestedAmountMinorUnits > refundableAmountMinorUnits) {
    return {
      eligible: false,
      reason: `Refund amount exceeds the refundable amount (${refundableAmountMinorUnits} minor units remaining)`,
    };
  }

  return { eligible: true, refundableAmountMinorUnits };
}
