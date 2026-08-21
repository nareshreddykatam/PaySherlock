import { describe, expect, it } from "vitest";
import { segmentPaymentsTool } from "../definitions/segmentPayments.js";
import { createMockDb, createToolContext } from "./fixtures.js";

describe("segment_payments", () => {
  it("segments by method", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([
      { method: "UPI", status: "CAPTURED", _count: 80, _sum: { amount: 800000 } },
      { method: "UPI", status: "FAILED", _count: 20, _sum: { amount: 200000 } },
      { method: "CARD", status: "CAPTURED", _count: 50, _sum: { amount: 500000 } },
    ]);

    const result = await segmentPaymentsTool.handler(
      {
        startTime: "2026-08-20T00:00:00.000Z",
        endTime: "2026-08-21T00:00:00.000Z",
        dimension: "method",
      },
      createToolContext(db),
    );

    const upi = result.segments.find((s) => s.key === "UPI")!;
    expect(upi.count).toBe(100);
    expect(upi.amount).toBe(1000000);
    expect(upi.failureRate).toBeCloseTo(0.2, 5);
  });

  it("segments by amount bucket using only successful payments", async () => {
    const db = createMockDb();
    db.payment.findMany.mockResolvedValue([
      { amount: 5000 },
      { amount: 300000 },
      { amount: 1500000 },
    ]);

    const result = await segmentPaymentsTool.handler(
      {
        startTime: "2026-08-20T00:00:00.000Z",
        endTime: "2026-08-21T00:00:00.000Z",
        dimension: "amount_bucket",
      },
      createToolContext(db),
    );

    expect(db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "CAPTURED" }) }),
    );
    const nonEmpty = result.segments.filter((s) => s.count > 0);
    expect(nonEmpty).toHaveLength(3);
    expect(nonEmpty.reduce((sum, s) => sum + s.count, 0)).toBe(3);
  });

  it("computes changePercent per segment, scaling a baseline of a different duration", async () => {
    const db = createMockDb();
    db.payment.groupBy
      .mockResolvedValueOnce([{ status: "CAPTURED", _count: 40, _sum: { amount: 400000 } }])
      // Baseline is 7x the current window's duration — scaled down to 1
      // day, this baseline amount should read as 1,000,000 / 7 ≈ 142,857.
      .mockResolvedValueOnce([{ status: "CAPTURED", _count: 700, _sum: { amount: 1000000 * 7 } }]);

    const result = await segmentPaymentsTool.handler(
      {
        startTime: "2026-08-20T00:00:00.000Z",
        endTime: "2026-08-21T00:00:00.000Z",
        dimension: "status",
        baselineStartTime: "2026-08-13T00:00:00.000Z",
        baselineEndTime: "2026-08-20T00:00:00.000Z",
      },
      createToolContext(db),
    );

    const captured = result.segments.find((s) => s.key === "CAPTURED")!;
    const scaledBaseline = (1000000 * 7) / 7; // = 1,000,000
    expect(captured.baselineAmount).toBe(scaledBaseline);
    expect(captured.changePercent).toBeCloseTo((400000 - scaledBaseline) / scaledBaseline, 5);
  });
});
