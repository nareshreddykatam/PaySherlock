import { PrismaClient, Prisma } from "@prisma/client";

let singleton: PrismaClient | undefined;

/**
 * Lazily-created singleton for runtime use (apps/api, workers). Query and
 * upsert functions in this package never use this directly — they accept a
 * `Database` client as a parameter so they stay testable without a live
 * Postgres connection.
 */
export function getPrismaClient(): PrismaClient {
  singleton ??= new PrismaClient();
  return singleton;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}

/** Anything query/upsert functions in this package can run against: the
 * full client or an interactive transaction. */
export type Database = PrismaClient | Prisma.TransactionClient;

export { PrismaClient, Prisma } from "@prisma/client";
export type {
  Merchant,
  Order,
  Payment,
  Refund,
  PaymentEvent,
  Settlement,
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  RefundStatus,
  PaymentEventProcessingStatus,
} from "@prisma/client";
