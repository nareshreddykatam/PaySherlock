// Documented default thresholds. Chosen to line up with the Phase 2
// hypothesis-verification thresholds (packages/agent/src/hypotheses/rules.ts)
// where the underlying metric is the same (e.g. failure-rate change, refund
// rate change) — see docs/decisions — so an anomaly the detector flags as
// worth investigating is realistically able to reach SUPPORTED once the
// existing investigation engine looks at the same window. They are
// judgment calls appropriate for a Buildathon MVP, not statistically
// derived, and are all overridable via DetectorRuntimeConfig.

export const DEFAULT_WINDOW_DURATION_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_LOOKBACK_PERIODS = 7; // preceding 7 days, same clock time

export const DEFAULT_MIN_SAMPLE_SIZES = {
  PAYMENT_FAILURE_SPIKE: 30,
  PAYMENT_METHOD_DEGRADATION: 20,
  REFUND_SPIKE: 20,
  TRANSACTION_VOLUME_DECLINE: 30,
  HIGH_VALUE_TRANSACTION_DECLINE: 20,
} as const;

export const DEFAULT_MIN_BASELINE_SAMPLE_SIZES = {
  PAYMENT_FAILURE_SPIKE: 30,
  PAYMENT_METHOD_DEGRADATION: 20,
  REFUND_SPIKE: 20,
  TRANSACTION_VOLUME_DECLINE: 30,
  HIGH_VALUE_TRANSACTION_DECLINE: 10,
} as const;

/** Minimum refund count in the current window — a refund *rate* can look
 * huge with almost no refunds at all (Phase 4 brief's "1 failed payment out
 * of 2" example, applied to refunds). */
export const MIN_REFUND_COUNT = 5;

/** Minimum current-window sample for a single payment method to be
 * evaluated at all by the method-degradation detector. */
export const MIN_METHOD_SAMPLE_SIZE = 15;

/** "High-value" transaction threshold — deliberately the same ₹10,000
 * (1,000,000 paise) boundary as packages/tools' `segment_payments`
 * amount-bucket split (the "₹10,000+" bucket), so this detector's notion of
 * "high value" matches the existing investigation engine's, not a second,
 * inconsistent definition invented for detection alone. */
export const HIGH_VALUE_THRESHOLD_MINOR_UNITS = 1_000_000;

// Anomaly thresholds — the bar a detector requires before it emits an
// ANOMALY result at all (as opposed to reporting no result / normal).
export const FAILURE_RATE_CHANGE_THRESHOLD = 0.03; // 3 percentage points
export const METHOD_FAILURE_RATE_CHANGE_THRESHOLD = 0.05; // 5 percentage points
export const REFUND_RATE_CHANGE_THRESHOLD = 0.02; // 2 percentage points
export const VOLUME_DECLINE_RELATIVE_THRESHOLD = -0.2; // -20%
export const HIGH_VALUE_DECLINE_RELATIVE_THRESHOLD = -0.25; // -25%
