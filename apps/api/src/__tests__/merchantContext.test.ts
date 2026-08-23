import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import {
  createMockDb,
  noopApproveRecommendation,
  noopGetOverview,
  noopRejectRecommendation,
  noopRetryRecommendation,
  noopRunInvestigation,
} from "./fixtures.js";

// Phase 7 — merchant CONTEXT, not a new authorization mechanism. These
// tests prove the resolveMerchantContext seam behaves exactly as designed:
// optional (falls back to today's resolveMerchant(db, {}) when omitted, so
// production behavior is unchanged), server-side only (never influenced by
// a request), and consistently used by every merchant-scoped route. They
// deliberately do NOT exercise apps/api/src/index.ts's DEMO_MODE wiring
// itself (untestable without a live process, same as every other env-driven
// value index.ts constructs) — see config.test.ts for that env-parsing
// logic, and docs/decisions for why route/handler tests inject deps
// directly rather than going through main().

const DEMO_MERCHANT = { id: "demo-merchant-1", name: "PaySherlock Demo Merchant" };
const DEFAULT_MERCHANT = { id: "default-merchant-1", name: "Default Merchant" };

function demoMerchantContext() {
  return vi.fn().mockResolvedValue(DEMO_MERCHANT);
}

describe("resolveMerchantContext — default (production) behavior is unchanged", () => {
  it("falls back to resolveMerchant(db, {}) when no resolveMerchantContext is supplied", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue(DEFAULT_MERCHANT);
    db.issue.findMany.mockResolvedValue([]);
    const app = buildServer({
      db,
      webhookSecret: "whsec_test",
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
      // resolveMerchantContext intentionally omitted — this is what every
      // production deployment gets unless index.ts explicitly overrides it.
    });

    await app.inject({ method: "GET", url: "/issues" });

    expect(db.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "default-merchant-1", status: undefined } }),
    );
    await app.close();
  });

  it("a client cannot switch merchant context by any request field — no override present", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue(DEFAULT_MERCHANT);
    db.payment.findMany.mockResolvedValue([]);
    const app = buildServer({
      db,
      webhookSecret: "whsec_test",
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
    });

    await app.inject({
      method: "GET",
      url: "/payments?merchantId=attacker-supplied&resolveMerchantContext=demo-merchant-1",
    });

    expect(db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "default-merchant-1", status: undefined } }),
    );
    await app.close();
  });
});

