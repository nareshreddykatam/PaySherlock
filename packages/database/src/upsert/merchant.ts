import type { Database } from "../client.js";

export interface ResolveMerchantParams {
  /** Razorpay's `account_id`, when known (e.g. from a webhook payload). */
  razorpayAccountId?: string | null;
  defaultName?: string;
}

/**
 * Resolves the Merchant a record belongs to. PaySherlock is single-tenant
 * for the MVP, but every payment-related row still carries a merchantId so
 * multi-merchant support later doesn't require a data migration.
 */
export async function resolveMerchant(db: Database, params: ResolveMerchantParams = {}) {
  if (params.razorpayAccountId) {
    return db.merchant.upsert({
      where: { razorpayAccountId: params.razorpayAccountId },
      create: {
        razorpayAccountId: params.razorpayAccountId,
        name: params.defaultName ?? params.razorpayAccountId,
      },
      update: {},
    });
  }

  const existingDefault = await db.merchant.findFirst({
    where: { razorpayAccountId: null },
    orderBy: { createdAt: "asc" },
  });
  if (existingDefault) return existingDefault;

  return db.merchant.create({
    data: { name: params.defaultName ?? "Default Merchant" },
  });
}
