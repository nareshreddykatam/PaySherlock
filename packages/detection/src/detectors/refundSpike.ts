import { getPaymentAggregate, getRefundAggregate } from "@paysherlock/database";
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
  DEFAULT_WINDOW_DURATION_MS,
  MIN_REFUND_COUNT,
  REFUND_RATE_CHANGE_THRESHOLD,
} from "../engine/defaults.js";

interface WindowRefundStats {
  refundCount: number;
  refundRate: number;
}

async function refundStatsFor(
  ctx: DetectionContext,
  window: ComparisonWindow,
): Promise<WindowRefundStats> {
  const [refunds, capturedPayments] = await Promise.all([
    getRefundAggregate(ctx.db, {
      merchantId: ctx.merchantId,
      start: window.start,
      end: window.end,
    }),
    getPaymentAggregate(ctx.db, {
      merchantId: ctx.merchantId,
      start: window.start,
      end: window.end,
      status: "CAPTURED",
    }),
  ]);
  return {
    refundCount: refunds.count,
    refundRate: capturedPayments.amount > 0 ? refunds.amount / capturedPayments.amount : 0,
  };
}

/** Detects abnormal refund behavior: refund amount as a share of captured
 * payment amount in the current window vs. the same time of day on
 * preceding days. Mirrors packages/agent's checkRefundSpike rate signal
 * (rateChange >= 0.02) — see docs/decisions. */
export const refundSpikeDetector: Detector = {
  type: "REFUND_SPIKE",

  async detect(ctx: DetectionContext): Promise<DetectionResult[]> {
    const windowDurationMs = ctx.config?.windowDurationMs ?? DEFAULT_WINDOW_DURATION_MS;
    const lookbackPeriods = ctx.config?.lookbackPeriods ?? DEFAULT_LOOKBACK_PERIODS;
    const minSampleSize = ctx.config?.minSampleSize ?? MIN_REFUND_COUNT;
    const minBaselineSampleSize =
      ctx.config?.minBaselineSampleSize ?? DEFAULT_MIN_BASELINE_SAMPLE_SIZES.REFUND_SPIKE;

    const current = currentWindow(ctx.now, windowDurationMs);
    const baselineWindows = comparableBaselineWindows(current, lookbackPeriods);

    const [currentStats, baselineStats] = await Promise.all([
      refundStatsFor(ctx, current),
      Promise.all(baselineWindows.map((w) => refundStatsFor(ctx, w))),
    ]);

    const baselineRefundCount = baselineStats.reduce((sum, s) => sum + s.refundCount, 0);
    const base = {
      type: "REFUND_SPIKE" as const,
      metric: "refund_rate",
      windowStart: current.start.toISOString(),
      windowEnd: current.end.toISOString(),
      minSampleSize,
    };

    // A refund *rate* can look dramatic from almost no refunds at all
    // (Phase 4 brief's "1 failed payment out of 2" example, applied here to
    // refund count) — gate on the raw count, not just the rate's inputs.
    if (currentStats.refundCount < minSampleSize || baselineRefundCount < minBaselineSampleSize) {
      return [
        DetectionResultSchema.parse({
          ...base,
          status: "INSUFFICIENT_DATA",
          currentValue: currentStats.refundRate,
          baselineValue: 0,
          absoluteChange: 0,
          relativeChange: null,
          sampleSize: currentStats.refundCount,
        }),
      ];
    }

    const comparison = compareToBaseline(
      currentStats.refundRate,
      baselineStats.map((s) => s.refundRate),
    );

    if (comparison.absoluteChange < REFUND_RATE_CHANGE_THRESHOLD) {
      return [];
    }

    const severity = computeSeverity({
      kind: "rate-points",
      magnitude: comparison.absoluteChange,
      sampleSize: currentStats.refundCount,
      minSampleSize,
    });

    return [
      DetectionResultSchema.parse({
        ...base,
        status: "ANOMALY",
        currentValue: currentStats.refundRate,
        baselineValue: comparison.baselineValue,
        absoluteChange: comparison.absoluteChange,
        relativeChange: comparison.relativeChange,
        sampleSize: currentStats.refundCount,
        baselineMin: comparison.baselineMin,
        baselineMax: comparison.baselineMax,
        comparisonWindows: comparison.comparisonWindows,
        severity,
      }),
    ];
  },
};
