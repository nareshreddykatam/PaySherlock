import { z } from "zod";
import { getFailureCodeBreakdown } from "@paysherlock/database";
import type { ToolDefinition } from "../types.js";
import { toPeriodWindow } from "../timeRange.js";

const InputSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  limit: z.number().int().min(1).max(20).optional(),
});
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  totalFailures: z.number().int(),
  codes: z.array(z.object({ code: z.string(), count: z.number().int(), share: z.number() })),
});
export type AnalyzeFailureCodesOutput = z.infer<typeof OutputSchema>;
type Output = AnalyzeFailureCodesOutput;

const DEFAULT_LIMIT = 10;

/** Tool 5 — which failure reason codes contribute most to failed payments,
 * ranked by share of total failures. */
export const analyzeFailureCodesTool: ToolDefinition<Input, Output> = {
  name: "analyze_failure_codes",
  description:
    "Identify which failure reason codes contribute most to payment failures in a time range, " +
    "ranked by share of total failures.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const window = toPeriodWindow(input);
    const rows = await getFailureCodeBreakdown(ctx.db, {
      merchantId: ctx.merchantId,
      start: window.start,
      end: window.end,
    });
    const totalFailures = rows.reduce((sum, row) => sum + row.count, 0);
    const codes = rows
      .map((row) => ({
        code: row.errorCode ?? "UNKNOWN",
        count: row.count,
        share: totalFailures > 0 ? row.count / totalFailures : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, input.limit ?? DEFAULT_LIMIT);

    return { totalFailures, codes };
  },
};
