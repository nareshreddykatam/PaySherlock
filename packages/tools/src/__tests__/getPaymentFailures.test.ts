import { describe, expect, it } from "vitest";
import { getPaymentFailuresTool } from "../definitions/getPaymentFailures.js";
import { createMockDb, createToolContext } from "./fixtures.js";

describe("get_payment_failures", () => {
  it("computes failure rate, its change vs. baseline, and per-method/reason/hour breakdowns", async () => {
    const db = createMockDb();
    // Two distinct status-only groupBy calls (current, then baseline) plus
    // one method-status call and one errorCode call — mock by call order.
    let statusCall = 0;
    db.payment.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes("errorCode")) {
        return Promise.resolve([{ errorCode: "PAYMENT_DECLINED", _count: 40 }]);
      }
      if (args.by.includes("method")) {
        return Promise.resolve([
          { method: "UPI", status: "CAPTURED", _count: 90, _sum: { amount: 900000 } },
          { method: "UPI", status: "FAILED", _count: 35, _sum: { amount: 350000 } },
          { method: "CARD", status: "CAPTURED", _count: 60, _sum: { amount: 600000 } },
          { method: "CARD", status: "FAILED", _count: 5, _sum: { amount: 50000 } },
        ]);
      }
      statusCall += 1;
      if (statusCall === 1) {
        // current: 150 captured + 40 failed = 190 attempts, 40 failed
        return Promise.resolve([
          { status: "CAPTURED", _count: 150, _sum: { amount: 1500000 } },
          { status: "FAILED", _count: 40, _sum: { amount: 400000 } },
        ]);
      }
      // baseline: 190 captured + 12 failed = 202 attempts, 12 failed
      return Promise.resolve([
        { status: "CAPTURED", _count: 190, _sum: { amount: 1900000 } },
        { status: "FAILED", _count: 12, _sum: { amount: 120000 } },
      ]);
    });
    db.payment.findMany.mockResolvedValue([
      { razorpayCreatedAt: new Date("2026-08-20T10:15:00.000Z") },
      { razorpayCreatedAt: new Date("2026-08-20T10:45:00.000Z") },
      { razorpayCreatedAt: new Date("2026-08-20T11:05:00.000Z") },
    ]);

    const result = await getPaymentFailuresTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db, "merchant-1"),
    );

    expect(result.totalAttempts).toBe(190);
    expect(result.failedCount).toBe(40);
    expect(result.failureRate).toBeCloseTo(40 / 190, 5);
    expect(result.previousFailureRate).toBeCloseTo(12 / 202, 5);
    expect(result.failureRateChange).toBeGreaterThan(0);

    const upi = result.paymentMethods.find((m) => m.method === "UPI")!;
    expect(upi.failureRate).toBeCloseTo(35 / 125, 5);
    expect(upi.shareOfFailures).toBeCloseTo(35 / 40, 5);

    expect(result.failureReasons).toEqual([{ code: "PAYMENT_DECLINED", count: 40, share: 1 }]);
    expect(result.timeDistribution).toEqual([
      { hourUtc: 10, count: 2 },
      { hourUtc: 11, count: 1 },
    ]);
  });

  it("returns zeroed rates (not NaN/throw) when there are no payments at all", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([]);
    db.payment.findMany.mockResolvedValue([]);

    const result = await getPaymentFailuresTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db),
    );

    expect(result.totalAttempts).toBe(0);
    expect(result.failureRate).toBe(0);
    expect(result.previousFailureRate).toBe(0);
    expect(Number.isFinite(result.failureRateChange)).toBe(true);
  });
});
