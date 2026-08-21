import { z } from "zod";

// Schemas for the subset of Razorpay's documented response/payload fields
// PaySherlock actually uses. `.passthrough()` tolerates additional fields
// Razorpay may add without us having to track every one — see
// docs/decisions for the normalization philosophy.
// Sources: https://razorpay.com/docs/api/payments/fetch-with-id/
//          https://razorpay.com/docs/webhooks/payloads/payments/
//          https://razorpay.com/docs/webhooks/orders/
//          https://razorpay.com/docs/webhooks/payloads/refunds/

export const RazorpayPaymentEntitySchema = z
  .object({
    id: z.string(),
    entity: z.literal("payment"),
    amount: z.number().int(),
    currency: z.string(),
    status: z.enum(["created", "authorized", "captured", "refunded", "failed"]),
    order_id: z.string().nullable().optional(),
    method: z.string(),
    amount_refunded: z.number().int().optional(),
    captured: z.boolean(),
    international: z.boolean().optional(),
    email: z.string().nullable().optional(),
    contact: z.string().nullable().optional(),
    error_code: z.string().nullable().optional(),
    error_description: z.string().nullable().optional(),
    notes: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: z.number().int(),
  })
  .passthrough();

export type RazorpayPaymentEntity = z.infer<typeof RazorpayPaymentEntitySchema>;

export const RazorpayOrderEntitySchema = z
  .object({
    id: z.string(),
    entity: z.literal("order"),
    amount: z.number().int(),
    amount_paid: z.number().int().optional(),
    amount_due: z.number().int().optional(),
    currency: z.string(),
    receipt: z.string().nullable().optional(),
    status: z.enum(["created", "attempted", "paid"]),
    attempts: z.number().int().optional(),
    notes: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: z.number().int(),
  })
  .passthrough();

export type RazorpayOrderEntity = z.infer<typeof RazorpayOrderEntitySchema>;

export const RazorpayRefundEntitySchema = z
  .object({
    id: z.string(),
    entity: z.literal("refund"),
    amount: z.number().int(),
    currency: z.string(),
    payment_id: z.string(),
    status: z.enum(["pending", "processed", "failed"]),
    speed_processed: z.string().nullable().optional(),
    speed_requested: z.string().nullable().optional(),
    notes: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: z.number().int(),
  })
  .passthrough();

export type RazorpayRefundEntity = z.infer<typeof RazorpayRefundEntitySchema>;

function collectionSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      entity: z.literal("collection"),
      count: z.number().int(),
      items: z.array(item),
    })
    .passthrough();
}

export const RazorpayPaymentListSchema = collectionSchema(RazorpayPaymentEntitySchema);
export const RazorpayOrderListSchema = collectionSchema(RazorpayOrderEntitySchema);
export const RazorpayRefundListSchema = collectionSchema(RazorpayRefundEntitySchema);

// --- Webhooks ---------------------------------------------------------------

const WebhookResourceEnvelopeSchema = z
  .object({
    entity: z.record(z.string(), z.unknown()),
  })
  .passthrough();

/** The top-level shape of every Razorpay webhook delivery body.
 * https://razorpay.com/docs/webhooks/payloads/payments/ */
export const RazorpayWebhookEnvelopeSchema = z
  .object({
    entity: z.literal("event"),
    account_id: z.string().nullable().optional(),
    event: z.string(),
    contains: z.array(z.string()),
    payload: z.record(z.string(), WebhookResourceEnvelopeSchema),
    created_at: z.number().int(),
  })
  .passthrough();

export type RazorpayWebhookEnvelope = z.infer<typeof RazorpayWebhookEnvelopeSchema>;
