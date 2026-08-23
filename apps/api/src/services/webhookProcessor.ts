import {
  markPaymentEventFailed,
  markPaymentEventIgnored,
  markPaymentEventProcessed,
  recordPaymentEvent,
  resolveMerchant,
  upsertOrder,
  upsertPayment,
  upsertRefund,
  type Database,
} from "@paysherlock/database";
import {
  assertValidWebhookSignature,
  isSupportedWebhookEvent,
  normalizeWebhookEvent,
  parseWebhookEnvelope,
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
} from "@paysherlock/razorpay";
import { ValidationError } from "@paysherlock/types";

export interface ProcessWebhookParams {
  db: Database;
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  webhookSecret: string;
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

export interface ProcessWebhookResult {
  status: WebhookOutcome;
  eventType: string;
  externalEventId: string;
}

function headerValue(headers: ProcessWebhookParams["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The full inbound webhook pipeline: verify signature → parse → normalize →
 * dedupe/store → (if new + supported) upsert business records. Every step
 * before "store" happens before any business data is touched, per Razorpay's
 * security guidance — an invalid signature or malformed payload never
 * reaches the database layer.
 */
export async function processWebhook(params: ProcessWebhookParams): Promise<ProcessWebhookResult> {
  const { db, rawBody, headers, webhookSecret } = params;

  const signature = headerValue(headers, RAZORPAY_SIGNATURE_HEADER);
  assertValidWebhookSignature(rawBody, signature, webhookSecret);

  const eventId = headerValue(headers, RAZORPAY_EVENT_ID_HEADER);
  if (!eventId) {
    throw new ValidationError(`Missing required "${RAZORPAY_EVENT_ID_HEADER}" header`);
  }

  const envelope = parseWebhookEnvelope(rawBody);
  const normalized = normalizeWebhookEvent(envelope, eventId);

  const merchant = await resolveMerchant(db, { razorpayAccountId: normalized.accountId });

  const { event, isDuplicate } = await recordPaymentEvent(db, {
    externalEventId: normalized.externalEventId,
    eventType: normalized.eventType,
    resourceType: normalized.resourceType,
    resourceId: normalized.resourceId,
    occurredAt: normalized.occurredAt,
    payload: normalized.payload,
  });

  if (isDuplicate) {
    return {
      status: "duplicate",
      eventType: normalized.eventType,
      externalEventId: normalized.externalEventId,
    };
  }

  if (!isSupportedWebhookEvent(normalized.eventType)) {
    await markPaymentEventIgnored(db, event.id);
    return {
      status: "ignored",
      eventType: normalized.eventType,
      externalEventId: normalized.externalEventId,
    };
  }

  try {
    // A named payment/order/refund entity that failed schema validation
    // (see normalizeWebhookEvent) must never be treated as if it simply
    // wasn't present — that would upsert nothing yet still report success.
    // Throwing here reuses the exact same failure path as an upsert error
    // below: recorded, marked FAILED with a safe message, and rethrown so
    // the response is a non-2xx Razorpay will retry.
    if (normalized.entityValidationError) {
      throw new ValidationError(normalized.entityValidationError);
    }
    // Order before payment (payment upsert resolves its orderId relation by
    // looking the order up), refund last (it requires the payment to exist).
    if (normalized.order) {
      await upsertOrder(db, merchant.id, normalized.order);
    }
    if (normalized.payment) {
      await upsertPayment(db, merchant.id, normalized.payment);
    }
    if (normalized.refund) {
      await upsertRefund(db, merchant.id, normalized.refund);
    }
    await markPaymentEventProcessed(db, event.id);
  } catch (error) {
    await markPaymentEventFailed(
      db,
      event.id,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }

  return {
    status: "processed",
    eventType: normalized.eventType,
    externalEventId: normalized.externalEventId,
  };
}
