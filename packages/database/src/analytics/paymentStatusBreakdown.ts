import type { Database, PaymentStatus } from "../client.js";

export interface PaymentStatusBreakdownParams {
  merchantId: string;
  start: Date;
  end: Date;
}

export interface PaymentStatusBreakdownRow {
  status: PaymentStatus;
  count: number;
  amount: number;
}

/** Payment counts/amounts grouped by status in a window. Backs both the
 * `get_payments` overview and `get_payment_failures` (failedCount/
 * totalAttempts come from summing these rows). */
export async function getPaymentStatusBreakdown(
  db: Database,
  params: PaymentStatusBreakdownParams,
): Promise<PaymentStatusBreakdownRow[]> {
  const rows = await db.payment.groupBy({
    by: ["status"],
    where: {
      merchantId: params.merchantId,
      razorpayCreatedAt: { gte: params.start, lt: params.end },
    },
    _count: true,
    _sum: { amount: true },
  });
  return rows.map((row) => ({
    status: row.status,
    count: row._count,
    amount: row._sum.amount ?? 0,
  }));
}
