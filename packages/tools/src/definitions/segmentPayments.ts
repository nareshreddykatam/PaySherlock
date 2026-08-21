import { z } from "zod";
import {
  getPaymentAmounts,
  getPaymentMethodStatusBreakdown,
  getPaymentStatusBreakdown,
} from "@paysherlock/database";
import type { ToolDefinition } from "../types.js";
import { scaleToWindow, toPeriodWindow, type PeriodWindow } from "../timeRange.js";
import { bucketAmounts } from "../amountBuckets.js";
import type { Database } from "@paysherlock/database";

const DIMENSIONS = ["method", "status", "amount_bucket"] as const;

const InputSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  dimension: z.enum(DIMENSIONS),
  baselineStartTime: z.string().datetime().optional(),
  baselineEndTime: z.string().datetime().optional(),
});
type Input = z.infer<typeof InputSchema>;

const SegmentSchema = z.object({
  key: z.string(),
  count: z.number().int(),
  amount: z.number().int(),
  failureRate: z.number().optional(),
  baselineCount: z.number().int().optional(),
  baselineAmount: z.number().int().optional(),
  changePercent: z.number().nullable().optional(),
});

const OutputSchema = z.object({
  dimension: z.enum(DIMENSIONS),
  segments: z.array(SegmentSchema),
});
export type SegmentPaymentsOutput = z.infer<typeof OutputSchema>;
type Output = SegmentPaymentsOutput;
type Segment = z.infer<typeof SegmentSchema>;

interface RawSegment {
  key: string;
  count: number;
  amount: number;
  failureRate?: number;
}

async function segmentsByMethod(
  db: Database,
  merchantId: string,
  w: PeriodWindow,
): Promise<RawSegment[]> {
  const rows = await getPaymentMethodStatusBreakdown(db, {
    merchantId,
    start: w.start,
    end: w.end,
  });
  const byMethod = new Map<string, { count: number; amount: number; failed: number }>();
  for (const row of rows) {
    const entry = byMethod.get(row.method) ?? { count: 0, amount: 0, failed: 0 };
    entry.count += row.count;
    entry.amount += row.amount;
    if (row.status === "FAILED") entry.failed += row.count;
    byMethod.set(row.method, entry);
  }
  return [...byMethod.entries()].map(([key, v]) => ({
    key,
    count: v.count,
    amount: v.amount,
    failureRate: v.count > 0 ? v.failed / v.count : 0,
  }));
}

async function segmentsByStatus(
  db: Database,
  merchantId: string,
  w: PeriodWindow,
): Promise<RawSegment[]> {
  const rows = await getPaymentStatusBreakdown(db, { merchantId, start: w.start, end: w.end });
  return rows.map((row) => ({ key: row.status, count: row.count, amount: row.amount }));
}

async function segmentsByAmountBucket(
  db: Database,
  merchantId: string,
  w: PeriodWindow,
): Promise<RawSegment[]> {
  const amounts = await getPaymentAmounts(db, {
    merchantId,
    start: w.start,
    end: w.end,
    status: "CAPTURED",
  });
  const buckets = bucketAmounts(amounts);
  return [...buckets.entries()].map(([key, v]) => ({ key, count: v.count, amount: v.amount }));
}

async function segmentsFor(
  dimension: (typeof DIMENSIONS)[number],
  db: Database,
  merchantId: string,
  window: PeriodWindow,
): Promise<RawSegment[]> {
  switch (dimension) {
    case "method":
      return segmentsByMethod(db, merchantId, window);
    case "status":
      return segmentsByStatus(db, merchantId, window);
    case "amount_bucket":
      return segmentsByAmountBucket(db, merchantId, window);
  }
}

/** Tool 4 — breaks payment metrics down by method, status, or amount
 * bucket, optionally alongside a baseline window for a per-segment
 * change%. All aggregation happens via Prisma groupBy/aggregate + simple
 * arithmetic — no LLM math. */
export const segmentPaymentsTool: ToolDefinition<Input, Output> = {
  name: "segment_payments",
  description:
    "Break payment volume/amount down by a dimension (method, status, or amount_bucket) for a " +
    "time range. Pass baselineStartTime/baselineEndTime to also get each segment's change% vs. " +
    "that baseline.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const current = toPeriodWindow(input);
    const currentSegments = await segmentsFor(input.dimension, ctx.db, ctx.merchantId, current);

    let segments: Segment[] = currentSegments;

    if (input.baselineStartTime && input.baselineEndTime) {
      const baseline = toPeriodWindow({
        startTime: input.baselineStartTime,
        endTime: input.baselineEndTime,
      });
      const baselineSegments = await segmentsFor(input.dimension, ctx.db, ctx.merchantId, baseline);
      const baselineByKey = new Map(baselineSegments.map((s) => [s.key, s]));

      // Baseline totals are scaled to the current window's duration before
      // comparing — otherwise a 1-day current window compared against a
      // 7-day baseline would always look like a huge decline regardless of
      // any real anomaly. Same rationale as compare_periods/
      // calculate_revenue_impact — see docs/decisions.
      segments = currentSegments.map((segment) => {
        const baselineSegment = baselineByKey.get(segment.key);
        const baselineAmount = baselineSegment
          ? Math.round(scaleToWindow(baselineSegment.amount, baseline, current))
          : 0;
        const baselineCount = baselineSegment
          ? Math.round(scaleToWindow(baselineSegment.count, baseline, current))
          : 0;
        return {
          ...segment,
          baselineCount,
          baselineAmount,
          changePercent:
            baselineAmount !== 0 ? (segment.amount - baselineAmount) / baselineAmount : null,
        };
      });
    }

    return { dimension: input.dimension, segments };
  },
};
