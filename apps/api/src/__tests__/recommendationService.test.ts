import { describe, expect, it } from "vitest";
import { generateRecommendationForInvestigation } from "../services/recommendationService.js";
import { createMockDb, paymentRowFixture } from "./fixtures.js";

const MERCHANT_ID = paymentRowFixture.merchantId;

const INVESTIGATION_WITH_ROOT_CAUSE = {
  rootCause: "UPI payment failure rate increased significantly",
  summary: "Investigation found a likely cause: UPI payment failure rate increased significantly.",
  meta: { investigationId: "inv_1", stepsExecuted: 8, toolCalls: 8, provider: "deterministic" },
};

const INVESTIGATION_NO_ROOT_CAUSE = {
  rootCause: undefined,
  summary: "No significant anomaly detected in the available data.",
  meta: { investigationId: "inv_2", stepsExecuted: 8, toolCalls: 8, provider: "deterministic" },
};

describe("generateRecommendationForInvestigation", () => {
  it("produces a NO_ACTION recommendation (already SUCCEEDED) when no targetPaymentId was given", async () => {
    const db = createMockDb();
    db.recommendation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: "rec-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: null,
        rejectedAt: null,
        expiresAt: null,
        ...data,
      }),
    );
    db.auditEvent.create.mockResolvedValue({ id: "audit-1" });

    const result = await generateRecommendationForInvestigation(
      { db },
      { merchantId: MERCHANT_ID, investigation: INVESTIGATION_WITH_ROOT_CAUSE },
    );

    expect(result.type).toBe("NO_ACTION");
    expect(result.status).toBe("SUCCEEDED");
    expect(result.targetPaymentId).toBeNull();
  });

  it("produces a PENDING_APPROVAL REFUND_PAYMENT recommendation for a refundable target payment", async () => {
    const db = createMockDb();
    db.payment.findUnique.mockResolvedValue(paymentRowFixture);
    db.recommendation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: "rec-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: null,
        rejectedAt: null,
        ...data,
      }),
    );
    db.auditEvent.create.mockResolvedValue({ id: "audit-1" });

    const result = await generateRecommendationForInvestigation(
      { db },
      {
        merchantId: MERCHANT_ID,
        investigation: INVESTIGATION_WITH_ROOT_CAUSE,
        targetPaymentId: paymentRowFixture.id,
      },
    );

    expect(result.type).toBe("REFUND_PAYMENT");
    expect(result.status).toBe("PENDING_APPROVAL");
    expect(result.amountMinorUnits).toBe(
      paymentRowFixture.amount - paymentRowFixture.amountRefunded,
    );
    expect(result.riskLevel).toBe("MEDIUM");
    expect(result.expiresAt).not.toBeNull();
  });

  it("falls back to NO_ACTION when the investigation found no root cause, even with a target payment", async () => {
    const db = createMockDb();
    db.payment.findUnique.mockResolvedValue(paymentRowFixture);
    db.recommendation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "rec-1", createdAt: new Date(), updatedAt: new Date(), ...data }),
    );
    db.auditEvent.create.mockResolvedValue({ id: "audit-1" });

    const result = await generateRecommendationForInvestigation(
      { db },
      {
        merchantId: MERCHANT_ID,
        investigation: INVESTIGATION_NO_ROOT_CAUSE,
        targetPaymentId: paymentRowFixture.id,
      },
    );

    expect(result.type).toBe("NO_ACTION");
  });

  it("falls back to NO_ACTION when the target payment does not belong to this merchant", async () => {
    const db = createMockDb();
    db.payment.findUnique.mockResolvedValue({
      ...paymentRowFixture,
      merchantId: "different-merchant",
    });
    db.recommendation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "rec-1", createdAt: new Date(), updatedAt: new Date(), ...data }),
    );
    db.auditEvent.create.mockResolvedValue({ id: "audit-1" });

    const result = await generateRecommendationForInvestigation(
      { db },
      {
        merchantId: MERCHANT_ID,
        investigation: INVESTIGATION_WITH_ROOT_CAUSE,
        targetPaymentId: paymentRowFixture.id,
      },
    );

    expect(result.type).toBe("NO_ACTION");
  });

  it("falls back to NO_ACTION when the target payment has already been fully refunded", async () => {
    const db = createMockDb();
    db.payment.findUnique.mockResolvedValue({
      ...paymentRowFixture,
      amountRefunded: paymentRowFixture.amount,
    });
    db.recommendation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "rec-1", createdAt: new Date(), updatedAt: new Date(), ...data }),
    );
    db.auditEvent.create.mockResolvedValue({ id: "audit-1" });

    const result = await generateRecommendationForInvestigation(
      { db },
      {
        merchantId: MERCHANT_ID,
        investigation: INVESTIGATION_WITH_ROOT_CAUSE,
        targetPaymentId: paymentRowFixture.id,
      },
    );

    expect(result.type).toBe("NO_ACTION");
  });
});
