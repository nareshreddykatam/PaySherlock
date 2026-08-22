import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { createMockDb, noopGetOverview, noopRunInvestigation } from "./fixtures.js";

const RECOMMENDATION_ROW = {
  id: "rec-1",
  merchantId: "trusted-merchant-1",
  issueId: null,
  investigationId: "inv_1",
  type: "REFUND_PAYMENT",
  title: "Refund ₹2,400",
  explanation: "The payment appears duplicated.",
  riskLevel: "MEDIUM",
  status: "PENDING_APPROVAL",
  targetPaymentId: "payment-1",
  amountMinorUnits: 240_000,
  currency: "INR",
  action: null,
  approvedAt: null,
  rejectedAt: null,
  expiresAt: new Date("2026-08-23T10:00:00Z"),
  createdAt: new Date("2026-08-22T10:00:00Z"),
  updatedAt: new Date("2026-08-22T10:00:00Z"),
};

function buildApp(
  db: ReturnType<typeof createMockDb>,
  overrides: Partial<{
    approveRecommendation: ReturnType<typeof vi.fn>;
    rejectRecommendation: ReturnType<typeof vi.fn>;
    retryRecommendation: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return buildServer({
    db,
    webhookSecret: "whsec_test",
    runInvestigation: noopRunInvestigation(),
    getOverview: noopGetOverview(),
    approveRecommendation: overrides.approveRecommendation ?? vi.fn(),
    rejectRecommendation: overrides.rejectRecommendation ?? vi.fn(),
    retryRecommendation: overrides.retryRecommendation ?? vi.fn(),
  });
}

describe("GET /recommendations", () => {
  it("derives the merchant server-side and returns a normalized page", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.recommendation.findMany.mockResolvedValue([RECOMMENDATION_ROW]);
    const app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/recommendations?merchantId=attacker-supplied",
    });

    expect(response.statusCode).toBe(200);
    expect(db.recommendation.findMany.mock.calls[0][0].where.merchantId).toBe("trusted-merchant-1");
    const body = response.json();
    expect(body.data[0].id).toBe("rec-1");
    expect(body.data[0].expiresAt).toBe("2026-08-23T10:00:00.000Z");
    await app.close();
  });
});

describe("GET /recommendations/:id", () => {
  it("returns 404 for a recommendation belonging to a different merchant", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.recommendation.findFirst.mockResolvedValue(null); // merchant-scoped query found nothing
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/recommendations/rec-999" });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /recommendations/:id/approve", () => {
  it("never accepts merchantId, amount, paymentId, or riskLevel from the request body", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    const approveRecommendation = vi.fn().mockResolvedValue({
      kind: "ok",
      recommendation: { ...RECOMMENDATION_ROW, status: "SUCCEEDED" },
    });
    const app = buildApp(db, { approveRecommendation });

    await app.inject({
      method: "POST",
      url: "/recommendations/rec-1/approve",
      payload: {
        merchantId: "attacker-merchant",
        amountMinorUnits: 999_999_999,
        targetPaymentId: "attacker-chosen-payment",
        riskLevel: "LOW",
      },
    });

    // The service callback receives only {id, merchantId} — id from the
    // URL, merchantId derived server-side. Nothing from the request body
    // reaches it at all.
    expect(approveRecommendation).toHaveBeenCalledWith({
      id: "rec-1",
      merchantId: "trusted-merchant-1",
    });
    await app.close();
  });

  it("returns 409 (not 200) when the recommendation was already processed", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    const approveRecommendation = vi.fn().mockResolvedValue({
      kind: "conflict",
      recommendation: { ...RECOMMENDATION_ROW, status: "REJECTED" },
    });
    const app = buildApp(db, { approveRecommendation });

    const response = await app.inject({ method: "POST", url: "/recommendations/rec-1/approve" });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("returns 409 for an expired recommendation, never approving it", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    const approveRecommendation = vi.fn().mockResolvedValue({
      kind: "expired",
      recommendation: { ...RECOMMENDATION_ROW, status: "EXPIRED" },
    });
    const app = buildApp(db, { approveRecommendation });

    const response = await app.inject({ method: "POST", url: "/recommendations/rec-1/approve" });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("RECOMMENDATION_EXPIRED");
    await app.close();
  });

  it("returns 404 for a nonexistent recommendation id", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    const approveRecommendation = vi.fn().mockResolvedValue({ kind: "not_found" });
    const app = buildApp(db, { approveRecommendation });

    const response = await app.inject({
      method: "POST",
      url: "/recommendations/does-not-exist/approve",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /recommendations/:id/reject", () => {
  it("succeeds for a pending recommendation and calls no provider action", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    const rejectRecommendation = vi.fn().mockResolvedValue({
      kind: "ok",
      recommendation: { ...RECOMMENDATION_ROW, status: "REJECTED" },
    });
    const app = buildApp(db, { rejectRecommendation });

    const response = await app.inject({ method: "POST", url: "/recommendations/rec-1/reject" });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("REJECTED");
    await app.close();
  });

  it("returns 409 when the recommendation is not pending", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    const rejectRecommendation = vi.fn().mockResolvedValue({
      kind: "conflict",
      recommendation: { ...RECOMMENDATION_ROW, status: "SUCCEEDED" },
    });
    const app = buildApp(db, { rejectRecommendation });

    const response = await app.inject({ method: "POST", url: "/recommendations/rec-1/reject" });
    expect(response.statusCode).toBe(409);
    await app.close();
  });
});

describe("POST /recommendations/:id/retry", () => {
  it("returns 409 when the recommendation is not FAILED", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    const retryRecommendation = vi.fn().mockResolvedValue({
      kind: "conflict",
      recommendation: { ...RECOMMENDATION_ROW, status: "SUCCEEDED" },
    });
    const app = buildApp(db, { retryRecommendation });

    const response = await app.inject({ method: "POST", url: "/recommendations/rec-1/retry" });
    expect(response.statusCode).toBe(409);
    await app.close();
  });
});
