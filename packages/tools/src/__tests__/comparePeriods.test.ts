import { describe, expect, it } from "vitest";
import { comparePeriodsTool } from "../definitions/comparePeriods.js";
import { createMockDb, createToolContext } from "./fixtures.js";

describe("compare_periods", () => {
  it("scales a count/amount baseline to the current window's duration", async () => {
    const db = createMockDb();
    // Current window: 1 day. Baseline: 7 days (default), total 700 captured.
    // Scaled to 1 day, baseline should read as 100.
    db.payment.aggregate
      .mockResolvedValueOnce({ _count: 80, _sum: { amount: 8_000_000 } }) // current
      .mockResolvedValueOnce({ _count: 700, _sum: { amount: 70_000_000 } }); // baseline (7d)

    const result = await comparePeriodsTool.handler(
      {
        metric: "successful_payment_count",
        startTime: "2026-08-20T00:00:00.000Z",
        endTime: "2026-08-21T00:00:00.000Z",
      },
      createToolContext(db),
    );

    expect(result.currentValue).toBe(80);
    expect(result.baselineValue).toBe(100); // 700 / 7 days scaled to 1 day
    expect(result.absoluteChange).toBe(-20);
    expect(result.percentageChange).toBeCloseTo(-0.2, 5);
  });

  it("does not duration-scale a rate metric (failure_rate)", async () => {
    const db = createMockDb();
    db.payment.groupBy
      .mockResolvedValueOnce([
        { status: "CAPTURED", _count: 90, _sum: { amount: 900000 } },
        { status: "FAILED", _count: 10, _sum: { amount: 100000 } },
      ])
      .mockResolvedValueOnce([
        { status: "CAPTURED", _count: 190, _sum: { amount: 1900000 } },
        { status: "FAILED", _count: 10, _sum: { amount: 100000 } },
      ]);

    const result = await comparePeriodsTool.handler(
      {
        metric: "failure_rate",
        startTime: "2026-08-20T00:00:00.000Z",
        endTime: "2026-08-21T00:00:00.000Z",
      },
      createToolContext(db),
    );

    expect(result.currentValue).toBeCloseTo(0.1, 5);
    expect(result.baselineValue).toBeCloseTo(0.05, 5);
  });

  it("returns a null percentageChange rather than dividing by zero when the baseline is zero", async () => {
    const db = createMockDb();
    db.payment.aggregate
      .mockResolvedValueOnce({ _count: 5, _sum: { amount: 50000 } })
      .mockResolvedValueOnce({ _count: 0, _sum: { amount: null } });

    const result = await comparePeriodsTool.handler(
      {
        metric: "revenue",
        startTime: "2026-08-20T00:00:00.000Z",
        endTime: "2026-08-21T00:00:00.000Z",
      },
      createToolContext(db),
    );

    expect(result.baselineValue).toBe(0);
    expect(result.percentageChange).toBeNull();
  });

  it("uses an explicit baseline window instead of the 7-day default when supplied", async () => {
    const db = createMockDb();
    db.payment.aggregate.mockResolvedValue({ _count: 1, _sum: { amount: 1000 } });

    await comparePeriodsTool.handler(
      {
        metric: "revenue",
        startTime: "2026-08-20T00:00:00.000Z",
        endTime: "2026-08-21T00:00:00.000Z",
        baselineStartTime: "2026-08-19T00:00:00.000Z",
        baselineEndTime: "2026-08-20T00:00:00.000Z",
      },
      createToolContext(db),
    );

    const [, secondCallArgs] = db.payment.aggregate.mock.calls;
    expect(secondCallArgs[0].where.razorpayCreatedAt).toEqual({
      gte: new Date("2026-08-19T00:00:00.000Z"),
      lt: new Date("2026-08-20T00:00:00.000Z"),
    });
  });
});
