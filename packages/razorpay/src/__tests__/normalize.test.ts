import { describe, expect, it } from "vitest";
import { parseWebhookEnvelope } from "../webhooks.js";
import { normalizeWebhookEvent } from "../normalize.js";
import { RazorpayWebhookPayloadError } from "../errors.js";
import {
  orderPaidPayload,
  paymentAuthorizedPayload,
  paymentCapturedPayload,
  paymentFailedPayload,
  refundFailedPayload,
  refundProcessedPayload,
} from "../__fixtures__/webhookPayloads.js";

describe("normalizeWebhookEvent", () => {
  it("normalizes a payment.captured event", () => {
    const envelope = parseWebhookEnvelope(JSON.stringify(paymentCapturedPayload));
    const normalized = normalizeWebhookEvent(envelope, "evt_1");

    expect(normalized.externalEventId).toBe("evt_1");
    expect(normalized.eventType).toBe("payment.captured");
    expect(normalized.resourceType).toBe("payment");
    expect(normalized.resourceId).toBe("pay_test0000000001");
    expect(normalized.payment).toMatchObject({
      providerPaymentId: "pay_test0000000001",
      status: "captured",
      method: "upi",
      amount: 50000,
    });
  });

  it("normalizes a payment.failed event with error details preserved", () => {
    const envelope = parseWebhookEnvelope(JSON.stringify(paymentFailedPayload));
    const normalized = normalizeWebhookEvent(envelope, "evt_2");

    expect(normalized.payment?.status).toBe("failed");
    expect(normalized.payment?.errorCode).toBe("BAD_REQUEST_ERROR");
  });

  it("normalizes an order.paid event carrying both order and payment entities", () => {
    const envelope = parseWebhookEnvelope(JSON.stringify(orderPaidPayload));
    const normalized = normalizeWebhookEvent(envelope, "evt_3");

    expect(normalized.resourceType).toBe("order");
    expect(normalized.order).toMatchObject({
      providerOrderId: "order_test0000000001",
      status: "paid",
    });
    expect(normalized.payment).toMatchObject({ providerPaymentId: "pay_test0000000001" });
  });

  it("normalizes refund.processed and refund.failed events", () => {
    const processed = normalizeWebhookEvent(
      parseWebhookEnvelope(JSON.stringify(refundProcessedPayload)),
      "evt_4",
    );
    expect(processed.refund?.status).toBe("processed");

    const failed = normalizeWebhookEvent(
      parseWebhookEnvelope(JSON.stringify(refundFailedPayload)),
      "evt_5",
    );
    expect(failed.refund?.status).toBe("failed");
  });

  it("still normalizes unsupported-but-well-formed event types (caller decides to ignore)", () => {
    const envelope = parseWebhookEnvelope(JSON.stringify(paymentAuthorizedPayload));
    const normalized = normalizeWebhookEvent(envelope, "evt_6");
    expect(normalized.eventType).toBe("payment.authorized");
    expect(normalized.payment?.status).toBe("authorized");
  });

  it("throws when contains references no supported resource", () => {
    const envelope = parseWebhookEnvelope(
      JSON.stringify({
        entity: "event",
        event: "some.other.event",
        contains: ["subscription"],
        payload: { subscription: { entity: { id: "sub_1" } } },
        created_at: 1767000000,
      }),
    );
    expect(() => normalizeWebhookEvent(envelope, "evt_7")).toThrow(RazorpayWebhookPayloadError);
  });
});
