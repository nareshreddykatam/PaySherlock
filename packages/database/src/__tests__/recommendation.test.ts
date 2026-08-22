import { describe, expect, it } from "vitest";
import {
  approveRecommendation,
  beginRecommendationExecution,
  completeRecommendationFailure,
  completeRecommendationSuccess,
  createRecommendation,
  rejectRecommendation,
} from "../upsert/recommendation.js";
import { createMockDb } from "./fixtures.js";

const MERCHANT_ID = "merchant-1";
const RECOMMENDATION_ID = "rec-1";

describe("createRecommendation", () => {
  it("creates a PENDING_APPROVAL row for a financial recommendation", async () => {
    const db = createMockDb();
    db.recommendation.create.mockResolvedValue({ id: RECOMMENDATION_ID });

    await createRecommendation(db, {
      merchantId: MERCHANT_ID,
      type: "REFUND_PAYMENT",
      title: "Refund ₹2,400",
      explanation: "Duplicate payment.",
      riskLevel: "MEDIUM",
      targetPaymentId: "payment-1",
      amountMinorUnits: 240_000,
      currency: "INR",
      initialStatus: "PENDING_APPROVAL",
    });

    expect(db.recommendation.create.mock.calls[0][0].data.status).toBe("PENDING_APPROVAL");
    expect(db.recommendation.create.mock.calls[0][0].data.riskLevel).toBe("MEDIUM");
  });

  it("creates a NO_ACTION row directly in SUCCEEDED status", async () => {
    const db = createMockDb();
    db.recommendation.create.mockResolvedValue({ id: RECOMMENDATION_ID });

    await createRecommendation(db, {
      merchantId: MERCHANT_ID,
      type: "NO_ACTION",
      title: "No action required",
      explanation: "Nothing unusual found.",
      riskLevel: "LOW",
      initialStatus: "SUCCEEDED",
    });

    expect(db.recommendation.create.mock.calls[0][0].data.status).toBe("SUCCEEDED");
    expect(db.recommendation.create.mock.calls[0][0].data.targetPaymentId).toBeNull();
  });
});

describe("approveRecommendation", () => {
  it("transitions PENDING_APPROVAL -> APPROVED via a conditional updateMany", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 1 });
    db.recommendation.findFirst.mockResolvedValue({ id: RECOMMENDATION_ID, status: "APPROVED" });

    const result = await approveRecommendation(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
    });

    expect(result.outcome).toBe("ok");
    const call = db.recommendation.updateMany.mock.calls[0][0];
    expect(call.where.status).toBe("PENDING_APPROVAL");
    expect(call.where.merchantId).toBe(MERCHANT_ID);
    expect(call.data.status).toBe("APPROVED");
  });

  it("reports a conflict (not a crash) when the recommendation was already rejected", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 0 });
    db.recommendation.findFirst.mockResolvedValue({
      id: RECOMMENDATION_ID,
      status: "REJECTED",
      expiresAt: null,
    });

    const result = await approveRecommendation(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
    });
    expect(result.outcome).toBe("conflict");
  });

  it("materializes an expired recommendation as EXPIRED rather than approving it", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 0 });
    db.recommendation.findFirst.mockResolvedValue({
      id: RECOMMENDATION_ID,
      status: "PENDING_APPROVAL",
      expiresAt: new Date(Date.now() - 1000),
    });
    db.recommendation.update.mockResolvedValue({ id: RECOMMENDATION_ID, status: "EXPIRED" });

    const result = await approveRecommendation(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
    });
    expect(result.outcome).toBe("expired");
    expect(db.recommendation.update).toHaveBeenCalledWith({
      where: { id: RECOMMENDATION_ID },
      data: { status: "EXPIRED" },
    });
  });

  it("reports not_found for a nonexistent or cross-merchant id", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 0 });
    db.recommendation.findFirst.mockResolvedValue(null);

    const result = await approveRecommendation(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
    });
    expect(result.outcome).toBe("not_found");
  });

  it("refuses EXPIRED -> APPROVED — an already-expired recommendation stays rejected as a conflict, never silently re-approved", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 0 });
    db.recommendation.findFirst.mockResolvedValue({
      id: RECOMMENDATION_ID,
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await approveRecommendation(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
    });

    expect(result.outcome).toBe("conflict");
    expect(db.recommendation.update).not.toHaveBeenCalled();
  });

  it("refuses SUCCEEDED -> APPROVED — a completed recommendation can never be re-approved", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 0 });
    db.recommendation.findFirst.mockResolvedValue({
      id: RECOMMENDATION_ID,
      status: "SUCCEEDED",
      expiresAt: null,
    });

    const result = await approveRecommendation(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
    });
    expect(result.outcome).toBe("conflict");
  });
});

