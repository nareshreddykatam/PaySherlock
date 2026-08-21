import type { Database, Payment, PaymentStatus } from "../client.js";
import { clampLimit, toPage, type CursorPageParams, type Page } from "./pagination.js";

export interface ListPaymentsParams extends CursorPageParams {
  merchantId?: string;
  status?: PaymentStatus;
}

/** Foundation for the future agent tool `get_payments()`. */
export async function listPayments(
  db: Database,
  params: ListPaymentsParams = {},
): Promise<Page<Payment>> {
  const limit = clampLimit(params.limit);
  const rows = await db.payment.findMany({
    where: { merchantId: params.merchantId, status: params.status },
    orderBy: [{ razorpayCreatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  return toPage(rows, limit);
}

/** Foundation for the future agent tool `get_payment_details()`. */
export async function getPaymentById(db: Database, id: string) {
  return db.payment.findUnique({ where: { id } });
}

export async function getPaymentByRazorpayId(db: Database, razorpayPaymentId: string) {
  return db.payment.findUnique({ where: { razorpayPaymentId } });
}

/** Foundation for the future agent tool `get_payment_failures()`. */
export async function listPaymentFailures(
  db: Database,
  params: Omit<ListPaymentsParams, "status"> = {},
) {
  return listPayments(db, { ...params, status: "FAILED" });
}
