import { z } from "zod";
import { apiFetch } from "./client";

// GET /payments and GET /payments/:id don't have a shared zod contract in
// @paysherlock/types (Phase 1 built them from an ad-hoc mapper — see
// apps/api/src/routes/payments.ts's toPaymentResponse). This schema is a
// new, frontend-owned contract for that exact response shape, not a
// duplicate of an existing one.
export const PaymentSchema = z.object({
  id: z.string(),
  razorpayPaymentId: z.string(),
  orderId: z.string().nullable(),
  amount: z.number(),
  amountRefunded: z.number(),
  currency: z.string(),
  status: z.enum(["CREATED", "AUTHORIZED", "CAPTURED", "REFUNDED", "FAILED"]),
  method: z.enum(["CARD", "NETBANKING", "WALLET", "UPI", "EMI", "OTHER"]),
  captured: z.boolean(),
  international: z.boolean(),
  email: z.string().nullable(),
  contact: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorDescription: z.string().nullable(),
  createdAt: z.string(),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const PaymentsPageSchema = z.object({
  data: z.array(PaymentSchema),
  nextCursor: z.string().nullable(),
});
export type PaymentsPage = z.infer<typeof PaymentsPageSchema>;

export interface GetPaymentsParams {
  cursor?: string;
  limit?: number;
}

export async function getPayments(params: GetPaymentsParams = {}): Promise<PaymentsPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();

  const raw = await apiFetch<unknown>(`/payments${qs ? `?${qs}` : ""}`);
  const parsed = PaymentsPageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The payments service returned an unexpected response shape.");
  }
  return parsed.data;
}

export async function getPayment(id: string): Promise<Payment> {
  const raw = await apiFetch<unknown>(`/payments/${encodeURIComponent(id)}`);
  const parsed = PaymentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The payments service returned an unexpected response shape.");
  }
  return parsed.data;
}
