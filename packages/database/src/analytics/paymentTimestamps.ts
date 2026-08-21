import type { Database, PaymentStatus } from "../client.js";

export interface PaymentTimestampsParams {
  merchantId: string;
  start: Date;
  end: Date;
  status?: PaymentStatus;
  /** Caps rows returned — this is for in-memory bucketing (e.g. by hour),
   * not for handing raw records to the LLM, so a bound keeps it safe even
   * on a busy merchant/window. */
  limit?: number;
}

const DEFAULT_LIMIT = 2000;

/** Just the timestamps of payments in a window — the minimal projection
 * needed to bucket by hour-of-day in memory (Postgres has no portable,
 * index-friendly "group by hour" without raw SQL, which we're avoiding). */
export async function getPaymentTimestamps(
  db: Database,
  params: PaymentTimestampsParams,
): Promise<Date[]> {
  const rows = await db.payment.findMany({
    where: {
      merchantId: params.merchantId,
      razorpayCreatedAt: { gte: params.start, lt: params.end },
      status: params.status,
    },
    select: { razorpayCreatedAt: true },
    take: params.limit ?? DEFAULT_LIMIT,
  });
  return rows.map((row: { razorpayCreatedAt: Date }) => row.razorpayCreatedAt);
}
