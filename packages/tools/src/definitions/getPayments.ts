import { z } from "zod";
import { getPaymentStatusBreakdown } from "@paysherlock/database";
import type { ToolDefinition } from "../types.js";
import { toPeriodWindow } from "../timeRange.js";

const InputSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  currency: z.literal("INR"),
  totalCount: z.number().int(),
  totalAmount: z.number().int(),
  byStatus: z.array(
    z.object({ status: z.string(), count: z.number().int(), amount: z.number().int() }),
  ),
});
export type GetPaymentsOutput = z.infer<typeof OutputSchema>;
type Output = GetPaymentsOutput;

/** Tool 1 — normalized payment overview for a merchant/time range. Returns
 * aggregates only, never a raw row dump. */
export const getPaymentsTool: ToolDefinition<Input, Output> = {
  name: "get_payments",
  description:
    "Get an overview of payments for the merchant in a time range: total count/amount and a " +
    "breakdown by status (created/authorized/captured/refunded/failed).",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const window = toPeriodWindow(input);
    const rows = await getPaymentStatusBreakdown(ctx.db, {
      merchantId: ctx.merchantId,
      start: window.start,
      end: window.end,
    });
    return {
      startTime: input.startTime,
      endTime: input.endTime,
      currency: "INR",
      totalCount: rows.reduce((sum, row) => sum + row.count, 0),
      totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
      byStatus: rows.map((row) => ({ status: row.status, count: row.count, amount: row.amount })),
    };
  },
};
