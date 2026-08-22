import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import {
  createMockDb,
  noopApproveRecommendation,
  noopGetOverview,
  noopRejectRecommendation,
  noopRetryRecommendation,
  noopRunInvestigation,
} from "./fixtures.js";

const ACTION_ROW = {
  id: "action-1",
  merchantId: "trusted-merchant-1",
  recommendationId: "rec-1",
  type: "REFUND_PAYMENT",
  status: "SUCCEEDED",
  paymentId: "payment-1",
  amountMinorUnits: 240_000,
  currency: "INR",
  idempotencyKey: "paysherlock-refund-rec-1",
  providerReference: "rfnd_test0000000001",
  providerStatus: "processed",
  errorCode: null,
  errorMessage: null,
  createdAt: new Date("2026-08-22T10:00:00Z"),
  approvedAt: new Date("2026-08-22T10:00:00Z"),
  startedAt: new Date("2026-08-22T10:00:01Z"),
  completedAt: new Date("2026-08-22T10:00:02Z"),
  updatedAt: new Date("2026-08-22T10:00:02Z"),
};

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

describe("GET /actions/:id", () => {
  it("derives the merchant server-side and returns the action", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.action.findFirst.mockResolvedValue(ACTION_ROW);
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/actions/action-1" });

    expect(response.statusCode).toBe(200);
    expect(db.action.findFirst).toHaveBeenCalledWith({
      where: { id: "action-1", merchantId: "trusted-merchant-1" },
    });
    expect(response.json().providerReference).toBe("rfnd_test0000000001");
    await app.close();
  });

  it("returns 404 rather than another merchant's action", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.action.findFirst.mockResolvedValue(null);
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/actions/does-not-exist" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
