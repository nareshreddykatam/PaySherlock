import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Prisma } from "@paysherlock/database";
import { buildServer } from "../server.js";
import {
  createMockDb,
  noopApproveRecommendation,
  noopGetOverview,
  noopRejectRecommendation,
  noopRetryRecommendation,
  noopRunInvestigation,
} from "./fixtures.js";

const WEBHOOK_SECRET = "whsec_test_secret";

function sign(body: string, secret = WEBHOOK_SECRET) {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function paymentCapturedBody(overrides: { eventId?: string; paymentId?: string } = {}) {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_test000000000000",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: overrides.paymentId ?? "pay_test0000000009",
          entity: "payment",
          amount: 12300,
          currency: "INR",
          status: "captured",
          order_id: "order_test0000000009",
          method: "card",
          captured: true,
          created_at: 1767000000,
        },
      },
    },
    created_at: 1767000001,
  });
}

// The real shape confirmed against a live Razorpay Test Mode webhook
// delivery: `notes` arrives as an empty array, not `{}` or `null`.
function orderPaidArrayNotesBody() {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_test000000000000",
    event: "order.paid",
    contains: ["payment", "order"],
    payload: {
      payment: {
        entity: {
          id: "pay_test0000000010",
          entity: "payment",
          amount: 10000,
          currency: "INR",
          status: "captured",
          order_id: "order_test0000000010",
          method: "card",
          captured: true,
          notes: [],
          created_at: 1767461836,
        },
      },
      order: {
        entity: {
          id: "order_test0000000010",
          entity: "order",
          amount: 10000,
          amount_paid: 10000,
          amount_due: 0,
          currency: "INR",
          status: "paid",
          notes: [],
          created_at: 1767461802,
        },
      },
    },
    created_at: 1767462096,
  });
}

/** A payment entity with an invalid `status` enum value — genuinely
 * malformed, unrelated to the `notes` shape fix. */
function paymentCapturedInvalidStatusBody(overrides: { eventId?: string } = {}) {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_test000000000000",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: overrides.eventId ?? "pay_test0000000011",
          entity: "payment",
          amount: 10000,
          currency: "INR",
          status: "not_a_real_status",
          method: "card",
          captured: true,
          notes: {},
          created_at: 1767462000,
        },
      },
    },
    created_at: 1767462001,
  });
}

function unsupportedEventBody() {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_test000000000000",
    event: "payment.authorized",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: "pay_unsupported",
          entity: "payment",
          amount: 100,
          currency: "INR",
          status: "authorized",
          method: "card",
          captured: false,
          created_at: 1767000000,
        },
      },
    },
    created_at: 1767000001,
  });
}

function post(app: ReturnType<typeof buildServer>, body: string, headers: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: "/webhooks/razorpay",
    headers: { "content-type": "application/json", ...headers },
    payload: body,
  });
}

