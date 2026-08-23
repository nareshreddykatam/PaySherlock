import { validateRefundEligibility } from "../validation/refundEligibility.js";

// Track 03 (AI Revenue Recovery) — deterministic recovery-batch candidate
// selection. This is NOT a bulk-refund feature: it reuses the exact same
// per-payment eligibility rule Phase 5 already uses for a single-payment
// refund (validateRefundEligibility — captured + refundable room > 0),
// applied across a bounded, ordered batch of payments, with explicit
// stopping limits. No new financial action type, no new execution path —
// every resulting candidate still goes through createRecommendation →
// PENDING_APPROVAL → the existing, unmodified approve-and-execute pipeline
// one at a time.

export interface RecoveryCandidatePayment {
  id: string;
  razorpayPaymentId: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  captured: boolean;
  razorpayCreatedAt: Date;
}

export interface RecoveryBatchLimits {
  /** Stop once this many eligible candidates have been selected. */
  maxCandidates: number;
  /** Stop before selecting a candidate that would push the running total
   * of selected candidates' refundable amounts past this limit. */
  maxTotalAmountMinorUnits: number;
}

export interface RecoveryCandidate {
  paymentId: string;
  razorpayPaymentId: string;
  amountMinorUnits: number;
  currency: string;
}

export interface RejectedRecoveryCandidate {
  paymentId: string;
  razorpayPaymentId: string;
  reason: string;
}

export type RecoveryBatchStopReason = "max_candidates_reached" | "max_amount_reached" | null;

export interface SelectRecoveryCandidatesResult {
  eligible: RecoveryCandidate[];
  rejected: RejectedRecoveryCandidate[];
  candidatesScanned: number;
  amountEligibleMinorUnits: number;
  stoppedReason: RecoveryBatchStopReason;
}

/**
 * Deterministically ranks `payments` (oldest-first, tie-broken by id — the
 * caller is expected to already have queried them in this order, but we
 * re-sort defensively so the result never depends on the caller's query
 * happening to preserve it) and selects eligible recovery candidates up to
 * `limits`. A payment already present in `alreadyRecommendedPaymentIds` is
 * rejected outright — the batch never re-recommends a payment that already
 * has a recommendation of any status (duplicate-candidate prevention).
 *
 * Stopping is a hard boundary, not best-fit packing: once a limit would be
 * exceeded, scanning stops entirely — later, possibly-smaller-or-cheaper
 * candidates are never opportunistically included instead. This keeps the
 * result predictable and keeps "why did the batch stop" a single,
 * reportable reason rather than an optimization outcome.
 */
export function selectRecoveryCandidates(
  payments: RecoveryCandidatePayment[],
  limits: RecoveryBatchLimits,
  alreadyRecommendedPaymentIds: ReadonlySet<string>,
): SelectRecoveryCandidatesResult {
  const ordered = [...payments].sort((a, b) => {
    const byTime = a.razorpayCreatedAt.getTime() - b.razorpayCreatedAt.getTime();
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });

  const eligible: RecoveryCandidate[] = [];
  const rejected: RejectedRecoveryCandidate[] = [];
  let amountEligibleMinorUnits = 0;
  let stoppedReason: RecoveryBatchStopReason = null;
  let candidatesScanned = 0;

  for (const payment of ordered) {
    if (eligible.length >= limits.maxCandidates) {
      stoppedReason = "max_candidates_reached";
      break;
    }

    candidatesScanned += 1;

    if (alreadyRecommendedPaymentIds.has(payment.id)) {
      rejected.push({
        paymentId: payment.id,
        razorpayPaymentId: payment.razorpayPaymentId,
        reason: "Payment already has an existing recommendation",
      });
      continue;
    }

    const requestedAmountMinorUnits = payment.amount - payment.amountRefunded;
    const eligibility = validateRefundEligibility({
      captured: payment.captured,
      totalAmountMinorUnits: payment.amount,
      alreadyRefundedMinorUnits: payment.amountRefunded,
      requestedAmountMinorUnits,
      requestedCurrency: payment.currency,
      paymentCurrency: payment.currency,
    });
    if (!eligibility.eligible) {
      rejected.push({
        paymentId: payment.id,
        razorpayPaymentId: payment.razorpayPaymentId,
        reason: eligibility.reason,
      });
      continue;
    }

    if (amountEligibleMinorUnits + requestedAmountMinorUnits > limits.maxTotalAmountMinorUnits) {
      stoppedReason = "max_amount_reached";
      break;
    }

    eligible.push({
      paymentId: payment.id,
      razorpayPaymentId: payment.razorpayPaymentId,
      amountMinorUnits: requestedAmountMinorUnits,
      currency: payment.currency,
    });
    amountEligibleMinorUnits += requestedAmountMinorUnits;
  }

  return { eligible, rejected, candidatesScanned, amountEligibleMinorUnits, stoppedReason };
}
