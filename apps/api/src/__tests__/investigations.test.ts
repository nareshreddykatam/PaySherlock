import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import {
  createMockDb,
  noopApproveRecommendation,
  noopGetOverview,
  noopRejectRecommendation,
  noopRetryRecommendation,
} from "./fixtures.js";

const fakeResult = {
  question: "Why did revenue drop?",
  summary: "Likely UPI payment degradation.",
  rootCause: "UPI payment failure rate increased significantly",
  confidence: "high" as const,
  evidence: [],
  rejectedHypotheses: [],
  recommendations: ["Check UPI gateway health."],
  meta: { investigationId: "inv_1", stepsExecuted: 5, toolCalls: 5, provider: "deterministic" },
};

const noActionRecommendationRow = {
  id: "rec_1",
  merchantId: "trusted-merchant-1",
  issueId: null,
  investigationId: "inv_1",
  type: "NO_ACTION",
  title: "No action required",
  explanation: fakeResult.summary,
  riskLevel: "LOW",
  status: "SUCCEEDED",
  targetPaymentId: null,
  amountMinorUnits: null,
  currency: null,
  approvedAt: null,
  rejectedAt: null,
  expiresAt: null,
  createdAt: new Date("2026-08-22T10:00:00Z"),
  updatedAt: new Date("2026-08-22T10:00:00Z"),
};

function buildApp(db: ReturnType<typeof createMockDb>, runInvestigation: ReturnType<typeof vi.fn>) {
  return buildServer({
    db,
    webhookSecret: "whsec_test",
    runInvestigation,
    getOverview: noopGetOverview(),
    approveRecommendation: noopApproveRecommendation(),
    rejectRecommendation: noopRejectRecommendation(),
    retryRecommendation: noopRetryRecommendation(),
  });
}

describe("POST /investigations", () => {
  it("derives the merchant server-side and never trusts a client-supplied merchantId", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.recommendation.create.mockResolvedValue(noActionRecommendationRow);
    db.auditEvent.create.mockResolvedValue({ id: "audit_1" });
    const runInvestigation = vi.fn().mockResolvedValue(fakeResult);
    const app = buildApp(db, runInvestigation);

    const response = await app.inject({
      method: "POST",
      url: "/investigations",
      payload: { question: "Why did revenue drop?", merchantId: "attacker-supplied-merchant" },
    });

    expect(response.statusCode).toBe(200);
    expect(runInvestigation).toHaveBeenCalledWith({
      question: "Why did revenue drop?",
      merchantId: "trusted-merchant-1",
      targetPaymentId: undefined,
    });
    const body = response.json();
    expect(body.rootCause).toBe(fakeResult.rootCause);
    // A recommendation always accompanies a completed investigation — here
    // a NO_ACTION one, since no targetPaymentId was supplied.
    expect(body.recommendation.type).toBe("NO_ACTION");
    expect(body.recommendation.status).toBe("SUCCEEDED");
    await app.close();
  });

  it("rejects a missing/empty question as a validation error", async () => {
    const db = createMockDb();
    const runInvestigation = vi.fn();
    const app = buildApp(db, runInvestigation);

    const response = await app.inject({ method: "POST", url: "/investigations", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(runInvestigation).not.toHaveBeenCalled();
    await app.close();
  });

  it("surfaces an agent failure as a safe 5xx error, not a raw stack trace", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "merchant-1" });
    const runInvestigation = vi.fn().mockRejectedValue(new Error("provider unreachable"));
    const app = buildApp(db, runInvestigation);

    const response = await app.inject({
      method: "POST",
      url: "/investigations",
      payload: { question: "Why did revenue drop?" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    await app.close();
  });

  it("passes a targetPaymentId through to the investigation runner", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.payment.findUnique.mockResolvedValue(null); // payment not found -> falls back to NO_ACTION
    db.recommendation.create.mockResolvedValue(noActionRecommendationRow);
    db.auditEvent.create.mockResolvedValue({ id: "audit_1" });
    const runInvestigation = vi.fn().mockResolvedValue(fakeResult);
    const app = buildApp(db, runInvestigation);

    await app.inject({
      method: "POST",
      url: "/investigations",
      payload: { question: "Why did revenue drop?", targetPaymentId: "payment-1" },
    });

    expect(runInvestigation).toHaveBeenCalledWith({
      question: "Why did revenue drop?",
      merchantId: "trusted-merchant-1",
      targetPaymentId: "payment-1",
    });
    await app.close();
  });
});