describe("POST /webhooks/razorpay", () => {
  it("rejects a request with an invalid signature and never touches the database", async () => {
    const db = createMockDb();
    const app = buildServer({
      db,
      webhookSecret: WEBHOOK_SECRET,
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
    });
    const body = paymentCapturedBody();

    const response = await post(app, body, {
      "x-razorpay-signature": "0".repeat(64),
      "x-razorpay-event-id": "evt_invalid_sig",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SIGNATURE_VERIFICATION_ERROR");
    expect(db.paymentEvent.create).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a malformed (non-JSON) payload before it reaches the handler", async () => {
    const db = createMockDb();
    const app = buildServer({
      db,
      webhookSecret: WEBHOOK_SECRET,
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
    });
    const body = "{not valid json";

    const response = await post(app, body, {
      "x-razorpay-signature": sign(body),
      "x-razorpay-event-id": "evt_malformed",
    });

    expect(response.statusCode).toBe(400);
    expect(db.paymentEvent.create).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts a validly signed supported event and upserts the payment", async () => {
    const db = createMockDb();
    db.merchant.upsert.mockResolvedValue({ id: "merchant-1" });
    db.paymentEvent.create.mockResolvedValue({ id: "pe1" });
    db.order.findUnique.mockResolvedValue(null);
    db.payment.upsert.mockResolvedValue({ id: "internal-payment-1" });
    db.paymentEvent.update.mockResolvedValue({});
    const app = buildServer({
      db,
      webhookSecret: WEBHOOK_SECRET,
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
    });
    const body = paymentCapturedBody();

    const response = await post(app, body, {
      "x-razorpay-signature": sign(body),
      "x-razorpay-event-id": "evt_supported",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: true, status: "processed" });
    expect(db.payment.upsert).toHaveBeenCalledTimes(1);
    expect(db.paymentEvent.update).toHaveBeenCalledWith({
      where: { id: "pe1" },
      data: { processingStatus: "PROCESSED" },
    });
    await app.close();
  });

  it("treats a duplicate x-razorpay-event-id as already processed, without re-upserting", async () => {
    const db = createMockDb();
    db.merchant.upsert.mockResolvedValue({ id: "merchant-1" });
    const duplicateError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.1.0",
    });
    db.paymentEvent.create.mockRejectedValue(duplicateError);
    db.paymentEvent.findUniqueOrThrow.mockResolvedValue({
      id: "pe1",
      processingStatus: "PROCESSED",
    });
    const app = buildServer({
      db,
      webhookSecret: WEBHOOK_SECRET,
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
    });
    const body = paymentCapturedBody({ eventId: "evt_dup" });

    const response = await post(app, body, {
      "x-razorpay-signature": sign(body),
      "x-razorpay-event-id": "evt_dup",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "duplicate" });
    expect(db.payment.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it("acknowledges but does not process an unsupported event type", async () => {
    const db = createMockDb();
    db.merchant.upsert.mockResolvedValue({ id: "merchant-1" });
    db.paymentEvent.create.mockResolvedValue({ id: "pe2" });
    db.paymentEvent.update.mockResolvedValue({});
    const app = buildServer({
      db,
      webhookSecret: WEBHOOK_SECRET,
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
    });
    const body = unsupportedEventBody();

    const response = await post(app, body, {
      "x-razorpay-signature": sign(body),
      "x-razorpay-event-id": "evt_unsupported",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ignored" });
    expect(db.payment.upsert).not.toHaveBeenCalled();
    expect(db.paymentEvent.update).toHaveBeenCalledWith({
      where: { id: "pe2" },
      data: { processingStatus: "IGNORED" },
    });
    await app.close();
  });

  // Regression coverage for the live Test Mode finding: Razorpay's real
  // `"notes": []` shape must persist correctly end to end, and a genuinely
  // malformed entity must never be marked PROCESSED.
  describe("live Test Mode regression: notes: [] and silent-success elimination", () => {
    it("persists both the order and the payment from an order.paid event with notes: []", async () => {
      const db = createMockDb();
      db.merchant.upsert.mockResolvedValue({ id: "merchant-1" });
      db.paymentEvent.create.mockResolvedValue({ id: "pe_notes_array" });
      db.order.upsert.mockResolvedValue({ id: "internal-order-1" });
      db.order.findUnique.mockResolvedValue({ id: "internal-order-1" });
      db.payment.upsert.mockResolvedValue({ id: "internal-payment-1" });
      db.paymentEvent.update.mockResolvedValue({});
      const app = buildServer({
        db,
        webhookSecret: WEBHOOK_SECRET,
        runInvestigation: noopRunInvestigation(),
        getOverview: noopGetOverview(),
        approveRecommendation: noopApproveRecommendation(),
        rejectRecommendation: noopRejectRecommendation(),
        retryRecommendation: noopRetryRecommendation(),
      });
      const body = orderPaidArrayNotesBody();

      const response = await post(app, body, {
        "x-razorpay-signature": sign(body),
        "x-razorpay-event-id": "evt_notes_array",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ received: true, status: "processed" });
      expect(db.order.upsert).toHaveBeenCalledTimes(1);
      expect(db.payment.upsert).toHaveBeenCalledTimes(1);
      // The persisted notes must be the normalized internal shape
      // (Prisma's JSON-null sentinel, from a normalized `null`), never the
      // raw array Razorpay sent.
      expect(db.order.upsert.mock.calls[0][0].create.notes).toEqual(Prisma.JsonNull);
      expect(db.payment.upsert.mock.calls[0][0].create.notes).toEqual(Prisma.JsonNull);
      expect(Array.isArray(db.order.upsert.mock.calls[0][0].create.notes)).toBe(false);
      expect(Array.isArray(db.payment.upsert.mock.calls[0][0].create.notes)).toBe(false);
      expect(db.paymentEvent.update).toHaveBeenCalledWith({
        where: { id: "pe_notes_array" },
        data: { processingStatus: "PROCESSED" },
      });
      await app.close();
    });

    it("marks a genuinely malformed entity FAILED, never PROCESSED, and never upserts", async () => {
      const db = createMockDb();
      db.merchant.upsert.mockResolvedValue({ id: "merchant-1" });
      db.paymentEvent.create.mockResolvedValue({ id: "pe_invalid_status" });
      db.paymentEvent.update.mockResolvedValue({});
      const app = buildServer({
        db,
        webhookSecret: WEBHOOK_SECRET,
        runInvestigation: noopRunInvestigation(),
        getOverview: noopGetOverview(),
        approveRecommendation: noopApproveRecommendation(),
        rejectRecommendation: noopRejectRecommendation(),
        retryRecommendation: noopRetryRecommendation(),
      });
      const body = paymentCapturedInvalidStatusBody();

      const response = await post(app, body, {
        "x-razorpay-signature": sign(body),
        "x-razorpay-event-id": "evt_invalid_status",
      });

      // Never a 2xx "success" for data that was never persisted.
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(db.payment.upsert).not.toHaveBeenCalled();
      expect(db.order.upsert).not.toHaveBeenCalled();
      // Never falsely marked PROCESSED.
      expect(db.paymentEvent.update).not.toHaveBeenCalledWith({
        where: { id: "pe_invalid_status" },
        data: { processingStatus: "PROCESSED" },
      });
      // Recorded as a structured failure via the existing FAILED lifecycle.
      expect(db.paymentEvent.update).toHaveBeenCalledWith({
        where: { id: "pe_invalid_status" },
        data: {
          processingStatus: "FAILED",
          errorMessage: expect.stringContaining("payment"),
        },
      });
      await app.close();
    });

    it("still treats a retried duplicate event id as already-handled, not a fresh attempt", async () => {
      const db = createMockDb();
      db.merchant.upsert.mockResolvedValue({ id: "merchant-1" });
      const duplicateError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.1.0",
      });
      db.paymentEvent.create.mockRejectedValue(duplicateError);
      db.paymentEvent.findUniqueOrThrow.mockResolvedValue({
        id: "pe_notes_array_dup",
        processingStatus: "PROCESSED",
      });
      const app = buildServer({
        db,
        webhookSecret: WEBHOOK_SECRET,
        runInvestigation: noopRunInvestigation(),
        getOverview: noopGetOverview(),
        approveRecommendation: noopApproveRecommendation(),
        rejectRecommendation: noopRejectRecommendation(),
        retryRecommendation: noopRetryRecommendation(),
      });
      const body = orderPaidArrayNotesBody();

      const response = await post(app, body, {
        "x-razorpay-signature": sign(body),
        "x-razorpay-event-id": "evt_notes_array_dup",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "duplicate" });
      expect(db.order.upsert).not.toHaveBeenCalled();
      expect(db.payment.upsert).not.toHaveBeenCalled();
      await app.close();
    });
  });

  it("rejects a request missing the event-id header, needed for idempotency", async () => {
    const db = createMockDb();
    const app = buildServer({
      db,
      webhookSecret: WEBHOOK_SECRET,
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
    });
    const body = paymentCapturedBody();

    const response = await post(app, body, { "x-razorpay-signature": sign(body) });

    expect(response.statusCode).toBe(400);
    expect(db.paymentEvent.create).not.toHaveBeenCalled();
    await app.close();
  });
});
