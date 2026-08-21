import type { NormalizedPayment } from "@paysherlock/types";
import { Prisma, type Database, type PaymentMethod, type PaymentStatus } from "../client.js";
import { toNullableJsonInput } from "../json.js";

const STATUS_MAP: Record<NormalizedPayment["status"], PaymentStatus> = {
  created: "CREATED",
  authorized: "AUTHORIZED",
  captured: "CAPTURED",
  refunded: "REFUNDED",
  failed: "FAILED",
};

const METHOD_MAP: Record<NormalizedPayment["method"], PaymentMethod> = {
  card: "CARD",
  netbanking: "NETBANKING",
  wallet: "WALLET",
  upi: "UPI",
  emi: "EMI",
  other: "OTHER",
};

export async function upsertPayment(db: Database, merchantId: string, data: NormalizedPayment) {
  let orderId: string | null = null;
  if (data.providerOrderId) {
    const order = await db.order.findUnique({
      where: { razorpayOrderId: data.providerOrderId },
      select: { id: true },
    });
    orderId = order?.id ?? null;
  }

  return db.payment.upsert({
    where: { razorpayPaymentId: data.providerPaymentId },
    create: {
      merchantId,
      razorpayPaymentId: data.providerPaymentId,
      razorpayOrderId: data.providerOrderId,
      orderId,
      amount: data.amount,
      amountRefunded: data.amountRefunded,
      currency: data.currency,
      status: STATUS_MAP[data.status],
      method: METHOD_MAP[data.method],
      captured: data.captured,
      international: data.international,
      email: data.email,
      contact: data.contact,
      errorCode: data.errorCode,
      errorDescription: data.errorDescription,
      notes: toNullableJsonInput(data.notes),
      raw: data.raw as Prisma.InputJsonValue,
      razorpayCreatedAt: data.createdAt,
    },
    update: {
      orderId,
      amount: data.amount,
      amountRefunded: data.amountRefunded,
      status: STATUS_MAP[data.status],
      method: METHOD_MAP[data.method],
      captured: data.captured,
      errorCode: data.errorCode,
      errorDescription: data.errorDescription,
      notes: toNullableJsonInput(data.notes),
      raw: data.raw as Prisma.InputJsonValue,
    },
  });
}
