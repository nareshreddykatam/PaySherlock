import type { NormalizedPayment, NormalizedRefund } from "@paysherlock/types";
import { vi } from "vitest";

/**
 * Minimal stand-in for a Prisma `Database` client, stubbing only the model
 * delegate methods our query/upsert functions actually call. Using a mock
 * here (rather than a live Postgres) is a deliberate Phase 1 choice — see
 * docs/decisions for the rationale.
 *
 * Typed as `any`: Prisma's generated delegate types are too rich (and too
 * generic) to intersect cleanly with vitest's `Mock` type, and a properly
 * mapped mock type isn't worth the complexity for a Phase 1 test fixture.
 * The trade-off is deliberate — this file, not production code.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockDb(): any {
  return {
    merchant: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    order: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    payment: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    refund: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    paymentEvent: {
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    issue: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

export const normalizedPaymentFixture: NormalizedPayment = {
  provider: "razorpay",
  providerPaymentId: "pay_test123",
  providerOrderId: "order_test123",
  amount: 50000,
  amountRefunded: 0,
  currency: "INR",
  status: "captured",
  method: "upi",
  captured: true,
  international: false,
  email: "test@example.com",
  contact: "+911234567890",
  errorCode: null,
  errorDescription: null,
  notes: null,
  createdAt: new Date("2026-01-01T10:00:00Z"),
  raw: { id: "pay_test123", entity: "payment" },
};

export const normalizedRefundFixture: NormalizedRefund = {
  provider: "razorpay",
  providerRefundId: "rfnd_test123",
  providerPaymentId: "pay_test123",
  amount: 50000,
  currency: "INR",
  status: "processed",
  speedProcessed: "normal",
  speedRequested: "optimum",
  notes: null,
  createdAt: new Date("2026-01-02T10:00:00Z"),
  raw: { id: "rfnd_test123", entity: "refund" },
};