describe("resolveMerchantContext — explicit override (what DEMO_MODE injects)", () => {
  function buildDemoApp(
    db: ReturnType<typeof createMockDb>,
    overrides: Record<string, unknown> = {},
  ) {
    return buildServer({
      db,
      webhookSecret: "whsec_test",
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
      resolveMerchantContext: demoMerchantContext(),
      ...overrides,
    });
  }

  it("GET /issues returns the demo merchant's issues, never the db.merchant.* mock", async () => {
    const db = createMockDb();
    // Deliberately left unmocked / wrong — proves the route never falls
    // back to resolveMerchant(db, {}) when an override is supplied.
    db.merchant.findFirst.mockResolvedValue(DEFAULT_MERCHANT);
    db.issue.findMany.mockResolvedValue([]);
    const app = buildDemoApp(db);

    await app.inject({ method: "GET", url: "/issues" });

    expect(db.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "demo-merchant-1", status: undefined } }),
    );
    await app.close();
  });

  it("GET /payments returns the demo merchant's payments", async () => {
    const db = createMockDb();
    db.payment.findMany.mockResolvedValue([]);
    const app = buildDemoApp(db);

    await app.inject({ method: "GET", url: "/payments" });

    expect(db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "demo-merchant-1", status: undefined } }),
    );
    await app.close();
  });

  it("GET /overview calls getOverview with the demo merchant id", async () => {
    const db = createMockDb();
    const overviewFn = vi.fn().mockResolvedValue({ currency: "INR", hasData: true, issues: [] });
    const app = buildDemoApp(db, { getOverview: overviewFn });

    await app.inject({ method: "GET", url: "/overview" });

    expect(overviewFn).toHaveBeenCalledWith("demo-merchant-1");
    await app.close();
  });

  it("POST /investigations runs the investigation against the demo merchant", async () => {
    const db = createMockDb();
    db.recommendation.create.mockResolvedValue({
      id: "rec_1",
      merchantId: "demo-merchant-1",
      issueId: null,
      investigationId: "inv_1",
      type: "NO_ACTION",
      title: "No action required",
      explanation: "stub",
      riskLevel: "LOW",
      status: "SUCCEEDED",
      targetPaymentId: null,
      amountMinorUnits: null,
      currency: null,
      approvedAt: null,
      rejectedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.auditEvent.create.mockResolvedValue({ id: "audit_1" });
    const runInvestigation = vi.fn().mockResolvedValue({
      question: "Why did the UPI failure rate increase?",
      summary: "stub",
      rootCause: undefined,
      evidence: [],
      rejectedHypotheses: [],
      recommendations: [],
      meta: { investigationId: "inv_1", stepsExecuted: 1, toolCalls: 1, provider: "deterministic" },
    });
    const app = buildDemoApp(db, { runInvestigation });

    await app.inject({
      method: "POST",
      url: "/investigations",
      // Even an attacker-supplied merchantId in the body changes nothing —
      // CreateInvestigationSchema has no merchantId field at all.
      payload: { question: "Why did the UPI failure rate increase?", merchantId: "attacker-id" },
    });

    expect(runInvestigation).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: "demo-merchant-1" }),
    );
    await app.close();
  });

  it("GET /recommendations lists the demo merchant's recommendations", async () => {
    const db = createMockDb();
    db.recommendation.findMany.mockResolvedValue([]);
    const app = buildDemoApp(db);

    await app.inject({ method: "GET", url: "/recommendations" });

    expect(db.recommendation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "demo-merchant-1", status: undefined } }),
    );
    await app.close();
  });

  it("approval is scoped to the demo merchant — cannot cross into another merchant's recommendation", async () => {
    const db = createMockDb();
    const approveRecommendation = vi.fn().mockResolvedValue({ kind: "not_found" });
    const app = buildDemoApp(db, { approveRecommendation });

    await app.inject({ method: "POST", url: "/recommendations/rec-1/approve" });

    expect(approveRecommendation).toHaveBeenCalledWith({
      id: "rec-1",
      merchantId: "demo-merchant-1",
    });
    await app.close();
  });

  it("a client-supplied merchantId is still ignored even when a demo override is active", async () => {
    const db = createMockDb();
    db.issue.findMany.mockResolvedValue([]);
    const app = buildDemoApp(db);

    await app.inject({ method: "GET", url: "/issues?merchantId=attacker-supplied-id" });

    expect(db.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "demo-merchant-1", status: undefined } }),
    );
    await app.close();
  });
});

describe("webhook merchant resolution is unaffected by resolveMerchantContext", () => {
  const WEBHOOK_SECRET = "whsec_test_secret";
  function sign(body: string) {
    return createHmac("sha256", WEBHOOK_SECRET).update(body, "utf8").digest("hex");
  }

  it("POST /webhooks/razorpay still resolves its merchant from the payload's account_id, not the demo override", async () => {
    const db = createMockDb();
    db.merchant.upsert.mockResolvedValue({ id: "webhook-resolved-merchant" });
    db.paymentEvent.create.mockResolvedValue({ id: "pe1" });
    db.paymentEvent.update.mockResolvedValue({});
    const app = buildServer({
      db,
      webhookSecret: WEBHOOK_SECRET,
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
      // Even with a demo override present, the webhook route must never
      // use it — registerWebhookRoutes is wired with the raw deps, not
      // the resolvedDeps that carry this override.
      resolveMerchantContext: demoMerchantContext(),
    });
    const body = JSON.stringify({
      entity: "event",
      account_id: "acc_real_test_account",
      event: "payment.authorized",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: "pay_test_webhook_1",
            entity: "payment",
            amount: 100,
            currency: "INR",
            status: "authorized",
            method: "card",
            captured: false,
            created_at: 1767000000,
          },
        },
      },
      created_at: 1767000001,
    });

    await app.inject({
      method: "POST",
      url: "/webhooks/razorpay",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": sign(body),
        "x-razorpay-event-id": "evt_merchant_context_check",
      },
      payload: body,
    });

    // resolveMerchant is called with the payload's own account_id — never
    // "demo_merchant" — confirmed via the upsert call's `where` clause.
    expect(db.merchant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { razorpayAccountId: "acc_real_test_account" } }),
    );
    await app.close();
  });
});
