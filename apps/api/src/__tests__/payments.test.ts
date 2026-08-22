import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import {
  createMockDb,
  noopApproveRecommendation,
  noopGetOverview,
  noopRejectRecommendation,
  noopRetryRecommendation,
  noopRunInvestigation,
  paymentRowFixture,
} from "./fixtures.js";

function buildApp(db: ReturnType<typeof createMockDb>) {
  return buildServer({
    db,
    webhookSecret: "whsec_test",
    runInvestigation: noopRunInvestigation(),
    getOverview: noopGetOverview(),
    approveRecommendation: noopApproveRecommendation(),
    rejectRecommendation: noopRejectRecommendation(),
    retryRecommendation: noopRetryRecommendation(),
  });
}

describe("GET /payments", () => {
  it("returns a normalized page of payments (no raw Razorpay payload leaked)", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.payment.findMany.mockResolvedValue([paymentRowFixture]);
    const app = buildApp(db);

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

  it("derives the merchant server-side and never trusts a client-supplied merchantId", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.payment.findMany.mockResolvedValue([]);
    const app = buildApp(db);

    await app.inject({ method: "GET", url: "/payments?merchantId=attacker-supplied-id" });

    expect(db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "trusted-merchant-1", status: undefined } }),
    );
    await app.close();
  });

  it("rejects an out-of-range limit as a validation error", async () => {
    const app = buildApp(createMockDb());
    const response = await app.inject({ method: "GET", url: "/payments?limit=500" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});

describe("GET /payments/:id", () => {
  it("looks up by our internal id, scoped to the server-derived merchant", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.payment.findFirst.mockResolvedValue(paymentRowFixture);
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/payments/internal-1" });

    expect(response.statusCode).toBe(200);
    expect(db.payment.findFirst).toHaveBeenCalledWith({
      where: { id: "internal-1", merchantId: "trusted-merchant-1" },
    });
    await app.close();
  });

  it("looks up by Razorpay payment id when the id is pay_-prefixed, scoped to the merchant", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.payment.findFirst.mockResolvedValue(paymentRowFixture);
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/payments/pay_test0000000001" });

    expect(response.statusCode).toBe(200);
    expect(db.payment.findFirst).toHaveBeenCalledWith({
      where: { razorpayPaymentId: "pay_test0000000001", merchantId: "trusted-merchant-1" },
    });
    await app.close();
  });

  it("returns 404 (not another merchant's payment) when the row belongs to a different merchant", async () => {
    // The query is scoped by merchantId, so a cross-merchant id simply
    // never matches — the fake DB layer models that as findFirst
    // returning null, exactly as Postgres would for a WHERE clause that
    // excludes the row.
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.payment.findFirst.mockResolvedValue(null);
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/payments/other-merchants-payment" });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("returns 404 with a safe error body for an unknown id", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.payment.findFirst.mockResolvedValue(null);
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/payments/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "NOT_FOUND", message: expect.stringContaining("does-not-exist") },
    });
    await app.close();
  });
});
