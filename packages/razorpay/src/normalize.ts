import type {
  NormalizedOrder,
  NormalizedPayment,
  NormalizedPaymentEvent,
  NormalizedPaymentMethod,
  NormalizedRefund,
  NormalizedResourceType,
} from "@paysherlock/types";
import { RazorpayWebhookPayloadError } from "./errors.js";
import {
  RazorpayOrderEntitySchema,
  RazorpayPaymentEntitySchema,
  RazorpayRefundEntitySchema,
  type RazorpayOrderEntity,
  type RazorpayPaymentEntity,
  type RazorpayRefundEntity,
  type RazorpayWebhookEnvelope,
} from "./schemas.js";

const KNOWN_PAYMENT_METHODS = new Set(["card", "netbanking", "wallet", "upi", "emi"]);

function normalizeMethod(method: string): NormalizedPaymentMethod {
  return (KNOWN_PAYMENT_METHODS.has(method) ? method : "other") as NormalizedPaymentMethod;
}

/** Razorpay sends `notes` as an object when notes are attached, but as an
 * empty array (`[]`) when they are not — never as `{}`. The internal
 * typed representation is always `Record<string, unknown> | null`, so an
 * array (which only ever means "no notes" in practice) collapses to
 * `null` here rather than leaking Razorpay's raw shape into typed fields. */
function normalizeNotes(
  notes: Record<string, unknown> | unknown[] | null | undefined,
): Record<string, unknown> | null {
  if (notes == null || Array.isArray(notes)) return null;
  return notes;
}

export function normalizePayment(entity: RazorpayPaymentEntity): NormalizedPayment {
  return {
    provider: "razorpay",
    providerPaymentId: entity.id,
    providerOrderId: entity.order_id ?? null,
    amount: entity.amount,
    amountRefunded: entity.amount_refunded ?? 0,
    currency: entity.currency,
    status: entity.status,
    method: normalizeMethod(entity.method),
    captured: entity.captured,
    international: entity.international ?? false,
    email: entity.email ?? null,
    contact: entity.contact ?? null,
    errorCode: entity.error_code ?? null,
    errorDescription: entity.error_description ?? null,
    notes: normalizeNotes(entity.notes),
    createdAt: new Date(entity.created_at * 1000),
    raw: entity,
  };
}

export function normalizeOrder(entity: RazorpayOrderEntity): NormalizedOrder {
  return {
    provider: "razorpay",
    providerOrderId: entity.id,
    amount: entity.amount,
    amountPaid: entity.amount_paid ?? 0,
    amountDue: entity.amount_due ?? 0,
    currency: entity.currency,
    status: entity.status,
    receipt: entity.receipt ?? null,
    attempts: entity.attempts ?? 0,
    notes: normalizeNotes(entity.notes),
    createdAt: new Date(entity.created_at * 1000),
    raw: entity,
  };
}

export function normalizeRefund(entity: RazorpayRefundEntity): NormalizedRefund {
  return {
    provider: "razorpay",
    providerRefundId: entity.id,
    providerPaymentId: entity.payment_id,
    amount: entity.amount,
    currency: entity.currency,
    status: entity.status,
    speedProcessed: entity.speed_processed ?? null,
    speedRequested: entity.speed_requested ?? null,
    notes: normalizeNotes(entity.notes),
    createdAt: new Date(entity.created_at * 1000),
    raw: entity,
  };
}

const SUPPORTED_RESOURCE_TYPES: readonly NormalizedResourceType[] = ["payment", "order", "refund"];

function isSupportedResourceType(value: string): value is NormalizedResourceType {
  return (SUPPORTED_RESOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * Normalizes a signature-verified webhook envelope into a provider-agnostic
 * event. `eventId` must come from the `x-razorpay-event-id` header (see
 * webhooks.ts) — it becomes the idempotency key when the event is stored.
 *
 * A webhook can carry more than one entity (e.g. `order.paid` carries both
 * an order and a payment); every entity present in `contains` is normalized
 * onto the result so the caller can upsert all of them from one event.
 */
export function normalizeWebhookEvent(
  envelope: RazorpayWebhookEnvelope,
  eventId: string,
): NormalizedPaymentEvent {
  const primaryResource = envelope.contains[0];
  if (!primaryResource || !isSupportedResourceType(primaryResource)) {
    throw new RazorpayWebhookPayloadError(
      `Webhook event "${envelope.event}" does not reference a supported resource type ` +
        `(contains: [${envelope.contains.join(", ")}])`,
    );
  }

  const primaryEnvelope = envelope.payload[primaryResource];
  const primaryEntity = primaryEnvelope?.entity as { id?: unknown } | undefined;
  if (!primaryEntity || typeof primaryEntity.id !== "string") {
    throw new RazorpayWebhookPayloadError(
      `Webhook payload is missing a valid "${primaryResource}" entity`,
    );
  }

  const normalized: NormalizedPaymentEvent = {
    provider: "razorpay",
    externalEventId: eventId,
    eventType: envelope.event,
    resourceType: primaryResource,
    resourceId: primaryEntity.id,
    occurredAt: new Date(envelope.created_at * 1000),
    accountId: envelope.account_id ?? null,
    payload: envelope,
  };

  // A present-but-invalid entity is a distinct condition from an absent
  // one: silently leaving it unattached (as if the envelope simply hadn't
  // named it) would let `webhookProcessor.ts` skip the upsert and still
  // mark the event PROCESSED — a false success. Instead, every validation
  // failure is collected into `entityValidationError`; the caller must
  // check this and treat it as a processing failure, never a no-op.
  const validationErrors: string[] = [];

  const paymentEnvelope = envelope.payload.payment;
  if (paymentEnvelope) {
    const parsed = RazorpayPaymentEntitySchema.safeParse(paymentEnvelope.entity);
    if (parsed.success) {
      normalized.payment = normalizePayment(parsed.data);
    } else {
      validationErrors.push(`"payment" entity failed validation: ${parsed.error.message}`);
    }
  }

  const orderEnvelope = envelope.payload.order;
  if (orderEnvelope) {
    const parsed = RazorpayOrderEntitySchema.safeParse(orderEnvelope.entity);
    if (parsed.success) {
      normalized.order = normalizeOrder(parsed.data);
    } else {
      validationErrors.push(`"order" entity failed validation: ${parsed.error.message}`);
    }
  }

  const refundEnvelope = envelope.payload.refund;
  if (refundEnvelope) {
    const parsed = RazorpayRefundEntitySchema.safeParse(refundEnvelope.entity);
    if (parsed.success) {
      normalized.refund = normalizeRefund(parsed.data);
    } else {
      validationErrors.push(`"refund" entity failed validation: ${parsed.error.message}`);
    }
  }

  if (validationErrors.length > 0) {
    normalized.entityValidationError = validationErrors.join("; ");
  }

  return normalized;
}
