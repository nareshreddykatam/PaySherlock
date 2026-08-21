import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Prisma } from "@paysherlock/database";
import { buildServer } from "../server.js";
import { createMockDb, noopRunInvestigation } from "./fixtures.js";

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

  it("rejects a request missing the event-id header, needed for idempotency", async () => {
    const db = createMockDb();
    const app = buildServer({
      db,
      webhookSecret: WEBHOOK_SECRET,
      runInvestigation: noopRunInvestigation(),
    });
    const body = paymentCapturedBody();

    const response = await post(app, body, { "x-razorpay-signature": sign(body) });

    expect(response.statusCode).toBe(400);
    expect(db.paymentEvent.create).not.toHaveBeenCalled();
    await app.close();
  });
});
