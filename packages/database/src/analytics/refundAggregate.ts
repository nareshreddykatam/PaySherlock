import type { Database } from "../client.js";

export interface RefundAggregateParams {
  merchantId: string;
  start: Date;
  end: Date;
}

export interface RefundAggregateResult {
  count: number;
  amount: number;
}

/** Total processed-refund count/amount in a window. Backs `get_refunds`. */
export async function getRefundAggregate(
  db: Database,
  params: RefundAggregateParams,
): Promise<RefundAggregateResult> {
  const result = await db.refund.aggregate({
    where: {
      merchantId: params.merchantId,
      razorpayCreatedAt: { gte: params.start, lt: params.end },
      status: "PROCESSED",
    },
    _count: true,
    _sum: { amount: true },
  });
  return { count: result._count, amount: result._sum.amount ?? 0 };
}
