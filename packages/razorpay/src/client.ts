import type { z } from "zod";
import {
  RazorpayApiError,
  RazorpayConfigError,
  RazorpayInvalidIdempotencyKeyError,
  RazorpayMalformedResponseError,
} from "./errors.js";
import {
  RazorpayOrderEntitySchema,
  RazorpayOrderListSchema,
  RazorpayPaymentEntitySchema,
  RazorpayPaymentListSchema,
  RazorpayRefundEntitySchema,
  RazorpayRefundListSchema,
  type RazorpayOrderEntity,
  type RazorpayPaymentEntity,
  type RazorpayRefundEntity,
} from "./schemas.js";

export interface RazorpayClientConfig {
  keyId: string;
  keySecret: string;
  /** Override for tests; defaults to the real Razorpay API. */
  baseUrl?: string;
}

export interface RazorpayListParams {
  count?: number;
  skip?: number;
  /** Unix timestamp (seconds). */
  from?: number;
  /** Unix timestamp (seconds). */
  to?: number;
}

const DEFAULT_BASE_URL = "https://api.razorpay.com/v1";

/** Razorpay's own idempotency-key constraint for the refund endpoints
 * (`X-Refund-Idempotency`): at least 10 characters, alphanumeric plus
 * hyphen/underscore only.
 * https://razorpay.com/docs/api/refunds/normal-refunds-idempotent/ */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Minimal typed REST client for the Razorpay operations PaySherlock
 * actually needs (payments, orders, refunds — read paths only in Phase 1).
 * Credentials never leave this class: callers get typed, validated data,
 * never raw fetch/auth details. See docs/decisions for why this is a small
 * hand-rolled client rather than the official SDK.
 */
export class RazorpayClient {
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly baseUrl: string;

  constructor(config: RazorpayClientConfig) {
    if (!config.keyId || !config.keySecret) {
      throw new RazorpayConfigError("RazorpayClient requires both keyId and keySecret to be set");
    }
    this.keyId = config.keyId;
    this.keySecret = config.keySecret;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.keyId}:${this.keySecret}`, "utf8").toString("base64");
    return `Basic ${token}`;
  }

  private async get<T>(
    path: string,
    schema: z.ZodType<T>,
    params?: RazorpayListParams,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Authorization: this.authHeader(), Accept: "application/json" },
      });
    } catch (cause) {
      throw new RazorpayApiError("Network error calling the Razorpay API", { cause });
    }

    const bodyText = await response.text();

    if (!response.ok) {
      throw new RazorpayApiError(`Razorpay API request failed with status ${response.status}`, {
        status: response.status,
        body: safeJsonParse(bodyText),
      });
    }

    const json = safeJsonParse(bodyText);
    if (json === undefined) {
      throw new RazorpayMalformedResponseError("Razorpay API response was not valid JSON");
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new RazorpayMalformedResponseError(
        "Razorpay API response did not match the expected shape",
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  private async post<T>(
    path: string,
    schema: z.ZodType<T>,
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader(),
          Accept: "application/json",
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new RazorpayApiError("Network error calling the Razorpay API", { cause });
    }

    const bodyText = await response.text();

    if (!response.ok) {
      throw new RazorpayApiError(`Razorpay API request failed with status ${response.status}`, {
        status: response.status,
        body: safeJsonParse(bodyText),
      });
    }

    const json = safeJsonParse(bodyText);
    if (json === undefined) {
      throw new RazorpayMalformedResponseError("Razorpay API response was not valid JSON");
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new RazorpayMalformedResponseError(
        "Razorpay API response did not match the expected shape",
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  readonly payments = {
    fetch: (paymentId: string): Promise<RazorpayPaymentEntity> =>
      this.get(`/payments/${encodeURIComponent(paymentId)}`, RazorpayPaymentEntitySchema),
    list: (params: RazorpayListParams = {}) =>
      this.get(`/payments`, RazorpayPaymentListSchema, params),
  };

  readonly orders = {
    fetch: (orderId: string): Promise<RazorpayOrderEntity> =>
      this.get(`/orders/${encodeURIComponent(orderId)}`, RazorpayOrderEntitySchema),
    list: (params: RazorpayListParams = {}) => this.get(`/orders`, RazorpayOrderListSchema, params),
  };

  readonly refunds = {
    fetch: (refundId: string): Promise<RazorpayRefundEntity> =>
      this.get(`/refunds/${encodeURIComponent(refundId)}`, RazorpayRefundEntitySchema),
    listForPayment: (paymentId: string, params: RazorpayListParams = {}) =>
      this.get(
        `/payments/${encodeURIComponent(paymentId)}/refunds`,
        RazorpayRefundListSchema,
        params,
      ),
    /**
     * The one write operation this client supports (Phase 5's single
     * initial financial action). `idempotencyKey` is mandatory and always
     * caller-supplied — this client never generates one itself, and never
     * retries silently; callers (packages/actions) are responsible for
     * reusing the *same* key across retries of the same logical refund. See
     * docs/decisions.
     */
    create: async (
      paymentId: string,
      body: { amountMinorUnits: number; notes?: Record<string, string>; receipt?: string },
      idempotencyKey: string,
    ): Promise<RazorpayRefundEntity> => {
      if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw new RazorpayInvalidIdempotencyKeyError(
          "Refund idempotency key must be at least 10 characters and contain only letters, digits, hyphens, or underscores",
        );
      }
      return this.post(
        `/payments/${encodeURIComponent(paymentId)}/refund`,
        RazorpayRefundEntitySchema,
        { amount: body.amountMinorUnits, notes: body.notes, receipt: body.receipt },
        { "X-Refund-Idempotency": idempotencyKey },
      );
    },
  };
}
