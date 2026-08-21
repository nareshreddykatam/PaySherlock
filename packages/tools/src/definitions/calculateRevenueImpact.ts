import { z } from "zod";
import { getPaymentAggregate } from "@paysherlock/database";
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
  estimatedImpactMinorUnits: z.number().int(),
  currency: z.literal("INR"),
  basis: z.literal("revenue_delta_vs_scaled_baseline"),
  currentRevenueMinorUnits: z.number().int(),
  baselineRevenueMinorUnits: z.number().int(),
});
export type CalculateRevenueImpactOutput = z.infer<typeof OutputSchema>;
type Output = CalculateRevenueImpactOutput;

/**
 * Tool 7 — deterministic revenue impact estimate. Never LLM-invented: the
 * amount is baseline successful-payment revenue (duration-scaled to the
 * current window) minus current successful-payment revenue. Positive =
 * revenue shortfall vs. what the baseline rate would predict; negative =
 * revenue above baseline.
 */
export const calculateRevenueImpactTool: ToolDefinition<Input, Output> = {
  name: "calculate_revenue_impact",
  description:
    "Estimate the revenue impact (in minor currency units) of an anomaly, as the difference " +
    "between duration-scaled baseline revenue (defaults to the preceding 7 days) and current " +
    "revenue from successful payments. Positive means a revenue shortfall.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const current = toPeriodWindow(input);
    const baseline = resolveBaselineWindow(current, input);
    const merchantId = ctx.merchantId;

    const [currentAgg, baselineAgg] = await Promise.all([
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

    const baselineRevenueScaled = Math.round(scaleToWindow(baselineAgg.amount, baseline, current));
    const estimatedImpactMinorUnits = baselineRevenueScaled - currentAgg.amount;

    return {
      estimatedImpactMinorUnits,
      currency: "INR",
      basis: "revenue_delta_vs_scaled_baseline",
      currentRevenueMinorUnits: currentAgg.amount,
      baselineRevenueMinorUnits: baselineRevenueScaled,
    };
  },
};