describe("rejectRecommendation", () => {
  it("transitions PENDING_APPROVAL -> REJECTED", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 1 });
    db.recommendation.findFirst.mockResolvedValue({ id: RECOMMENDATION_ID, status: "REJECTED" });

    const result = await rejectRecommendation(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
    });
    expect(result.outcome).toBe("ok");
    expect(db.recommendation.updateMany.mock.calls[0][0].data.status).toBe("REJECTED");
  });

  it("reports a conflict for an already-approved recommendation", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 0 });
    db.recommendation.findFirst.mockResolvedValue({ id: RECOMMENDATION_ID, status: "APPROVED" });

    const result = await rejectRecommendation(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
    });
    expect(result.outcome).toBe("conflict");
  });
});

describe("beginRecommendationExecution", () => {
  it("transitions APPROVED -> EXECUTING", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 1 });
    db.recommendation.findFirst.mockResolvedValue({ id: RECOMMENDATION_ID, status: "EXECUTING" });

    const result = await beginRecommendationExecution(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
      from: "APPROVED",
    });
    expect(result.outcome).toBe("ok");
    expect(db.recommendation.updateMany.mock.calls[0][0].where.status).toBe("APPROVED");
  });

  it("allows a retry from FAILED -> EXECUTING, reusing the same row", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 1 });
    db.recommendation.findFirst.mockResolvedValue({ id: RECOMMENDATION_ID, status: "EXECUTING" });

    const result = await beginRecommendationExecution(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
      from: "FAILED",
    });
    expect(result.outcome).toBe("ok");
    expect(db.recommendation.updateMany.mock.calls[0][0].where.status).toBe("FAILED");
  });

  it("refuses to re-enter EXECUTING from SUCCEEDED", async () => {
    const db = createMockDb();
    db.recommendation.updateMany.mockResolvedValue({ count: 0 });
    db.recommendation.findFirst.mockResolvedValue({ id: RECOMMENDATION_ID, status: "SUCCEEDED" });

    const result = await beginRecommendationExecution(db, {
      id: RECOMMENDATION_ID,
      merchantId: MERCHANT_ID,
      from: "APPROVED",
    });
    expect(result.outcome).toBe("conflict");
  });
});

describe("completeRecommendationSuccess / completeRecommendationFailure", () => {
  it("marks EXECUTING -> SUCCEEDED", async () => {
    const db = createMockDb();
    db.recommendation.update.mockResolvedValue({ id: RECOMMENDATION_ID, status: "SUCCEEDED" });
    await completeRecommendationSuccess(db, RECOMMENDATION_ID);
    expect(db.recommendation.update).toHaveBeenCalledWith({
      where: { id: RECOMMENDATION_ID },
      data: { status: "SUCCEEDED" },
    });
  });

  it("marks EXECUTING -> FAILED", async () => {
    const db = createMockDb();
    db.recommendation.update.mockResolvedValue({ id: RECOMMENDATION_ID, status: "FAILED" });
    await completeRecommendationFailure(db, RECOMMENDATION_ID);
    expect(db.recommendation.update).toHaveBeenCalledWith({
      where: { id: RECOMMENDATION_ID },
      data: { status: "FAILED" },
    });
  });
});
