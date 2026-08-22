import {
  ConfigError,
  SignatureVerificationError,
  UpstreamApiError,
  ValidationError,
} from "@paysherlock/types";

export class RazorpayConfigError extends ConfigError {}

/** A non-2xx (or network-level) failure calling the Razorpay API. */
export class RazorpayApiError extends UpstreamApiError {
  readonly status?: number | undefined;
  readonly body?: unknown;

  constructor(message: string, options?: { status?: number; body?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.status = options?.status;
    this.body = options?.body;
  }
}

/** The Razorpay API returned a 2xx response, but its shape didn't match
 * what we expect (unexpected/missing fields). Treated distinctly from
 * RazorpayApiError so callers can tell "Razorpay is down" apart from
 * "Razorpay changed something we haven't adapted to." */
export class RazorpayMalformedResponseError extends UpstreamApiError {}

export class RazorpayWebhookSignatureError extends SignatureVerificationError {}

export class RazorpayWebhookPayloadError extends ValidationError {}

/** Guards against ever sending Razorpay a refund idempotency key that
 * doesn't meet its own documented constraint — a defensive check inside
 * the adapter itself, not just trust in the caller (packages/actions). */
export class RazorpayInvalidIdempotencyKeyError extends ValidationError {}
