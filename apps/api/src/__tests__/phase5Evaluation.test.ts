import { describe, expect, it, vi } from "vitest";
import type { RazorpayClient } from "@paysherlock/razorpay";
import { RazorpayApiError } from "@paysherlock/razorpay";
import { createRecommendation } from "@paysherlock/database";
import {
  approveRecommendationAndExecute,
  rejectRecommendationById,
  retryRecommendationExecution,
} from "../services/recommendationService.js";
import { createPhase5FakeDatabase, type FakePaymentRow } from "../eval/fakeDatabasePhase5.js";

// The Phase 5 brief's required evaluation scenarios (A-H), run end-to-end
// against the real recommendationService.ts functions and a synthetic,
// deterministic fake database/Razorpay client — no live credentials, no
// live Postgres. These are pass/fail behavioral guarantees (state-machine
// correctness, idempotency, isolation), not a scored accuracy metric like
// Phase 4's harness, so they're expressed directly as scenario tests
// rather than a separate metrics-reporting module — see docs/decisions.

const MERCHANT_ID = "merchant-1";
const OTHER_MERCHANT_ID = "merchant-2";

const PAYMENT: FakePaymentRow = {
  id: "payment-1",
  merchantId: MERCHANT_ID,
  razorpayPaymentId: "pay_test0000000001",
  amount: 240_000,
  amountRefunded: 0,
  currency: "INR",
  captured: true,
};

function fakeRazorpayClient(overrides: {
  liveAmountRefunded?: number;
  createRefund?: ReturnType<typeof vi.fn>;
}): RazorpayClient {
  return {
    payments: {
      fetch: vi.fn().mockResolvedValue({
        id: PAYMENT.razorpayPaymentId,
        captured: PAYMENT.captured,
        amount: PAYMENT.amount,
        amount_refunded: overrides.liveAmountRefunded ?? PAYMENT.amountRefunded,
        currency: PAYMENT.currency,
      }),
    },
    refunds: {
      create:
        overrides.createRefund ??
        vi.fn().mockResolvedValue({
          id: "rfnd_test0000000001",
          status: "processed",
          amount: PAYMENT.amount,
          currency: PAYMENT.currency,
          payment_id: PAYMENT.razorpayPaymentId,
        }),
      fetch: vi.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: "processed",
          amount: PAYMENT.amount,
          currency: PAYMENT.currency,
          payment_id: PAYMENT.razorpayPaymentId,
        }),
      ),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function seedPendingRecommendation(
  db: ReturnType<typeof createPhase5FakeDatabase>,
  overrides: Partial<Parameters<typeof createRecommendation>[1]> = {},
) {
  return createRecommendation(db, {
    merchantId: MERCHANT_ID,
    type: "REFUND_PAYMENT",
    title: "Refund ₹2,400",
    explanation: "The payment appears duplicated.",
    riskLevel: "MEDIUM",
    targetPaymentId: PAYMENT.id,
    amountMinorUnits: PAYMENT.amount,
    currency: PAYMENT.currency,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    initialStatus: "PENDING_APPROVAL",
    ...overrides,
  });
}

