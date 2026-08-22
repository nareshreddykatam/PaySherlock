import { describe, expect, it } from "vitest";
import {
  createAction,
  markActionExecuting,
  markActionFailed,
  markActionSucceeded,
} from "../upsert/action.js";
import { createMockDb } from "./fixtures.js";

const MERCHANT_ID = "merchant-1";

describe("createAction", () => {
  it("creates an APPROVED action with the given idempotency key", async () => {
    const db = createMockDb();
    db.action.create.mockResolvedValue({ id: "action-1" });

    await createAction(db, {
      merchantId: MERCHANT_ID,
      recommendationId: "rec-1",
      type: "REFUND_PAYMENT",
      paymentId: "payment-1",
      amountMinorUnits: 240_000,
      currency: "INR",
      idempotencyKey: "paysherlock-refund-action1",
      approvedAt: new Date("2026-08-22T10:00:00Z"),
    });

    const call = db.action.create.mock.calls[0][0].data;
    expect(call.status).toBe("APPROVED");
    expect(call.idempotencyKey).toBe("paysherlock-refund-action1");
    expect(call.recommendationId).toBe("rec-1");
  });
});

describe("markActionExecuting / markActionSucceeded / markActionFailed", () => {
  it("moves through APPROVED -> EXECUTING -> SUCCEEDED with a provider reference", async () => {
    const db = createMockDb();
    db.action.update.mockResolvedValue({ id: "action-1", status: "EXECUTING" });
    await markActionExecuting(db, "action-1");
    expect(db.action.update.mock.calls[0][0].data.status).toBe("EXECUTING");

    db.action.update.mockResolvedValue({ id: "action-1", status: "SUCCEEDED" });
    await markActionSucceeded(db, {
      id: "action-1",
      providerReference: "rfnd_test1",
      providerStatus: "processed",
    });
    const succeededCall = db.action.update.mock.calls[1][0].data;
    expect(succeededCall.status).toBe("SUCCEEDED");
    expect(succeededCall.providerReference).toBe("rfnd_test1");
    expect(succeededCall.errorCode).toBeNull();
  });

  it("records a safe error code/message on failure", async () => {
    const db = createMockDb();
    db.action.update.mockResolvedValue({ id: "action-1", status: "FAILED" });

    await markActionFailed(db, {
      id: "action-1",
      errorCode: "PROVIDER_HTTP_400",
      errorMessage: "Razorpay rejected the refund request",
    });

    const call = db.action.update.mock.calls[0][0].data;
    expect(call.status).toBe("FAILED");
    expect(call.errorCode).toBe("PROVIDER_HTTP_400");
    expect(call.errorMessage).not.toMatch(/at .*:\d+:\d+/); // no stack-trace-shaped content
  });
});
