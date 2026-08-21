import { z } from "zod";
import { getPaymentAggregate, getRefundAggregate } from "@paysherlock/database";
import type { ToolDefinition } from "../types.js";
import { resolveBaselineWindow, scaleToWindow, toPeriodWindow } from "../timeRange.js";

const InputSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  baselineStartTime: z.string().datetime().optional(),
  baselineEndTime: z.string().datetime().optional(),
});
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  refundCount: z.number().int(),
  refundAmount: z.number().int(),
  refundRate: z.number(),
  baselineRefundCount: z.number().int(),
  baselineRefundAmount: z.number().int(),
  baselineRefundRate: z.number(),
  change: z.object({
    countChange: z.number(),
    amountChange: z.number(),
    rateChange: z.number(),
  }),
});
export type GetRefundsOutput = z.infer<typeof OutputSchema>;
type Output = GetRefundsOutput;

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Tool 6 — refund volume/value vs. a baseline (defaults to the preceding
 * 7 days). refundRate is refund amount as a share of successful payment
 * amount in the same window — a rate, so baseline and current are directly
 * comparable without duration scaling. */
export const getRefundsTool: ToolDefinition<Input, Output> = {
  name: "get_refunds",
  description:
    "Analyze refund volume and value for a time range vs. a baseline (defaults to the preceding " +
    "7 days): refund count, amount, and refund rate (refund amount as a share of successful " +
    "payment amount), plus the change vs. baseline.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const current = toPeriodWindow(input);
    const baseline = resolveBaselineWindow(current, input);
    const merchantId = ctx.merchantId;

    const [currentRefunds, baselineRefunds, currentRevenue, baselineRevenue] = await Promise.all([
      getRefundAggregate(ctx.db, { merchantId, start: current.start, end: current.end }),
      getRefundAggregate(ctx.db, { merchantId, start: baseline.start, end: baseline.end }),
      getPaymentAggregate(ctx.db, {
        merchantId,
        start: current.start,
        end: current.end,
        status: "CAPTURED",
      }),
      getPaymentAggregate(ctx.db, {
        merchantId,
        start: baseline.start,
        end: baseline.end,
        status: "CAPTURED",
      }),
    ]);

    // Rates are already normalized (amount / revenue within the same
    // window) and compare directly. Raw counts/amounts are not — scale the
    // baseline to the current window's duration first, same rationale as
    // compare_periods/calculate_revenue_impact/segment_payments, so a
    // 1-day current window isn't compared against a raw 7-day baseline
    // total. See docs/decisions.
    const refundRate = rate(currentRefunds.amount, currentRevenue.amount);
    const baselineRefundRate = rate(baselineRefunds.amount, baselineRevenue.amount);
    const baselineRefundCount = Math.round(scaleToWindow(baselineRefunds.count, baseline, current));
    const baselineRefundAmount = Math.round(
      scaleToWindow(baselineRefunds.amount, baseline, current),
    );

    return {
      refundCount: currentRefunds.count,
      refundAmount: currentRefunds.amount,
      refundRate,
      baselineRefundCount,
      baselineRefundAmount,
      baselineRefundRate,
      change: {
        countChange: currentRefunds.count - baselineRefundCount,
        amountChange: currentRefunds.amount - baselineRefundAmount,
        rateChange: refundRate - baselineRefundRate,
      },
    };
  },
};
