import { resolveMerchant, upsertOrder, upsertPayment, type Database } from "@paysherlock/database";
import { normalizeOrder, normalizePayment, type RazorpayClient } from "@paysherlock/razorpay";

export interface IngestionDeps {
  db: Database;
  razorpay: RazorpayClient;
}

/**
 * Fetches one order from Razorpay by id and upserts it. Safe to call
 * repeatedly — `upsertOrder` is idempotent on `razorpayOrderId`.
 */
export async function ingestOrderById(deps: IngestionDeps, razorpayOrderId: string) {
  const entity = await deps.razorpay.orders.fetch(razorpayOrderId);
  const merchant = await resolveMerchant(deps.db, {});
  return upsertOrder(deps.db, merchant.id, normalizeOrder(entity));
}

/**
 * Fetches one payment from Razorpay by id and upserts it. Safe to call
 * repeatedly — `upsertPayment` is idempotent on `razorpayPaymentId`.
 */
export async function ingestPaymentById(deps: IngestionDeps, razorpayPaymentId: string) {
  const entity = await deps.razorpay.payments.fetch(razorpayPaymentId);
  const merchant = await resolveMerchant(deps.db, {});
  return upsertPayment(deps.db, merchant.id, normalizePayment(entity));
}

export interface IngestRecentPaymentsParams {
  count?: number;
  from?: number;
  to?: number;
}

/**
 * Fetches a page of recent payments from Razorpay Test Mode and upserts
 * each one. Safe to run repeatedly/on a schedule — every write goes through
 * the same idempotent upsert keyed on the Razorpay payment id, so re-running
 * this never creates duplicates.
 */
export async function ingestRecentPayments(
  deps: IngestionDeps,
  params: IngestRecentPaymentsParams = {},
) {
  const page = await deps.razorpay.payments.list({
    count: params.count ?? 50,
    from: params.from,
    to: params.to,
  });
  const merchant = await resolveMerchant(deps.db, {});

  const results = [];
  for (const entity of page.items) {
    results.push(await upsertPayment(deps.db, merchant.id, normalizePayment(entity)));
  }
  return results;
}
