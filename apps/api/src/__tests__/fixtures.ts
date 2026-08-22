import { vi } from "vitest";

/**
 * Minimal stand-in for a Prisma `Database` client, stubbing only the model
 * delegate methods routes/services actually call. See
 * packages/database/src/__tests__/fixtures.ts for why mocks (not a live
 * Postgres) are used in this phase, and why this is typed `any`.
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
      findFirst: vi.fn(),
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
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    recommendation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    action: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

/** Stub for ServerDeps.runInvestigation in tests that don't exercise the
 * /investigations route — a fresh mock per call so call counts never leak
 * between tests. */
export function noopRunInvestigation() {
  return vi.fn();
}

/** Stub for ServerDeps.getOverview in tests that don't exercise the
 * /overview route. */
export function noopGetOverview() {
  return vi.fn();
}

/** Stubs for ServerDeps.{approve,reject,retry}Recommendation in tests that
 * don't exercise the /recommendations approval endpoints. */
export function noopApproveRecommendation() {
  return vi.fn();
}
export function noopRejectRecommendation() {
  return vi.fn();
}
export function noopRetryRecommendation() {
  return vi.fn();
}

export const paymentRowFixture = {
  id: "internal-1",
  merchantId: "merchant-1",
  razorpayPaymentId: "pay_test0000000001",
  orderId: null,
  razorpayOrderId: null,
  amount: 50000,
  amountRefunded: 0,
  currency: "INR",
  status: "CAPTURED",
  method: "UPI",
  captured: true,
  international: false,
  email: "test@example.com",
  contact: "+919999999999",
  errorCode: null,
  errorDescription: null,
  notes: null,
  raw: { id: "pay_test0000000001" },
  razorpayCreatedAt: new Date("2026-01-01T10:00:00Z"),
  createdAt: new Date("2026-01-01T10:00:05Z"),
  updatedAt: new Date("2026-01-01T10:00:05Z"),
};
