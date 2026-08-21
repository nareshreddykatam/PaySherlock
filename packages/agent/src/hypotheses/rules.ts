import type { Evidence, HypothesisStatusType } from "@paysherlock/types";
import type { Findings } from "../evidence/findings.js";
import { createEvidenceFactory, formatPercent, formatPercentagePoints } from "../evidence/build.js";
import { HYPOTHESIS_IDS } from "./catalog.js";

export interface HypothesisCheckResult {
  status: HypothesisStatusType;
  evidence: Evidence[];
}

// Every threshold below is a deliberate, documented judgment call — see
// docs/decisions for the rationale. They exist so hypothesis status is a
// function of real tool numbers, never something an LLM asserts on its
// own (Phase 2 brief, hypothesis verification section).

function checkUpiFailureIncrease(
  findings: Findings,
  makeEvidence: ReturnType<typeof createEvidenceFactory>,
): HypothesisCheckResult {
  const { failures } = findings;
  const upi = failures?.paymentMethods.find((m) => m.method === "UPI");
  if (!failures || !upi) {
    return { status: "INCONCLUSIVE", evidence: [] };
  }

  const change = failures.failureRateChange;
  const upiShare = upi.shareOfFailures;
  const evidence = [
    makeEvidence({
      source: "get_payment_failures",
      metric: "overall_failure_rate",
      observedValue: failures.failureRate,
      baselineValue: failures.previousFailureRate,
      comparison: `${formatPercentagePoints(change)} vs. baseline`,
      significance: change >= 0.05 ? "high" : change >= 0.02 ? "medium" : "low",
      supportsHypothesisIds: [HYPOTHESIS_IDS.UPI_FAILURE_INCREASE],
    }),
    makeEvidence({
      source: "get_payment_failures",
      metric: "upi_share_of_failures",
      observedValue: upiShare,
      comparison: `${formatPercent(upiShare)} of failed payments used UPI`,
      significance: upiShare >= 0.5 ? "high" : upiShare >= 0.3 ? "medium" : "low",
      supportsHypothesisIds: [HYPOTHESIS_IDS.UPI_FAILURE_INCREASE],
    }),
  ];

  if (change >= 0.03 && upiShare >= 0.5) return { status: "SUPPORTED", evidence };
  if (change < 0.01 || upiShare < 0.3) return { status: "REJECTED", evidence };
  return { status: "INCONCLUSIVE", evidence };
}

function checkTransactionVolumeDecline(
  findings: Findings,
  makeEvidence: ReturnType<typeof createEvidenceFactory>,
): HypothesisCheckResult {
  const volume = findings.periodComparisons.successful_payment_count;
  if (!volume || volume.percentageChange === null) {
    return { status: "INCONCLUSIVE", evidence: [] };
  }

  const failureRateStable =
    !findings.failures || Math.abs(findings.failures.failureRateChange) < 0.02;
  const evidence = [
    makeEvidence({
      source: "compare_periods",
      metric: "successful_payment_count",
      observedValue: volume.currentValue,
      baselineValue: volume.baselineValue,
      comparison: `${formatPercent(volume.percentageChange)} vs. baseline`,
      significance:
        volume.percentageChange <= -0.3
          ? "high"
          : volume.percentageChange <= -0.15
            ? "medium"
            : "low",
      supportsHypothesisIds: [HYPOTHESIS_IDS.TRANSACTION_VOLUME_DECLINE],
    }),
  ];

  if (volume.percentageChange <= -0.2 && failureRateStable)
    return { status: "SUPPORTED", evidence };
  if (volume.percentageChange > -0.05) return { status: "REJECTED", evidence };
  return { status: "INCONCLUSIVE", evidence };
}

function checkRefundSpike(
  findings: Findings,
  makeEvidence: ReturnType<typeof createEvidenceFactory>,
): HypothesisCheckResult {
  const { refunds } = findings;
  if (!refunds) return { status: "INCONCLUSIVE", evidence: [] };

  const amountChangePercent =
    refunds.baselineRefundAmount > 0
      ? refunds.change.amountChange / refunds.baselineRefundAmount
      : null;
  const rateChange = refunds.change.rateChange;

  const evidence = [
    makeEvidence({
      source: "get_refunds",
      metric: "refund_rate",
      observedValue: refunds.refundRate,
      baselineValue: refunds.baselineRefundRate,
      comparison: `${formatPercentagePoints(rateChange)} vs. baseline`,
      significance: rateChange >= 0.03 ? "high" : rateChange >= 0.015 ? "medium" : "low",
      supportsHypothesisIds: [HYPOTHESIS_IDS.REFUND_SPIKE],
    }),
  ];

  const strongRateSignal = rateChange >= 0.02;
  const strongAmountSignal = amountChangePercent !== null && amountChangePercent >= 0.5;
  if (strongRateSignal || strongAmountSignal) return { status: "SUPPORTED", evidence };
  if (rateChange < 0.005 && (amountChangePercent === null || amountChangePercent < 0.15)) {
    return { status: "REJECTED", evidence };
  }
  return { status: "INCONCLUSIVE", evidence };
}

