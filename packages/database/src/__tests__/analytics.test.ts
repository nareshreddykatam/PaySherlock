import { describe, expect, it } from "vitest";
import { getPaymentAggregate } from "../analytics/paymentAggregate.js";
import { getPaymentStatusBreakdown } from "../analytics/paymentStatusBreakdown.js";
import { getPaymentMethodStatusBreakdown } from "../analytics/paymentMethodStatusBreakdown.js";
import { getFailureCodeBreakdown } from "../analytics/failureCodeBreakdown.js";
import { getPaymentTimestamps } from "../analytics/paymentTimestamps.js";
import { getPaymentAmounts } from "../analytics/paymentAmounts.js";
import { getRefundAggregate } from "../analytics/refundAggregate.js";
import { createMockDb } from "./fixtures.js";

const start = new Date("2026-08-20T00:00:00Z");
const end = new Date("2026-08-21T00:00:00Z");

describe("getPaymentAggregate", () => {
  it("scopes the query to the merchant, window, and optional status", async () => {
    const db = createMockDb();
    db.payment.aggregate.mockResolvedValue({ _count: 42, _sum: { amount: 500000 } });

    const result = await getPaymentAggregate(db, {
      merchantId: "m1",
      start,
      end,
      status: "FAILED",
    });

    expect(result).toEqual({ count: 42, amount: 500000 });
    expect(db.payment.aggregate).toHaveBeenCalledWith({
      where: { merchantId: "m1", razorpayCreatedAt: { gte: start, lt: end }, status: "FAILED" },
      _count: true,
      _sum: { amount: true },
    });
  });

  it("defaults amount to 0 when there are no matching rows", async () => {
    const db = createMockDb();
    db.payment.aggregate.mockResolvedValue({ _count: 0, _sum: { amount: null } });

    const result = await getPaymentAggregate(db, { merchantId: "m1", start, end });

    expect(result).toEqual({ count: 0, amount: 0 });
  });
});

describe("getPaymentStatusBreakdown", () => {
  it("maps groupBy rows into status breakdown entries", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([
      { status: "CAPTURED", _count: 100, _sum: { amount: 1000000 } },
      { status: "FAILED", _count: 20, _sum: { amount: 200000 } },
    ]);

    const rows = await getPaymentStatusBreakdown(db, { merchantId: "m1", start, end });

    expect(rows).toEqual([
      { status: "CAPTURED", count: 100, amount: 1000000 },
      { status: "FAILED", count: 20, amount: 200000 },
    ]);
  });
});

describe("getPaymentMethodStatusBreakdown", () => {
  it("maps groupBy rows keyed by method and status", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([
      { method: "UPI", status: "FAILED", _count: 15, _sum: { amount: 150000 } },
      { method: "CARD", status: "FAILED", _count: 5, _sum: { amount: 50000 } },
    ]);

    const rows = await getPaymentMethodStatusBreakdown(db, { merchantId: "m1", start, end });

    expect(rows).toEqual([
      { method: "UPI", status: "FAILED", count: 15, amount: 150000 },
      { method: "CARD", status: "FAILED", count: 5, amount: 50000 },
    ]);
  });
});

describe("getFailureCodeBreakdown", () => {
  it("groups failed payments by errorCode", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([
      { errorCode: "BAD_REQUEST_ERROR", _count: 12 },
      { errorCode: null, _count: 3 },
    ]);

    const rows = await getFailureCodeBreakdown(db, { merchantId: "m1", start, end });

    expect(rows).toEqual([
      { errorCode: "BAD_REQUEST_ERROR", count: 12 },
      { errorCode: null, count: 3 },
    ]);
    expect(db.payment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "FAILED" }) }),
    );
  });
});

describe("getPaymentTimestamps / getPaymentAmounts", () => {
  it("projects only the requested field, bounded by a limit", async () => {
    const db = createMockDb();
    db.payment.findMany.mockResolvedValue([{ razorpayCreatedAt: start }]);
    const timestamps = await getPaymentTimestamps(db, { merchantId: "m1", start, end });
    expect(timestamps).toEqual([start]);
    expect(db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { razorpayCreatedAt: true }, take: 2000 }),
    );

    db.payment.findMany.mockResolvedValue([{ amount: 12345 }]);
    const amounts = await getPaymentAmounts(db, { merchantId: "m1", start, end, limit: 10 });
    expect(amounts).toEqual([12345]);
    expect(db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { amount: true }, take: 10 }),
    );
  });
});

describe("getRefundAggregate", () => {
  it("scopes to processed refunds in the window", async () => {
    const db = createMockDb();
    db.refund.aggregate.mockResolvedValue({ _count: 7, _sum: { amount: 70000 } });

    const result = await getRefundAggregate(db, { merchantId: "m1", start, end });

    expect(result).toEqual({ count: 7, amount: 70000 });
    expect(db.refund.aggregate).toHaveBeenCalledWith({
      where: { merchantId: "m1", razorpayCreatedAt: { gte: start, lt: end }, status: "PROCESSED" },
      _count: true,
      _sum: { amount: true },
    });
  });
});
