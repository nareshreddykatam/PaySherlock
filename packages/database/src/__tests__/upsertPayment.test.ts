import { describe, expect, it } from "vitest";
import { upsertPayment } from "../upsert/payment.js";
import { upsertRefund } from "../upsert/refund.js";
import { createMockDb, normalizedPaymentFixture, normalizedRefundFixture } from "./fixtures.js";

describe("upsertPayment", () => {
  it("resolves the order relation and upserts by razorpayPaymentId", async () => {
    const db = createMockDb();
    db.order.findUnique.mockResolvedValue({ id: "internal-order-1" });
    db.payment.upsert.mockResolvedValue({ id: "internal-payment-1" });

    await upsertPayment(db, "merchant-1", normalizedPaymentFixture);

    expect(db.order.findUnique).toHaveBeenCalledWith({
      where: { razorpayOrderId: "order_test123" },
      select: { id: true },
    });
    const call = db.payment.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ razorpayPaymentId: "pay_test123" });
    expect(call.create.orderId).toBe("internal-order-1");
    expect(call.create.status).toBe("CAPTURED");
    expect(call.create.method).toBe("UPI");
    expect(call.create.amount).toBe(50000);
  });

  it("is safe to run twice for the same razorpayPaymentId (idempotent upsert, no duplicate created)", async () => {
    const db = createMockDb();
    db.order.findUnique.mockResolvedValue(null);
    db.payment.upsert.mockResolvedValue({ id: "internal-payment-1" });

    await upsertPayment(db, "merchant-1", normalizedPaymentFixture);
    await upsertPayment(db, "merchant-1", normalizedPaymentFixture);

    expect(db.payment.upsert).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = db.payment.upsert.mock.calls;
    expect(firstCall[0].where).toEqual(secondCall[0].where);
    expect(firstCall[0].where).toEqual({ razorpayPaymentId: "pay_test123" });
  });

  it("leaves orderId null when the payment has no associated order", async () => {
    const db = createMockDb();
    db.payment.upsert.mockResolvedValue({ id: "internal-payment-1" });

    await upsertPayment(db, "merchant-1", { ...normalizedPaymentFixture, providerOrderId: null });

    expect(db.order.findUnique).not.toHaveBeenCalled();
    expect(db.payment.upsert.mock.calls[0][0].create.orderId).toBeNull();
  });
});

describe("upsertRefund", () => {
  it("throws NotFoundError when the parent payment has not been ingested", async () => {
    const db = createMockDb();
    db.payment.findUnique.mockResolvedValue(null);

    await expect(upsertRefund(db, "merchant-1", normalizedRefundFixture)).rejects.toThrow(
      /has not been ingested yet/,
    );
    expect(db.refund.upsert).not.toHaveBeenCalled();
  });

  it("upserts by razorpayRefundId once the parent payment exists", async () => {
    const db = createMockDb();
    db.payment.findUnique.mockResolvedValue({ id: "internal-payment-1" });
    db.refund.upsert.mockResolvedValue({ id: "internal-refund-1" });

    await upsertRefund(db, "merchant-1", normalizedRefundFixture);

    const call = db.refund.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ razorpayRefundId: "rfnd_test123" });
    expect(call.create.paymentId).toBe("internal-payment-1");
    expect(call.create.status).toBe("PROCESSED");
  });
});