function checkPaymentMethodDegradation(
  findings: Findings,
  makeEvidence: ReturnType<typeof createEvidenceFactory>,
): HypothesisCheckResult {
  const nonUpiMethods = (findings.failures?.paymentMethods ?? []).filter((m) => m.method !== "UPI");
  if (nonUpiMethods.length === 0) return { status: "INCONCLUSIVE", evidence: [] };

  const worst = [...nonUpiMethods].sort((a, b) => b.failureRate - a.failureRate)[0]!;
  const evidence = [
    makeEvidence({
      source: "get_payment_failures",
      metric: `${worst.method.toLowerCase()}_failure_rate`,
      observedValue: worst.failureRate,
      comparison: `${formatPercent(worst.failureRate)} failure rate, ${formatPercent(worst.shareOfFailures)} of all failures`,
      significance:
        worst.failureRate >= 0.15 ? "high" : worst.failureRate >= 0.08 ? "medium" : "low",
      supportsHypothesisIds: [HYPOTHESIS_IDS.PAYMENT_METHOD_DEGRADATION],
    }),
  ];

  if (worst.failureRate >= 0.15 && worst.shareOfFailures >= 0.4)
    return { status: "SUPPORTED", evidence };
  if (nonUpiMethods.every((m) => m.failureRate < 0.08)) return { status: "REJECTED", evidence };
  return { status: "INCONCLUSIVE", evidence };
}

const HIGH_VALUE_BUCKET_KEY = "₹10,000+";

function checkHighValueDecline(
  findings: Findings,
  makeEvidence: ReturnType<typeof createEvidenceFactory>,
): HypothesisCheckResult {
  const segments = findings.segmentsByAmountBucket?.segments ?? [];
  const highBucket = segments.find((s) => s.key === HIGH_VALUE_BUCKET_KEY);
  if (!highBucket || highBucket.changePercent === null || highBucket.changePercent === undefined) {
    return { status: "INCONCLUSIVE", evidence: [] };
  }

  const otherChanges = segments
    .filter(
      (s) =>
        s.key !== HIGH_VALUE_BUCKET_KEY &&
        s.changePercent !== null &&
        s.changePercent !== undefined,
    )
    .map((s) => s.changePercent as number);
  const avgOtherChange =
    otherChanges.length > 0 ? otherChanges.reduce((sum, v) => sum + v, 0) / otherChanges.length : 0;

  const evidence = [
    makeEvidence({
      source: "segment_payments",
      metric: "high_value_bucket_amount",
      observedValue: highBucket.amount,
      baselineValue: highBucket.baselineAmount,
      comparison: `${formatPercent(highBucket.changePercent)} vs. baseline (other buckets avg ${formatPercent(avgOtherChange)})`,
      significance:
        highBucket.changePercent <= -0.4
          ? "high"
          : highBucket.changePercent <= -0.25
            ? "medium"
            : "low",
      supportsHypothesisIds: [HYPOTHESIS_IDS.HIGH_VALUE_DECLINE],
    }),
  ];

  if (highBucket.changePercent <= -0.25 && avgOtherChange > -0.1)
    return { status: "SUPPORTED", evidence };
  if (highBucket.changePercent > -0.05) return { status: "REJECTED", evidence };
  return { status: "INCONCLUSIVE", evidence };
}

export const HYPOTHESIS_CHECKS: Record<
  string,
  (
    findings: Findings,
    makeEvidence: ReturnType<typeof createEvidenceFactory>,
  ) => HypothesisCheckResult
> = {
  [HYPOTHESIS_IDS.UPI_FAILURE_INCREASE]: checkUpiFailureIncrease,
  [HYPOTHESIS_IDS.TRANSACTION_VOLUME_DECLINE]: checkTransactionVolumeDecline,
  [HYPOTHESIS_IDS.REFUND_SPIKE]: checkRefundSpike,
  [HYPOTHESIS_IDS.PAYMENT_METHOD_DEGRADATION]: checkPaymentMethodDegradation,
  [HYPOTHESIS_IDS.HIGH_VALUE_DECLINE]: checkHighValueDecline,
};
