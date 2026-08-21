import { getPaymentMethodStatusBreakdown } from "@paysherlock/database";
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
  DEFAULT_WINDOW_DURATION_MS,
  METHOD_FAILURE_RATE_CHANGE_THRESHOLD,
  MIN_METHOD_SAMPLE_SIZE,
} from "../engine/defaults.js";

interface MethodStats {
  count: number;
  failed: number;
}

async function methodStatsFor(
  ctx: DetectionContext,
  window: ComparisonWindow,
): Promise<Map<string, MethodStats>> {
  const rows = await getPaymentMethodStatusBreakdown(ctx.db, {
    merchantId: ctx.merchantId,
    start: window.start,
    end: window.end,
  });
  const byMethod = new Map<string, MethodStats>();
  for (const row of rows) {
    const entry = byMethod.get(row.method) ?? { count: 0, failed: 0 };
    entry.count += row.count;
    if (row.status === "FAILED") entry.failed += row.count;
    byMethod.set(row.method, entry);
  }
  return byMethod;
}

/** Analyzes every payment method independently (not just UPI — Phase 4
 * brief section 10) and flags any single method whose failure rate has
 * degraded meaningfully vs. the same time of day on preceding days, with
 * enough method-specific volume to mean something. Each anomalous method
 * produces its own DetectionResult (`dimension` = method name), so e.g.
 * UPI and cards degrading at the same time become two separate issues. */
export const methodDegradationDetector: Detector = {
  type: "PAYMENT_METHOD_DEGRADATION",

  async detect(ctx: DetectionContext): Promise<DetectionResult[]> {
    const windowDurationMs = ctx.config?.windowDurationMs ?? DEFAULT_WINDOW_DURATION_MS;
    const lookbackPeriods = ctx.config?.lookbackPeriods ?? DEFAULT_LOOKBACK_PERIODS;
    const minSampleSize = ctx.config?.minSampleSize ?? MIN_METHOD_SAMPLE_SIZE;

    const current = currentWindow(ctx.now, windowDurationMs);
    const baselineWindows = comparableBaselineWindows(current, lookbackPeriods);

    const [currentByMethod, baselineByMethodPerWindow] = await Promise.all([
      methodStatsFor(ctx, current),
      Promise.all(baselineWindows.map((w) => methodStatsFor(ctx, w))),
    ]);

    const results: DetectionResult[] = [];

    for (const [method, currentStats] of currentByMethod.entries()) {
      if (currentStats.count < minSampleSize) continue;

      const currentFailureRate =
        currentStats.count > 0 ? currentStats.failed / currentStats.count : 0;
      const baselineRatesForMethod: number[] = [];
      let baselineSampleForMethod = 0;
      for (const windowMap of baselineByMethodPerWindow) {
        const stats = windowMap.get(method);
        if (!stats || stats.count === 0) continue;
        baselineRatesForMethod.push(stats.failed / stats.count);
        baselineSampleForMethod += stats.count;
      }

      const base = {
        type: "PAYMENT_METHOD_DEGRADATION" as const,
        metric: "method_failure_rate",
        dimension: method,
        windowStart: current.start.toISOString(),
        windowEnd: current.end.toISOString(),
        minSampleSize,
      };

      // No baseline history at all for this method — can't say whether
      // this is a change, only that we don't know. Reported once, not
      // treated as normal.
      if (baselineRatesForMethod.length === 0) {
        results.push(
          DetectionResultSchema.parse({
            ...base,
            status: "INSUFFICIENT_DATA",
            currentValue: currentFailureRate,
            baselineValue: 0,
            absoluteChange: 0,
            relativeChange: null,
            sampleSize: currentStats.count,
          }),
        );
        continue;
      }

      const comparison = compareToBaseline(currentFailureRate, baselineRatesForMethod);
      if (comparison.absoluteChange < METHOD_FAILURE_RATE_CHANGE_THRESHOLD) continue;

      const severity = computeSeverity({
        kind: "rate-points",
        magnitude: comparison.absoluteChange,
        sampleSize: Math.min(currentStats.count, baselineSampleForMethod),
        minSampleSize,
      });

      results.push(
        DetectionResultSchema.parse({
          ...base,
          status: "ANOMALY",
          currentValue: currentFailureRate,
          baselineValue: comparison.baselineValue,
          absoluteChange: comparison.absoluteChange,
          relativeChange: comparison.relativeChange,
          sampleSize: currentStats.count,
          baselineMin: comparison.baselineMin,
          baselineMax: comparison.baselineMax,
          comparisonWindows: comparison.comparisonWindows,
          severity,
        }),
      );
    }

    return results;
  },
};
