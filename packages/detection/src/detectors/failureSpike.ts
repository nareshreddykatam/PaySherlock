import { getPaymentStatusBreakdown } from "@paysherlock/database";
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
  FAILURE_RATE_CHANGE_THRESHOLD,
} from "../engine/defaults.js";

interface WindowFailureStats {
  totalAttempts: number;
  failureRate: number;
}

async function failureStatsFor(
  ctx: DetectionContext,
  window: ComparisonWindow,
): Promise<WindowFailureStats> {
  const rows = await getPaymentStatusBreakdown(ctx.db, {
    merchantId: ctx.merchantId,
    start: window.start,
    end: window.end,
  });
  const totalAttempts = rows.reduce((sum, row) => sum + row.count, 0);
  const failed = rows.find((row) => row.status === "FAILED")?.count ?? 0;
  return { totalAttempts, failureRate: totalAttempts > 0 ? failed / totalAttempts : 0 };
}

/** Detects a meaningful, merchant-wide rise in the overall payment failure
 * rate vs. the same time of day on preceding days. See
 * packages/agent/src/hypotheses/rules.ts::checkUpiFailureIncrease and
 * ::checkPaymentMethodDegradation, which the triggered investigation uses
 * to narrow down *which* method is responsible — this detector
 * deliberately only looks at the merchant-wide rate. */
export const failureSpikeDetector: Detector = {
  type: "PAYMENT_FAILURE_SPIKE",

  async detect(ctx: DetectionContext): Promise<DetectionResult[]> {
    const windowDurationMs = ctx.config?.windowDurationMs ?? DEFAULT_WINDOW_DURATION_MS;
    const lookbackPeriods = ctx.config?.lookbackPeriods ?? DEFAULT_LOOKBACK_PERIODS;
    const minSampleSize =
      ctx.config?.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZES.PAYMENT_FAILURE_SPIKE;
    const minBaselineSampleSize =
      ctx.config?.minBaselineSampleSize ?? DEFAULT_MIN_BASELINE_SAMPLE_SIZES.PAYMENT_FAILURE_SPIKE;

    const current = currentWindow(ctx.now, windowDurationMs);
    const baselineWindows = comparableBaselineWindows(current, lookbackPeriods);

    const [currentStats, baselineStats] = await Promise.all([
      failureStatsFor(ctx, current),
      Promise.all(baselineWindows.map((w) => failureStatsFor(ctx, w))),
    ]);

    const baselineTotalAttempts = baselineStats.reduce((sum, s) => sum + s.totalAttempts, 0);
    const base = {
      type: "PAYMENT_FAILURE_SPIKE" as const,
      metric: "failure_rate",
      windowStart: current.start.toISOString(),
      windowEnd: current.end.toISOString(),
      minSampleSize,
    };

    if (
      currentStats.totalAttempts < minSampleSize ||
      baselineTotalAttempts < minBaselineSampleSize
    ) {
      return [
        DetectionResultSchema.parse({
          ...base,
          status: "INSUFFICIENT_DATA",
          currentValue: currentStats.failureRate,
          baselineValue: 0,
          absoluteChange: 0,
          relativeChange: null,
          sampleSize: currentStats.totalAttempts,
        }),
      ];
    }

    const comparison = compareToBaseline(
      currentStats.failureRate,
      baselineStats.map((s) => s.failureRate),
    );

    if (comparison.absoluteChange < FAILURE_RATE_CHANGE_THRESHOLD) {
      return [];
    }

    const severity = computeSeverity({
      kind: "rate-points",
      magnitude: comparison.absoluteChange,
      sampleSize: currentStats.totalAttempts,
      minSampleSize,
    });

    return [
      DetectionResultSchema.parse({
        ...base,
        status: "ANOMALY",
        currentValue: currentStats.failureRate,
        baselineValue: comparison.baselineValue,
        absoluteChange: comparison.absoluteChange,
        relativeChange: comparison.relativeChange,
        sampleSize: currentStats.totalAttempts,
        baselineMin: comparison.baselineMin,
        baselineMax: comparison.baselineMax,
        comparisonWindows: comparison.comparisonWindows,
        severity,
      }),
    ];
  },
};
