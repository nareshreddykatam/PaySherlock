import { NotFoundError, type NormalizedRefund } from "@paysherlock/types";
import { Prisma, type Database, type RefundStatus } from "../client.js";
import { toNullableJsonInput } from "../json.js";

const STATUS_MAP: Record<NormalizedRefund["status"], RefundStatus> = {
  pending: "PENDING",
  processed: "PROCESSED",
  failed: "FAILED",
};

/**
 * Upserts a refund. Requires the parent payment to already be ingested
 * (refunds carry a required `paymentId` FK — see docs/decisions for why we
 * don't relax this). If a refund webhook arrives before its payment has
 * been ingested, this throws NotFoundError; the caller should mark that
 * webhook event FAILED so it can be reconciled by re-ingestion rather than
 * silently dropped.
 */
export async function upsertRefund(db: Database, merchantId: string, data: NormalizedRefund) {
  const payment = await db.payment.findUnique({
    where: { razorpayPaymentId: data.providerPaymentId },
    select: { id: true },
  });
  if (!payment) {
    throw new NotFoundError(
      `Cannot upsert refund ${data.providerRefundId}: payment ${data.providerPaymentId} has not been ingested yet`,
    );
  }

  return db.refund.upsert({
    where: { razorpayRefundId: data.providerRefundId },
    create: {
      merchantId,
      razorpayRefundId: data.providerRefundId,
      paymentId: payment.id,
      razorpayPaymentId: data.providerPaymentId,
      amount: data.amount,
      currency: data.currency,
      status: STATUS_MAP[data.status],
      speedProcessed: data.speedProcessed,
      speedRequested: data.speedRequested,
      notes: toNullableJsonInput(data.notes),
      raw: data.raw as Prisma.InputJsonValue,
      razorpayCreatedAt: data.createdAt,
    },
    update: {
      amount: data.amount,
      status: STATUS_MAP[data.status],
      speedProcessed: data.speedProcessed,
      notes: toNullableJsonInput(data.notes),
      raw: data.raw as Prisma.InputJsonValue,
    },
  });
}
