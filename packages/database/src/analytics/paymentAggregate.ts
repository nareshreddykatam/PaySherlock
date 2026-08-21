import type { Database, PaymentStatus } from "../client.js";

export interface PaymentAggregateParams {
  merchantId: string;
  start: Date;
  end: Date;
  status?: PaymentStatus;
}

export interface PaymentAggregateResult {
  count: number;
  amount: number;
}

/** Total count/amount of payments in a window, optionally filtered by
 * status. One Prisma aggregate call — the atomic building block for
 * period comparisons and overview tools. */
export async function getPaymentAggregate(
  db: Database,
  params: PaymentAggregateParams,
): Promise<PaymentAggregateResult> {
  const result = await db.payment.aggregate({
    where: {
      merchantId: params.merchantId,
      razorpayCreatedAt: { gte: params.start, lt: params.end },
      status: params.status,
    },
    _count: true,
    _sum: { amount: true },
  });
  return { count: result._count, amount: result._sum.amount ?? 0 };
}
