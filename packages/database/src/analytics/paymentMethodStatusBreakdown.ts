import type { Database, PaymentMethod, PaymentStatus } from "../client.js";

export interface PaymentMethodStatusBreakdownParams {
  merchantId: string;
  start: Date;
  end: Date;
}

export interface PaymentMethodStatusRow {
  method: PaymentMethod;
  status: PaymentStatus;
  count: number;
  amount: number;
}

/** Payment counts/amounts grouped by (method, status) in a window. One call
 * serves both `segment_payments(dimension="method")` and the per-method
 * failure-rate breakdown in `get_payment_failures` — callers aggregate the
 * rows in memory rather than issuing separate queries per use case. */
export async function getPaymentMethodStatusBreakdown(
  db: Database,
  params: PaymentMethodStatusBreakdownParams,
): Promise<PaymentMethodStatusRow[]> {
  const rows = await db.payment.groupBy({
    by: ["method", "status"],
    where: {
      merchantId: params.merchantId,
      razorpayCreatedAt: { gte: params.start, lt: params.end },
    },
    _count: true,
    _sum: { amount: true },
  });
  return rows.map((row) => ({
    method: row.method,
    status: row.status,
    count: row._count,
    amount: row._sum.amount ?? 0,
  }));
}
