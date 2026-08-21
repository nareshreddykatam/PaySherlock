import { createHmac, timingSafeEqual } from "node:crypto";
import { RazorpayWebhookEnvelopeSchema, type RazorpayWebhookEnvelope } from "./schemas.js";
import { RazorpayWebhookPayloadError, RazorpayWebhookSignatureError } from "./errors.js";

/** https://razorpay.com/docs/webhooks/validate-test/ */
export const RAZORPAY_SIGNATURE_HEADER = "x-razorpay-signature";
/** Unique per webhook delivery — the basis for idempotent processing.
 * https://razorpay.com/docs/webhooks/faqs/ */
export const RAZORPAY_EVENT_ID_HEADER = "x-razorpay-event-id";

/**
 * Verifies a Razorpay webhook signature per the current documented
 * procedure: HMAC-SHA256 over the *raw* request body, keyed with the
 * webhook secret, compared (constant-time) against the signature header.
 *
 * `rawBody` MUST be the exact bytes Razorpay sent, before any JSON parsing —
 * Razorpay's docs explicitly warn against verifying a re-serialized
 * `JSON.stringify(parsedBody)`, which can differ in key order/whitespace
 * and silently break verification.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expected = Buffer.from(expectedHex, "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Throws RazorpayWebhookSignatureError if the signature doesn't verify. */
export function assertValidWebhookSignature(
  rawBody: string,
  signature: string | undefined | null,
  secret: string,
): void {
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    throw new RazorpayWebhookSignatureError("Razorpay webhook signature verification failed");
  }
}

/**
 * Parses and validates a webhook body. Call this only AFTER
 * `assertValidWebhookSignature` — never act on webhook content before the
 * signature has been checked.
 */
export function parseWebhookEnvelope(rawBody: string): RazorpayWebhookEnvelope {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (cause) {
    throw new RazorpayWebhookPayloadError("Webhook body was not valid JSON", { cause });
  }

  const result = RazorpayWebhookEnvelopeSchema.safeParse(json);
  if (!result.success) {
    throw new RazorpayWebhookPayloadError("Webhook payload did not match the expected shape", {
      cause: result.error,
    });
  }
  return result.data;
}
