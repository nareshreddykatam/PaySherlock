import { z } from "zod";
import {
  getPaymentAggregate,
  getPaymentStatusBreakdown,
  getRefundAggregate,
} from "@paysherlock/database";
import type { ToolDefinition } from "../types.js";
import {
  resolveBaselineWindow,
  scaleToWindow,
  toPeriodWindow,
  type PeriodWindow,
} from "../timeRange.js";
import type { Database } from "@paysherlock/database";

const METRICS = ["successful_payment_count", "revenue", "failure_rate", "refund_amount"] as const;

const InputSchema = z.object({
  metric: z.enum(METRICS),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  baselineStartTime: z.string().datetime().optional(),
  baselineEndTime: z.string().datetime().optional(),
});
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  metric: z.enum(METRICS),
  currentValue: z.number(),
  baselineValue: z.number(),
  absoluteChange: z.number(),
  percentageChange: z.number().nullable(),
});
export type ComparePeriodsOutput = z.infer<typeof OutputSchema>;
type Output = ComparePeriodsOutput;

/** Raw (unscaled) metric total for one window. Rate metrics are already
 * normalized; count/amount metrics are raw totals the caller must scale to
 * compare windows of different lengths. */
async function rawMetricValue(
  db: Database,
  merchantId: string,
  metric: (typeof METRICS)[number],
  window: PeriodWindow,
): Promise<number> {
  switch (metric) {
    case "successful_payment_count":
      return (
        await getPaymentAggregate(db, {
          merchantId,
          start: window.start,
          end: window.end,
          status: "CAPTURED",
        })
      ).count;
    case "revenue":
      return (
        await getPaymentAggregate(db, {
          merchantId,
          start: window.start,
          end: window.end,
          status: "CAPTURED",
        })
      ).amount;
    case "refund_amount":
      return (await getRefundAggregate(db, { merchantId, start: window.start, end: window.end }))
        .amount;
    case "failure_rate": {
      const rows = await getPaymentStatusBreakdown(db, {
        merchantId,
        start: window.start,
        end: window.end,
      });
      const total = rows.reduce((sum, row) => sum + row.count, 0);
      const failed = rows.find((row) => row.status === "FAILED")?.count ?? 0;
      return total > 0 ? failed / total : 0;
    }
  }
}

const RATE_METRICS = new Set<string>(["failure_rate"]);

/** Tool 3 — deterministic period comparison. Count/amount metrics from a
 * baseline window are scaled to the current window's duration before
 * comparing (e.g. a "previous 7 days" baseline scaled down to 1 day), so a
 * 1-day vs. 7-day comparison isn't misleading. Rate metrics are already
 * normalized and are never scaled. */
export const comparePeriodsTool: ToolDefinition<Input, Output> = {
  name: "compare_periods",
  description:
    "Compare one metric (successful_payment_count, revenue, failure_rate, or refund_amount) " +
    "between a current time range and a baseline (defaults to the preceding 7 days). Count/amount " +
    "baselines are duration-scaled to the current window for a fair comparison.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const current = toPeriodWindow(input);
    const baseline = resolveBaselineWindow(current, input);

    const [currentRaw, baselineRaw] = await Promise.all([
      rawMetricValue(ctx.db, ctx.merchantId, input.metric, current),
      rawMetricValue(ctx.db, ctx.merchantId, input.metric, baseline),
    ]);

    const baselineValue = RATE_METRICS.has(input.metric)
      ? baselineRaw
      : scaleToWindow(baselineRaw, baseline, current);
    const currentValue = currentRaw;
    const absoluteChange = currentValue - baselineValue;

    return {
      metric: input.metric,
      currentValue,
      baselineValue,
      absoluteChange,
      percentageChange: baselineValue !== 0 ? absoluteChange / baselineValue : null,
    };
  },
};
