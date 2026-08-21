import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { createMockDb, paymentRowFixture } from "./fixtures.js";

describe("GET /payments", () => {
  it("returns a normalized page of payments (no raw Razorpay payload leaked)", async () => {
    const db = createMockDb();
    db.payment.findMany.mockResolvedValue([paymentRowFixture]);
    const app = buildServer({ db, webhookSecret: "whsec_test" });

    const response = await app.inject({ method: "GET", url: "/payments" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      razorpayPaymentId: "pay_test0000000001",
      status: "CAPTURED",
      amount: 50000,
    });
    expect(body.data[0].raw).toBeUndefined();
    expect(body.data[0].notes).toBeUndefined();
    await app.close();
  });

  it("rejects an out-of-range limit as a validation error", async () => {
    const app = buildServer({ db: createMockDb(), webhookSecret: "whsec_test" });
    const response = await app.inject({ method: "GET", url: "/payments?limit=500" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});

describe("GET /payments/:id", () => {
  it("looks up by our internal id", async () => {
    const db = createMockDb();
    db.payment.findUnique.mockResolvedValue(paymentRowFixture);
    const app = buildServer({ db, webhookSecret: "whsec_test" });

    const response = await app.inject({ method: "GET", url: "/payments/internal-1" });

    expect(response.statusCode).toBe(200);
    expect(db.payment.findUnique).toHaveBeenCalledWith({ where: { id: "internal-1" } });
    await app.close();
  });

  it("looks up by Razorpay payment id when the id is pay_-prefixed", async () => {
    const db = createMockDb();
    db.payment.findUnique.mockResolvedValue(paymentRowFixture);
    const app = buildServer({ db, webhookSecret: "whsec_test" });

    const response = await app.inject({ method: "GET", url: "/payments/pay_test0000000001" });

    expect(response.statusCode).toBe(200);
    expect(db.payment.findUnique).toHaveBeenCalledWith({
      where: { razorpayPaymentId: "pay_test0000000001" },
    });
    await app.close();
  });

  it("returns 404 with a safe error body for an unknown id", async () => {
    const db = createMockDb();
    db.payment.findUnique.mockResolvedValue(null);
    const app = buildServer({ db, webhookSecret: "whsec_test" });

    const response = await app.inject({ method: "GET", url: "/payments/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "NOT_FOUND", message: expect.stringContaining("does-not-exist") },
    });
    await app.close();
  });
});
