import { describe, expect, it } from "vitest";
import { calculateRevenueImpactTool } from "../definitions/calculateRevenueImpact.js";
import { createMockDb, createToolContext } from "./fixtures.js";

describe("calculate_revenue_impact", () => {
  it("computes a positive impact (shortfall) when current revenue is below the scaled baseline", async () => {
    const db = createMockDb();
    db.payment.aggregate
      .mockResolvedValueOnce({ _count: 80, _sum: { amount: 800000 } }) // current (1 day)
      .mockResolvedValueOnce({ _count: 700, _sum: { amount: 7_000_000 } }); // baseline (7 days)

    const result = await calculateRevenueImpactTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db),
    );

    // Baseline scaled to 1 day: 7,000,000 / 7 = 1,000,000. Impact = 1,000,000 - 800,000.
    expect(result.baselineRevenueMinorUnits).toBe(1_000_000);
    expect(result.currentRevenueMinorUnits).toBe(800_000);
    expect(result.estimatedImpactMinorUnits).toBe(200_000);
    expect(result.currency).toBe("INR");
  });

  it("computes a negative impact when current revenue exceeds the scaled baseline", async () => {
    const db = createMockDb();
    db.payment.aggregate
      .mockResolvedValueOnce({ _count: 120, _sum: { amount: 1_200_000 } })
      .mockResolvedValueOnce({ _count: 700, _sum: { amount: 7_000_000 } });

    const result = await calculateRevenueImpactTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db),
    );

    expect(result.estimatedImpactMinorUnits).toBe(-200_000);
  });

  it("is deterministic — never derives the number from model input, only from tool data", async () => {
    const db = createMockDb();
    db.payment.aggregate.mockResolvedValue({ _count: 0, _sum: { amount: 0 } });

    const result = await calculateRevenueImpactTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db),
    );

    expect(result.estimatedImpactMinorUnits).toBe(0);
  });
});
