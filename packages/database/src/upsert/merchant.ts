import type { Database } from "../client.js";

/** The one dedicated, isolated demo merchant used by `workers/investigator`'s
 * `demo:seed`/`demo:reset`/`demo:run` scripts and (in DEMO_MODE) `apps/api`'s
 * server-side merchant context — a single shared identifier so both never
 * drift into seeding/resolving two different "demo" merchants. Never a real
 * Razorpay account id (those are always `acc_...`), so this can never
 * collide with a real merchant resolved from a webhook. */
export const DEMO_MERCHANT_MARKER = "demo_merchant";
export const DEMO_MERCHANT_NAME = "PaySherlock Demo Merchant";

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
