import { getPaymentAmounts } from "@paysherlock/database";
import { DetectionResultSchema, type DetectionResult } from "@paysherlock/types";
import {
  comparableBaselineWindows,
  currentWindow,
  type ComparisonWindow,
} from "../baseline/window.js";
import { compareToBaseline } from "../baseline/compare.js";
import { computeSeverity } from "../severity/severity.js";
import type { Detector, DetectionContext } from "../engine/types.js";
import {
  DEFAULT_LOOKBACK_PERIODS,
  DEFAULT_MIN_BASELINE_SAMPLE_SIZES,
  DEFAULT_MIN_SAMPLE_SIZES,
  DEFAULT_WINDOW_DURATION_MS,
  HIGH_VALUE_DECLINE_RELATIVE_THRESHOLD,
  HIGH_VALUE_THRESHOLD_MINOR_UNITS,
} from "../engine/defaults.js";

/** Count of captured payments at/above the high-value threshold in a
 * window. Counting (not summing amount) keeps this comparable to the other
 * count-based detectors and immune to a single outlier transaction
 * dominating the signal. */
async function highValueCountFor(ctx: DetectionContext, window: ComparisonWindow): Promise<number> {
  const amounts = await getPaymentAmounts(ctx.db, {
    merchantId: ctx.merchantId,
    start: window.start,
    end: window.end,
    status: "CAPTURED",
  });
  return amounts.filter((amount) => amount >= HIGH_VALUE_THRESHOLD_MINOR_UNITS).length;
}

/** Detects a meaningful decline in high-value transaction activity vs. the
 * same time of day on preceding days. "High-value" is a fixed, documented
 * threshold (₹10,000+ — the same boundary packages/tools' amount-bucket
 * segmentation already uses), not a frontend-only or arbitrary cutoff — see
 * docs/decisions. */
export const highValueDeclineDetector: Detector = {
  type: "HIGH_VALUE_TRANSACTION_DECLINE",

  async detect(ctx: DetectionContext): Promise<DetectionResult[]> {
    const windowDurationMs = ctx.config?.windowDurationMs ?? DEFAULT_WINDOW_DURATION_MS;
    const lookbackPeriods = ctx.config?.lookbackPeriods ?? DEFAULT_LOOKBACK_PERIODS;
    const minBaselineSampleSize =
      ctx.config?.minBaselineSampleSize ??
      DEFAULT_MIN_BASELINE_SAMPLE_SIZES.HIGH_VALUE_TRANSACTION_DECLINE;
    const minSampleSize =
      ctx.config?.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZES.HIGH_VALUE_TRANSACTION_DECLINE;

    const current = currentWindow(ctx.now, windowDurationMs);
    const baselineWindows = comparableBaselineWindows(current, lookbackPeriods);

    const [currentCount, baselineCounts] = await Promise.all([
      highValueCountFor(ctx, current),
      Promise.all(baselineWindows.map((w) => highValueCountFor(ctx, w))),
    ]);

    const baselineTotal = baselineCounts.reduce((sum, c) => sum + c, 0);
    const base = {
      type: "HIGH_VALUE_TRANSACTION_DECLINE" as const,
      metric: "high_value_transaction_count",
      windowStart: current.start.toISOString(),
      windowEnd: current.end.toISOString(),
      minSampleSize,
    };

    if (baselineTotal < minBaselineSampleSize) {
      return [
        DetectionResultSchema.parse({
          ...base,
          status: "INSUFFICIENT_DATA",
          currentValue: currentCount,
          baselineValue: 0,
          absoluteChange: 0,
          relativeChange: null,
          sampleSize: currentCount,
        }),
      ];
    }

    const comparison = compareToBaseline(currentCount, baselineCounts);

    if (
      comparison.relativeChange === null ||
      comparison.relativeChange > HIGH_VALUE_DECLINE_RELATIVE_THRESHOLD
    ) {
      return [];
    }

    const severity = computeSeverity({
      kind: "relative",
      magnitude: comparison.relativeChange,
      sampleSize: baselineTotal,
      minSampleSize: minBaselineSampleSize,
    });

    return [
      DetectionResultSchema.parse({
        ...base,
        status: "ANOMALY",
        currentValue: currentCount,
        baselineValue: comparison.baselineValue,
        absoluteChange: comparison.absoluteChange,
        relativeChange: comparison.relativeChange,
        sampleSize: currentCount,
        baselineMin: comparison.baselineMin,
        baselineMax: comparison.baselineMax,
        comparisonWindows: comparison.comparisonWindows,
        severity,
      }),
    ];
  },
};
