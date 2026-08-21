import type { Database } from "../client.js";

export interface FailureCodeBreakdownParams {
  merchantId: string;
  start: Date;
  end: Date;
}

export interface FailureCodeRow {
  errorCode: string | null;
  count: number;
}

/** Failed-payment counts grouped by errorCode in a window. Backs
 * `analyze_failure_codes` and the failureReasons field of
 * `get_payment_failures`. */
export async function getFailureCodeBreakdown(
  db: Database,
  params: FailureCodeBreakdownParams,
): Promise<FailureCodeRow[]> {
  const rows = await db.payment.groupBy({
    by: ["errorCode"],
    where: {
      merchantId: params.merchantId,
      razorpayCreatedAt: { gte: params.start, lt: params.end },
      status: "FAILED",
    },
    _count: true,
  });
  return rows.map((row) => ({ errorCode: row.errorCode, count: row._count }));
}
