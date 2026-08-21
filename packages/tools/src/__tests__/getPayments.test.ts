import { describe, expect, it } from "vitest";
import { getPaymentsTool } from "../definitions/getPayments.js";
import { createMockDb, createToolContext } from "./fixtures.js";

describe("get_payments", () => {
  it("scopes the query to the trusted merchant and requested window", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([
      { status: "CAPTURED", _count: 10, _sum: { amount: 100000 } },
      { status: "FAILED", _count: 2, _sum: { amount: 20000 } },
    ]);
    const ctx = createToolContext(db, "merchant-42");

    const result = await getPaymentsTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      ctx,
    );

    expect(db.payment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          merchantId: "merchant-42",
          razorpayCreatedAt: {
            gte: new Date("2026-08-20T00:00:00.000Z"),
            lt: new Date("2026-08-21T00:00:00.000Z"),
          },
        }),
      }),
    );
    expect(result).toEqual({
      startTime: "2026-08-20T00:00:00.000Z",
      endTime: "2026-08-21T00:00:00.000Z",
      currency: "INR",
      totalCount: 12,
      totalAmount: 120000,
      byStatus: [
        { status: "CAPTURED", count: 10, amount: 100000 },
        { status: "FAILED", count: 2, amount: 20000 },
      ],
    });
  });

  it("handles an empty dataset without dividing by zero or throwing", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([]);

    const result = await getPaymentsTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db),
    );

    expect(result.totalCount).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.byStatus).toEqual([]);
  });
});
