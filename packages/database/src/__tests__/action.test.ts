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
    db.action.updateMany.mockResolvedValueOnce({ count: 1 });
    db.action.findUnique.mockResolvedValueOnce({ id: "action-1", status: "EXECUTING" });
    const executing = await markActionExecuting(db, "action-1");
    expect(executing).not.toBeNull();
    expect(db.action.updateMany.mock.calls[0][0].where.status.in).toEqual(["APPROVED", "FAILED"]);
    expect(db.action.updateMany.mock.calls[0][0].data.status).toBe("EXECUTING");

    db.action.updateMany.mockResolvedValueOnce({ count: 1 });
    db.action.findUnique.mockResolvedValueOnce({ id: "action-1", status: "SUCCEEDED" });
    const succeeded = await markActionSucceeded(db, {
      id: "action-1",
      providerReference: "rfnd_test1",
      providerStatus: "processed",
    });
    expect(succeeded).not.toBeNull();
    const succeededCall = db.action.updateMany.mock.calls[1][0];
    expect(succeededCall.where.status).toBe("EXECUTING");
    expect(succeededCall.data.status).toBe("SUCCEEDED");
    expect(succeededCall.data.providerReference).toBe("rfnd_test1");
    expect(succeededCall.data.errorCode).toBeNull();
  });

  it("records a safe error code/message on failure", async () => {
    const db = createMockDb();
    db.action.updateMany.mockResolvedValueOnce({ count: 1 });
    db.action.findUnique.mockResolvedValueOnce({ id: "action-1", status: "FAILED" });

    const failed = await markActionFailed(db, {
      id: "action-1",
      errorCode: "PROVIDER_HTTP_400",
      errorMessage: "Razorpay rejected the refund request",
    });

    expect(failed).not.toBeNull();
    const call = db.action.updateMany.mock.calls[0][0];
    expect(call.where.status).toBe("EXECUTING");
    expect(call.data.status).toBe("FAILED");
    expect(call.data.errorCode).toBe("PROVIDER_HTTP_400");
    expect(call.data.errorMessage).not.toMatch(/at .*:\d+:\d+/); // no stack-trace-shaped content
  });

  it("refuses SUCCEEDED -> EXECUTING — a completed action can never restart", async () => {
    const db = createMockDb();
    db.action.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await markActionExecuting(db, "action-1");

    expect(result).toBeNull();
    expect(db.action.findUnique).not.toHaveBeenCalled();
  });

  it("refuses to mark an action succeeded when it is not EXECUTING", async () => {
    const db = createMockDb();
    db.action.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await markActionSucceeded(db, {
      id: "action-1",
      providerReference: "rfnd_test2",
      providerStatus: "processed",
    });

    expect(result).toBeNull();
  });

  it("refuses to overwrite a SUCCEEDED action with FAILED", async () => {
    const db = createMockDb();
    db.action.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await markActionFailed(db, {
      id: "action-1",
      errorCode: "PROVIDER_HTTP_500",
      errorMessage: "Razorpay returned an unexpected error",
    });

    expect(result).toBeNull();
  });
});