describe("Phase 5 evaluation", () => {
  it("A — valid refund: recommendation -> approval -> execution -> success -> audit trail", async () => {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const razorpayClient = fakeRazorpayClient({});
    const recommendation = await seedPendingRecommendation(db);

    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.recommendation.status).toBe("SUCCEEDED");
      expect(outcome.recommendation.action?.status).toBe("SUCCEEDED");
      expect(outcome.recommendation.action?.providerReference).toBe("rfnd_test0000000001");
    }

    // RECOMMENDATION_CREATED is emitted by the generation step
    // (generateRecommendationForInvestigation, tested separately) — this
    // scenario seeds the recommendation directly and exercises the
    // approval->execution audit trail specifically.
    const auditTypes = (db as { __auditEvents: { eventType: string }[] }).__auditEvents.map(
      (e) => e.eventType,
    );
    expect(auditTypes).toEqual(["RECOMMENDATION_APPROVED", "ACTION_STARTED", "ACTION_SUCCEEDED"]);
  });

  it("B — already refunded: execution is blocked, no duplicate refund is created", async () => {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const createRefund = vi.fn();
    // Live Razorpay state shows the payment was already fully refunded
    // since this recommendation was generated (stale-state scenario).
    const razorpayClient = fakeRazorpayClient({ liveAmountRefunded: PAYMENT.amount, createRefund });
    const recommendation = await seedPendingRecommendation(db);

    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.recommendation.status).toBe("FAILED");
      expect(outcome.recommendation.action?.errorCode).toBe("NOT_ELIGIBLE");
    }
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("C — amount exceeds the live refundable amount: validation failure, no provider call", async () => {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const createRefund = vi.fn();
    // Simulates a stale/incorrect recommendation amount (e.g. a partial
    // refund happened after it was generated) — the execution layer's own
    // live re-check must catch it regardless of what was persisted.
    const razorpayClient = fakeRazorpayClient({ liveAmountRefunded: 100_000, createRefund });
    const recommendation = await seedPendingRecommendation(db, { amountMinorUnits: 200_000 });

    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.recommendation.status).toBe("FAILED");
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("D — double approval: two concurrent approvals result in exactly one execution", async () => {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const createRefund = vi.fn().mockResolvedValue({
      id: "rfnd_test0000000001",
      status: "processed",
      amount: PAYMENT.amount,
      currency: PAYMENT.currency,
      payment_id: PAYMENT.razorpayPaymentId,
    });
    const razorpayClient = fakeRazorpayClient({ createRefund });
    const recommendation = await seedPendingRecommendation(db);

    const [a, b] = await Promise.all([
      approveRecommendationAndExecute(
        { db, razorpayClient },
        {
          id: recommendation.id,
          merchantId: MERCHANT_ID,
        },
      ),
      approveRecommendationAndExecute(
        { db, razorpayClient },
        {
          id: recommendation.id,
          merchantId: MERCHANT_ID,
        },
      ),
    ]);

    const outcomes = [a.kind, b.kind];
    expect(outcomes.filter((k) => k === "ok")).toHaveLength(1);
    expect(outcomes.filter((k) => k === "conflict")).toHaveLength(1);
    expect(createRefund).toHaveBeenCalledTimes(1);
  });

  it("E — provider failure: FAILED, an audit event exists, the error is safe", async () => {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const razorpayClient = fakeRazorpayClient({
      createRefund: vi.fn().mockRejectedValue(new RazorpayApiError("boom", { status: 400 })),
    });
    const recommendation = await seedPendingRecommendation(db);

    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.recommendation.status).toBe("FAILED");
      expect(outcome.recommendation.action?.errorMessage).not.toMatch(/at .*:\d+:\d+/);
      expect(outcome.recommendation.action?.errorMessage).not.toMatch(/boom/);
    }
    const auditTypes = (db as { __auditEvents: { eventType: string }[] }).__auditEvents.map(
      (e) => e.eventType,
    );
    expect(auditTypes).toContain("ACTION_FAILED");
  });

  it("F — expired recommendation: approval is rejected, no execution occurs", async () => {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const createRefund = vi.fn();
    const razorpayClient = fakeRazorpayClient({ createRefund });
    const recommendation = await seedPendingRecommendation(db, {
      expiresAt: new Date(Date.now() - 1000),
    });

    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );

    expect(outcome.kind).toBe("expired");
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("G — merchant isolation: a different merchant cannot approve this recommendation", async () => {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const razorpayClient = fakeRazorpayClient({});
    const recommendation = await seedPendingRecommendation(db);

    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: OTHER_MERCHANT_ID,
      },
    );
    // Not "forbidden" — a wrong merchantId simply never matches the
    // merchant-scoped query, so no execution path is reachable at all.
    expect(outcome.kind).toBe("not_found");

    // The rightful merchant can still approve it afterward — isolation
    // didn't corrupt or consume the recommendation.
    const realOutcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );
    expect(realOutcome.kind).toBe("ok");
  });

  it("H — retry: a retry after provider failure reuses the same idempotency key and can succeed", async () => {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const createRefund = vi
      .fn()
      .mockRejectedValueOnce(new RazorpayApiError("transient", { status: 502 }))
      .mockResolvedValueOnce({
        id: "rfnd_test0000000001",
        status: "processed",
        amount: PAYMENT.amount,
        currency: PAYMENT.currency,
        payment_id: PAYMENT.razorpayPaymentId,
      });
    const razorpayClient = fakeRazorpayClient({ createRefund });
    const recommendation = await seedPendingRecommendation(db);

    const first = await approveRecommendationAndExecute(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );
    expect(first.kind).toBe("ok");
    if (first.kind === "ok") expect(first.recommendation.status).toBe("FAILED");
    const firstKey = first.kind === "ok" ? first.recommendation.action?.idempotencyKey : undefined;

    const retry = await retryRecommendationExecution(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );
    expect(retry.kind).toBe("ok");
    if (retry.kind === "ok") {
      expect(retry.recommendation.status).toBe("SUCCEEDED");
      expect(retry.recommendation.action?.idempotencyKey).toBe(firstKey);
    }

    expect(createRefund).toHaveBeenCalledTimes(2);
    const [firstCallKey] = createRefund.mock.calls[0]!.slice(-1);
    const [secondCallKey] = createRefund.mock.calls[1]!.slice(-1);
    expect(firstCallKey).toBe(secondCallKey);
  });

  it("rejection: no Razorpay action occurs and the recommendation cannot later be approved", async () => {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const recommendation = await seedPendingRecommendation(db);

    const rejectOutcome = await rejectRecommendationById(
      { db },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );
    expect(rejectOutcome.kind).toBe("ok");
    if (rejectOutcome.kind === "ok") expect(rejectOutcome.recommendation.status).toBe("REJECTED");

    const razorpayClient = fakeRazorpayClient({ createRefund: vi.fn() });
    const approveAfterReject = await approveRecommendationAndExecute(
      { db, razorpayClient },
      {
        id: recommendation.id,
        merchantId: MERCHANT_ID,
      },
    );
    expect(approveAfterReject.kind).toBe("conflict");
  });
});
