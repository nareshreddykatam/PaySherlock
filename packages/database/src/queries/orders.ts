import type { Database, OrderStatus } from "../client.js";
import { clampLimit, toPage, type CursorPageParams } from "./pagination.js";

export interface ListOrdersParams extends CursorPageParams {
  merchantId?: string;
  status?: OrderStatus;
}

/** Foundation for the future agent tool `get_orders()`. */
export async function listOrders(db: Database, params: ListOrdersParams = {}) {
  const limit = clampLimit(params.limit);
  const rows = await db.order.findMany({
    where: { merchantId: params.merchantId, status: params.status },
    orderBy: [{ razorpayCreatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  return toPage(rows, limit);
}

export async function getOrderByRazorpayId(db: Database, razorpayOrderId: string) {
  return db.order.findUnique({ where: { razorpayOrderId } });
}
