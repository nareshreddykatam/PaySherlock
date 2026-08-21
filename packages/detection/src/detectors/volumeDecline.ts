import { getPaymentAggregate } from "@paysherlock/database";
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
  VOLUME_DECLINE_RELATIVE_THRESHOLD,
} from "../engine/defaults.js";

/** Count of payment *attempts* (every status, not just captured) in a
 * window — deliberately not amount/revenue, so this stays a distinct
 * signal from a revenue decline (Phase 4 brief section 12: fewer attempts
 * is a different problem than the same attempts converting to less
 * money). `getPaymentAggregate` with no `status` filter counts every
 * attempt. */
async function attemptCountFor(ctx: DetectionContext, window: ComparisonWindow): Promise<number> {
  const result = await getPaymentAggregate(ctx.db, {
    merchantId: ctx.merchantId,
    start: window.start,
    end: window.end,
  });
  return result.count;
}

/** Detects a meaningful drop in payment *attempt volume* vs. the same time
 * of day on preceding days — packages/agent's
 * checkTransactionVolumeDecline hypothesis, triggered proactively. */
export const volumeDeclineDetector: Detector = {
  type: "TRANSACTION_VOLUME_DECLINE",

  async detect(ctx: DetectionContext): Promise<DetectionResult[]> {
    const windowDurationMs = ctx.config?.windowDurationMs ?? DEFAULT_WINDOW_DURATION_MS;
    const lookbackPeriods = ctx.config?.lookbackPeriods ?? DEFAULT_LOOKBACK_PERIODS;
    const minBaselineSampleSize =
      ctx.config?.minBaselineSampleSize ??
      DEFAULT_MIN_BASELINE_SAMPLE_SIZES.TRANSACTION_VOLUME_DECLINE;
    const minSampleSize =
      ctx.config?.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZES.TRANSACTION_VOLUME_DECLINE;

    const current = currentWindow(ctx.now, windowDurationMs);
    const baselineWindows = comparableBaselineWindows(current, lookbackPeriods);

    const [currentCount, baselineCounts] = await Promise.all([
      attemptCountFor(ctx, current),
      Promise.all(baselineWindows.map((w) => attemptCountFor(ctx, w))),
    ]);

    const baselineTotal = baselineCounts.reduce((sum, c) => sum + c, 0);
    const base = {
      type: "TRANSACTION_VOLUME_DECLINE" as const,
      metric: "transaction_attempt_count",
      windowStart: current.start.toISOString(),
      windowEnd: current.end.toISOString(),
      minSampleSize,
    };

    // A decline is only meaningful relative to a baseline that itself had
    // enough volume to be a real comparison point.
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
      comparison.relativeChange > VOLUME_DECLINE_RELATIVE_THRESHOLD
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
