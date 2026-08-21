import type { Database, RefundStatus } from "../client.js";
import { clampLimit, toPage, type CursorPageParams } from "./pagination.js";

export interface ListRefundsParams extends CursorPageParams {
  merchantId?: string;
  paymentId?: string;
  status?: RefundStatus;
}

/** Foundation for the future agent tool `get_refunds()`. */
export async function listRefunds(db: Database, params: ListRefundsParams = {}) {
  const limit = clampLimit(params.limit);
  const rows = await db.refund.findMany({
    where: {
      merchantId: params.merchantId,
      paymentId: params.paymentId,
      status: params.status,
    },
    orderBy: [{ razorpayCreatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  return toPage(rows, limit);
}
