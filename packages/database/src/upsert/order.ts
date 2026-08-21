import type { NormalizedOrder } from "@paysherlock/types";
import { Prisma, type Database, type OrderStatus } from "../client.js";
import { toNullableJsonInput } from "../json.js";

const STATUS_MAP: Record<NormalizedOrder["status"], OrderStatus> = {
  created: "CREATED",
  attempted: "ATTEMPTED",
  paid: "PAID",
};

export async function upsertOrder(db: Database, merchantId: string, data: NormalizedOrder) {
  return db.order.upsert({
    where: { razorpayOrderId: data.providerOrderId },
    create: {
      merchantId,
      razorpayOrderId: data.providerOrderId,
      amount: data.amount,
      amountPaid: data.amountPaid,
      amountDue: data.amountDue,
      currency: data.currency,
      status: STATUS_MAP[data.status],
      receipt: data.receipt,
      attempts: data.attempts,
      notes: toNullableJsonInput(data.notes),
      raw: data.raw as Prisma.InputJsonValue,
      razorpayCreatedAt: data.createdAt,
    },
    update: {
      amount: data.amount,
      amountPaid: data.amountPaid,
      amountDue: data.amountDue,
      status: STATUS_MAP[data.status],
      receipt: data.receipt,
      attempts: data.attempts,
      notes: toNullableJsonInput(data.notes),
      raw: data.raw as Prisma.InputJsonValue,
    },
  });
}
