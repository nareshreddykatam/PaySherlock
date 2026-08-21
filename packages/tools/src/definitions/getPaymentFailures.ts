import { z } from "zod";
import {
  getFailureCodeBreakdown,
  getPaymentMethodStatusBreakdown,
  getPaymentStatusBreakdown,
  getPaymentTimestamps,
} from "@paysherlock/database";
import type { ToolDefinition } from "../types.js";
import { resolveBaselineWindow, toPeriodWindow } from "../timeRange.js";

const InputSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  baselineStartTime: z.string().datetime().optional(),
  baselineEndTime: z.string().datetime().optional(),
});
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  totalAttempts: z.number().int(),
  failedCount: z.number().int(),
  failureRate: z.number(),
  previousFailureRate: z.number(),
  failureRateChange: z.number(),
  failureReasons: z.array(
    z.object({ code: z.string(), count: z.number().int(), share: z.number() }),
  ),
  paymentMethods: z.array(
    z.object({
      method: z.string(),
      count: z.number().int(),
      failureRate: z.number(),
      shareOfFailures: z.number(),
    }),
  ),
  timeDistribution: z.array(z.object({ hourUtc: z.number().int(), count: z.number().int() })),
});
export type GetPaymentFailuresOutput = z.infer<typeof OutputSchema>;
type Output = GetPaymentFailuresOutput;

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Tool 2 — deterministic failure analysis: rate, rate-of-change vs.
 * baseline, breakdown by method/reason/hour. All arithmetic happens here in
 * code — the model never computes these numbers itself. */
export const getPaymentFailuresTool: ToolDefinition<Input, Output> = {
  name: "get_payment_failures",
  description:
    "Analyze failed payments for a time range vs. a baseline (defaults to the preceding 7 days): " +
    "overall failure rate and its change, breakdown by failure reason code, by payment method, " +
    "and by hour of day.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const current = toPeriodWindow(input);
    const baseline = resolveBaselineWindow(current, input);
    const merchantId = ctx.merchantId;

    const [
      currentStatusRows,
      baselineStatusRows,
      methodStatusRows,
      failureCodeRows,
      failedTimestamps,
    ] = await Promise.all([
      getPaymentStatusBreakdown(ctx.db, { merchantId, start: current.start, end: current.end }),
      getPaymentStatusBreakdown(ctx.db, { merchantId, start: baseline.start, end: baseline.end }),
      getPaymentMethodStatusBreakdown(ctx.db, {
        merchantId,
        start: current.start,
        end: current.end,
      }),
      getFailureCodeBreakdown(ctx.db, { merchantId, start: current.start, end: current.end }),
      getPaymentTimestamps(ctx.db, {
        merchantId,
        start: current.start,
        end: current.end,
        status: "FAILED",
      }),
    ]);

    const totalAttempts = currentStatusRows.reduce((sum, row) => sum + row.count, 0);
    const failedCount = currentStatusRows.find((row) => row.status === "FAILED")?.count ?? 0;
    const failureRate = rate(failedCount, totalAttempts);

    const baselineTotal = baselineStatusRows.reduce((sum, row) => sum + row.count, 0);
    const baselineFailed = baselineStatusRows.find((row) => row.status === "FAILED")?.count ?? 0;
    const previousFailureRate = rate(baselineFailed, baselineTotal);

    const methodTotals = new Map<string, number>();
    const methodFailed = new Map<string, number>();
    for (const row of methodStatusRows) {
      methodTotals.set(row.method, (methodTotals.get(row.method) ?? 0) + row.count);
      if (row.status === "FAILED") {
        methodFailed.set(row.method, (methodFailed.get(row.method) ?? 0) + row.count);
      }
    }
    const paymentMethods = [...methodTotals.entries()].map(([method, count]) => {
      const failed = methodFailed.get(method) ?? 0;
      return {
        method,
        count,
        failureRate: rate(failed, count),
        shareOfFailures: rate(failed, failedCount),
      };
    });

    const failureReasons = failureCodeRows
      .map((row) => ({
        code: row.errorCode ?? "UNKNOWN",
        count: row.count,
        share: rate(row.count, failedCount),
      }))
      .sort((a, b) => b.count - a.count);

    const hourCounts = new Map<number, number>();
    for (const timestamp of failedTimestamps) {
      const hour = timestamp.getUTCHours();
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }
    const timeDistribution = [...hourCounts.entries()]
      .map(([hourUtc, count]) => ({ hourUtc, count }))
      .sort((a, b) => a.hourUtc - b.hourUtc);

    return {
      totalAttempts,
      failedCount,
      failureRate,
      previousFailureRate,
      failureRateChange: failureRate - previousFailureRate,
      failureReasons,
      paymentMethods,
      timeDistribution,
    };
  },
};
