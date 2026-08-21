import { Prisma, type Database, type PaymentEvent } from "../client.js";

export interface RecordPaymentEventInput {
  externalEventId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  occurredAt: Date;
  payload: unknown;
  paymentId?: string | null;
}

export interface RecordPaymentEventResult {
  event: PaymentEvent;
  /** True if `externalEventId` had already been recorded — the caller
   * should skip re-applying business-record side effects. */
  isDuplicate: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * Idempotently records a webhook delivery. This is the single source of
 * truth for webhook deduplication: a unique constraint on `externalEventId`
 * (Razorpay's `x-razorpay-event-id`) makes a second delivery of the same
 * event a no-op instead of double-processing it.
 */
export async function recordPaymentEvent(
  db: Database,
  input: RecordPaymentEventInput,
): Promise<RecordPaymentEventResult> {
  try {
    const event = await db.paymentEvent.create({
      data: {
        externalEventId: input.externalEventId,
        eventType: input.eventType,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        occurredAt: input.occurredAt,
        payload: input.payload as Prisma.InputJsonValue,
        paymentId: input.paymentId ?? null,
      },
    });
    return { event, isDuplicate: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT_VIOLATION
    ) {
      const existing = await db.paymentEvent.findUniqueOrThrow({
        where: { externalEventId: input.externalEventId },
      });
      return { event: existing, isDuplicate: true };
    }
    throw error;
  }
}

export async function markPaymentEventProcessed(db: Database, id: string) {
  return db.paymentEvent.update({ where: { id }, data: { processingStatus: "PROCESSED" } });
}

export async function markPaymentEventIgnored(db: Database, id: string) {
  return db.paymentEvent.update({ where: { id }, data: { processingStatus: "IGNORED" } });
}

export async function markPaymentEventFailed(db: Database, id: string, errorMessage: string) {
  return db.paymentEvent.update({
    where: { id },
    data: { processingStatus: "FAILED", errorMessage },
  });
}
