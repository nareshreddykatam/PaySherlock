import { describe, expect, it } from "vitest";
import { getRefundsTool } from "../definitions/getRefunds.js";
import { createMockDb, createToolContext } from "./fixtures.js";

describe("get_refunds", () => {
  it("computes refund rate as a share of successful payment amount, and its change vs. baseline", async () => {
    const db = createMockDb();
    db.refund.aggregate
      .mockResolvedValueOnce({ _count: 9, _sum: { amount: 90000 } }) // current refunds
      .mockResolvedValueOnce({ _count: 2, _sum: { amount: 20000 } }); // baseline refunds
    db.payment.aggregate
      .mockResolvedValueOnce({ _count: 100, _sum: { amount: 1000000 } }) // current revenue
      .mockResolvedValueOnce({ _count: 100, _sum: { amount: 1000000 } }); // baseline revenue

    const result = await getRefundsTool.handler(
      {
        startTime: "2026-08-20T00:00:00.000Z",
        endTime: "2026-08-21T00:00:00.000Z",
        // Equal-length baseline so the duration-scaling applied to
        // count/amount is a no-op (factor 1) and this test can assert on
        // simple arithmetic — scaling itself is covered separately.
        baselineStartTime: "2026-08-19T00:00:00.000Z",
        baselineEndTime: "2026-08-20T00:00:00.000Z",
      },
      createToolContext(db),
    );

    expect(result.refundCount).toBe(9);
    expect(result.refundRate).toBeCloseTo(0.09, 5);
    expect(result.baselineRefundRate).toBeCloseTo(0.02, 5);
    expect(result.change.rateChange).toBeCloseTo(0.07, 5);
    expect(result.change.countChange).toBe(7);
  });

  it("scales a differently-sized baseline's count/amount to the current window before comparing", async () => {
    const db = createMockDb();
    db.refund.aggregate
      .mockResolvedValueOnce({ _count: 9, _sum: { amount: 90000 } }) // current (1 day)
      .mockResolvedValueOnce({ _count: 14, _sum: { amount: 140000 } }); // baseline (7 days)
    db.payment.aggregate.mockResolvedValue({ _count: 100, _sum: { amount: 1000000 } });

    const result = await getRefundsTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db),
    );

    // 14 over 7 days scales to 2/day; 140,000 scales to 20,000/day.
    expect(result.baselineRefundCount).toBe(2);
    expect(result.baselineRefundAmount).toBe(20000);
    expect(result.change.countChange).toBe(7);
  });

  it("handles zero revenue without dividing by zero", async () => {
    const db = createMockDb();
    db.refund.aggregate.mockResolvedValue({ _count: 0, _sum: { amount: null } });
    db.payment.aggregate.mockResolvedValue({ _count: 0, _sum: { amount: null } });

    const result = await getRefundsTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db),
    );

    expect(result.refundRate).toBe(0);
    expect(result.baselineRefundRate).toBe(0);
  });
});
