import type { Database, PaymentStatus } from "../client.js";

export interface PaymentAmountsParams {
  merchantId: string;
  start: Date;
  end: Date;
  status?: PaymentStatus;
  /** See paymentTimestamps.ts — same bounded-projection rationale. */
  limit?: number;
}

const DEFAULT_LIMIT = 2000;

/** Just the amounts of payments in a window — the minimal projection
 * needed to bucket by amount range in memory. */
export async function getPaymentAmounts(
  db: Database,
  params: PaymentAmountsParams,
): Promise<number[]> {
  const rows = await db.payment.findMany({
    where: {
      merchantId: params.merchantId,
      razorpayCreatedAt: { gte: params.start, lt: params.end },
      status: params.status,
    },
    select: { amount: true },
    take: params.limit ?? DEFAULT_LIMIT,
  });
  return rows.map((row: { amount: number }) => row.amount);
}
