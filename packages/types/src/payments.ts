import type { MinorUnitAmount } from "./money.js";

// Provider-agnostic normalized shapes produced by adapters (e.g.
// @paysherlock/razorpay) and consumed by @paysherlock/database. Neither the
// database package nor the future agent should need to understand
// Razorpay-specific payload shapes — this is the seam between them.

export type NormalizedOrderStatus = "created" | "attempted" | "paid";
export type NormalizedPaymentStatus = "created" | "authorized" | "captured" | "refunded" | "failed";
export type NormalizedPaymentMethod = "card" | "netbanking" | "wallet" | "upi" | "emi" | "other";
export type NormalizedRefundStatus = "pending" | "processed" | "failed";
export type NormalizedResourceType = "payment" | "order" | "refund";

export interface NormalizedOrder {
  provider: "razorpay";
  providerOrderId: string;
  amount: MinorUnitAmount;
  amountPaid: MinorUnitAmount;
  amountDue: MinorUnitAmount;
  currency: string;
  status: NormalizedOrderStatus;
  receipt: string | null;
  attempts: number;
  notes: Record<string, unknown> | null;
  createdAt: Date;
  raw: unknown;
}

export interface NormalizedPayment {
  provider: "razorpay";
  providerPaymentId: string;
  providerOrderId: string | null;
  amount: MinorUnitAmount;
  amountRefunded: MinorUnitAmount;
  currency: string;
  status: NormalizedPaymentStatus;
  method: NormalizedPaymentMethod;
  captured: boolean;
  international: boolean;
  email: string | null;
  contact: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  notes: Record<string, unknown> | null;
  createdAt: Date;
  raw: unknown;
}

export interface NormalizedRefund {
  provider: "razorpay";
  providerRefundId: string;
  providerPaymentId: string;
  amount: MinorUnitAmount;
  currency: string;
  status: NormalizedRefundStatus;
  speedProcessed: string | null;
  speedRequested: string | null;
  notes: Record<string, unknown> | null;
  createdAt: Date;
  raw: unknown;
}

/// A normalized, provider-agnostic representation of one inbound webhook
/// delivery. `accountId` is the provider's merchant/account identifier when
/// present on the source event (used to resolve our internal Merchant).
export interface NormalizedPaymentEvent {
  provider: "razorpay";
  externalEventId: string;
  eventType: string;
  resourceType: NormalizedResourceType;
  resourceId: string;
  occurredAt: Date;
  accountId: string | null;
  payload: unknown;
  payment?: NormalizedPayment;
  order?: NormalizedOrder;
  refund?: NormalizedRefund;
  /** Set when the envelope named a payment/order/refund entity that failed
   * its schema validation — the entity is deliberately left unattached
   * above rather than upserted from unvalidated data. The caller must
   * treat this as a processing failure (never mark the event PROCESSED). */
  entityValidationError?: string;
}
