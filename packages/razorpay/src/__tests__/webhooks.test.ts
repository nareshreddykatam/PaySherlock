import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWebhookEnvelope, verifyWebhookSignature } from "../webhooks.js";
import { RazorpayWebhookPayloadError } from "../errors.js";
import { malformedPayload, paymentCapturedPayload } from "../__fixtures__/webhookPayloads.js";

const SECRET = "whsec_test_secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed raw body", () => {
    const rawBody = JSON.stringify(paymentCapturedPayload);
    const signature = sign(rawBody);
    expect(verifyWebhookSignature(rawBody, signature, SECRET)).toBe(true);
  });

  it("rejects a body that was tampered with after signing", () => {
    const rawBody = JSON.stringify(paymentCapturedPayload);
    const signature = sign(rawBody);
    const tamperedBody = rawBody.replace("50000", "99999");
    expect(verifyWebhookSignature(tamperedBody, signature, SECRET)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = JSON.stringify(paymentCapturedPayload);
    const signature = sign(rawBody, "a-different-secret");
    expect(verifyWebhookSignature(rawBody, signature, SECRET)).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    const rawBody = JSON.stringify(paymentCapturedPayload);
    expect(verifyWebhookSignature(rawBody, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(rawBody, null, SECRET)).toBe(false);
  });
});

describe("parseWebhookEnvelope", () => {
  it("parses a well-formed webhook body", () => {
    const rawBody = JSON.stringify(paymentCapturedPayload);
    const envelope = parseWebhookEnvelope(rawBody);
    expect(envelope.event).toBe("payment.captured");
    expect(envelope.contains).toEqual(["payment"]);
  });

  it("rejects a body that is not valid JSON", () => {
    expect(() => parseWebhookEnvelope("{not json")).toThrow(RazorpayWebhookPayloadError);
  });

  it("rejects a body that doesn't match the expected envelope shape", () => {
    expect(() => parseWebhookEnvelope(JSON.stringify(malformedPayload))).toThrow(
      RazorpayWebhookPayloadError,
    );
  });
});
