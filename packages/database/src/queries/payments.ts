import type { Database, Payment, PaymentMethod, PaymentStatus } from "../client.js";
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

/** Foundation for the future agent tool `get_payment_details()`. Scoped by
 * `merchantId` at the query level — never fetch-then-check — so a payment
 * belonging to a different merchant is indistinguishable from "not found". */
export async function getPaymentById(db: Database, id: string, merchantId: string) {
  return db.payment.findFirst({ where: { id, merchantId } });
}

export async function getPaymentByRazorpayId(
  db: Database,
  razorpayPaymentId: string,
  merchantId: string,
) {
  return db.payment.findFirst({ where: { razorpayPaymentId, merchantId } });
}

/** Foundation for the future agent tool `get_payment_failures()`. */
export async function listPaymentFailures(
  db: Database,
  params: Omit<ListPaymentsParams, "status"> = {},
) {
  return listPayments(db, { ...params, status: "FAILED" });
}

export interface ListCapturedPaymentsInWindowParams {
  merchantId: string;
  method: PaymentMethod;
  start: Date;
  end: Date;
}

/** Phase 8 (Track 03 revenue recovery): candidate-generation input — every
 * CAPTURED payment of one method within a detection window, for one
 * merchant. Deterministic ascending order (oldest first, tie-broken by id)
 * so a caller applying batch limits over this list gets the same result on
 * every run. Not paginated — recovery batches are bounded by their own
 * maxCandidates/maxTotalAmount limits, not by this query's page size (see
 * packages/actions' selectRecoveryCandidates). */
export async function listCapturedPaymentsInWindow(
  db: Database,
  params: ListCapturedPaymentsInWindowParams,
): Promise<Payment[]> {
  return db.payment.findMany({
    where: {
      merchantId: params.merchantId,
      method: params.method,
      status: "CAPTURED",
      razorpayCreatedAt: { gte: params.start, lte: params.end },
    },
    orderBy: [{ razorpayCreatedAt: "asc" }, { id: "asc" }],
  });
}
