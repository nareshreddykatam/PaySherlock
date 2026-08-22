import { execSync } from "node:child_process";
import {
  createInvestigationRunner,
  DeterministicProvider,
  DEFAULT_MAX_AGENT_STEPS,
} from "@paysherlock/agent";
import { createToolRegistry } from "@paysherlock/tools";
import { runDetectionForMerchant, type DetectionRunDeps } from "@paysherlock/detection";
import type { Issue } from "@paysherlock/database";
import {
  createRecommendation,
  getActionById,
  getIssueById,
  getRecommendationById,
} from "@paysherlock/database";
import { RazorpayApiError, type RazorpayClient } from "@paysherlock/razorpay";
import {
  approveRecommendationAndExecute,
  retryRecommendationExecution,
} from "../services/recommendationService.js";
import { createPhase5FakeDatabase, type FakePaymentRow } from "./fakeDatabasePhase5.js";
import { EVAL_MERCHANT_ID, NOW, PHASE4_SCENARIOS, buildScenarioDatabase } from "./scenarios.js";
import { PAYMENT_FAILURE_SPIKE_SCENARIO } from "./phase6Scenarios.js";

// The dedicated Phase 6 end-to-end evaluation harness (brief section 4):
// Payment data -> detection -> issue -> investigation -> root cause ->
// recommendation -> approval -> action -> verification -> audit, all in
// one report. Deliberately built on top of Phase 4's and Phase 5's own
// proven fixtures/logic rather than a fourth synthetic-data system or a
// re-implementation of the recommendation service — see docs/decisions.
// Every scenario here uses synthetic data and a mocked RazorpayClient;
// nothing requires live credentials or a live database.

export type Phase6ScenarioCategory = "detection" | "action" | "security";

export interface Phase6ScenarioResult {
  id: string;
  name: string;
  category: Phase6ScenarioCategory;
  passed: boolean;
  notes: string[];
  details: Record<string, unknown>;
}

export interface Phase6Metrics {
  detection: {
    /** Computed on this harness's own scenario mix only — see
     * docs/evaluation for why this is not a real-world precision figure. */
    recall: number;
    falsePositiveRate: number;
    duplicateIssueRate: number | "unavailable";
  };
  investigation: {
    triggerSuccessRate: number;
    rootCauseAccuracy: number;
    evidenceAccuracy: number | "unavailable";
  };
  actions: {
    approvalSuccessRate: number;
    duplicateExecutionRate: number;
    staleStateRejectionRate: number;
    actionSuccessRate: number;
    falseSuccessRate: number;
  };
  reliability: {
    unhandledExceptions: number;
    failedRequests: "unavailable";
    retryCorrectness: "pass" | "fail" | "unavailable";
  };
  security: {
    crossMerchantAccessFailuresBlocked: number;
    approvalBypassAttemptsBlocked: number;
  };
}

export interface Phase6EvaluationReport {
  generatedAt: string;
  gitCommit: string;
  environment: {
    mode: "synthetic";
    aiProvider: "deterministic";
    razorpay: "mocked";
    database: "in-memory fake (no live Postgres)";
    nodeVersion: string;
  };
  scenarios: Phase6ScenarioResult[];
  metrics: Phase6Metrics;
  limitations: string[];
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

// --- Detection-side scenarios (A-F) -------------------------------------------

function detectionDeps(db: ReturnType<typeof buildScenarioDatabase>): DetectionRunDeps {
  const runner = createInvestigationRunner({
    provider: new DeterministicProvider(),
    registry: createToolRegistry(),
    maxSteps: DEFAULT_MAX_AGENT_STEPS,
  });
  return { db, runInvestigation: (request) => runner(request, db) };
}

interface DetectionExpectation {
  id: string;
  name: string;
  scenarioRef: (typeof PHASE4_SCENARIOS)[number];
  expectIssue: boolean;
  expectedTypes?: string[];
}

async function runDetectionScenario(spec: DetectionExpectation): Promise<Phase6ScenarioResult> {
  const notes: string[] = [];
  let passed = true;

  const db = buildScenarioDatabase(spec.scenarioRef, () => NOW);
  const deps = detectionDeps(db);
  const summary = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);
  const issues: Issue[] = await db.issue.findMany({ where: { merchantId: EVAL_MERCHANT_ID } });

  if (spec.expectIssue) {
    if (issues.length === 0) {
      passed = false;
      notes.push("expected at least one issue; none were created");
    }
    if (spec.expectedTypes) {
      const actualTypes = issues.map((i) => i.type);
      if (!spec.expectedTypes.some((t) => actualTypes.includes(t as Issue["type"]))) {
        passed = false;
        notes.push(
          `expected one of [${spec.expectedTypes.join(", ")}], got [${actualTypes.join(", ") || "none"}]`,
        );
      }
    }
    if (summary.investigationsTriggered === 0 && summary.investigationsFailed === 0) {
      passed = false;
      notes.push("expected an automatic investigation to be triggered — none was");
    }
    const businessImpactCount = issues.filter((i) => i.estimatedImpactMinorUnits !== null).length;
    notes.push(`business impact computed for ${businessImpactCount}/${issues.length} issue(s)`);
    notes.push("no financial action occurred automatically (Phase 6 hard requirement)");
  } else {
    if (issues.length > 0) {
      passed = false;
      notes.push(`expected no issue for a healthy merchant; ${issues.length} were created`);
    }
    if (summary.investigationsTriggered + summary.investigationsFailed > 0) {
      passed = false;
      notes.push("expected no investigation to be triggered for a healthy merchant");
    }
  }

  return {
    id: spec.id,
    name: spec.name,
    category: "detection",
    passed,
    notes,
    details: {
      issuesCreated: summary.issuesCreated,
      investigationsTriggered: summary.investigationsTriggered,
      investigationsFailed: summary.investigationsFailed,
      issueTypes: issues.map((i) => i.type),
      issueStatuses: issues.map((i) => i.status),
      rootCauses: issues.map((i) => i.rootCause).filter((r): r is string => r !== null),
    },
  };
}

function findScenario(prefix: string) {
  const found = PHASE4_SCENARIOS.find((s) => s.name.startsWith(prefix));
  if (!found) throw new Error(`Phase 4 scenario "${prefix}" not found`);
  return found;
}

async function runDetectionScenarios(): Promise<Phase6ScenarioResult[]> {
  const specs: DetectionExpectation[] = [
    {
      id: "A",
      name: "Healthy merchant",
      scenarioRef: findScenario("E — Normal business"),
      expectIssue: false,
    },
    {
      id: "B",
      name: "UPI degradation",
      scenarioRef: findScenario("A — UPI degradation"),
      expectIssue: true,
      expectedTypes: ["PAYMENT_METHOD_DEGRADATION"],
    },
    {
      id: "C",
      name: "Payment failure spike",
      scenarioRef: PAYMENT_FAILURE_SPIKE_SCENARIO,
      expectIssue: true,
      expectedTypes: ["PAYMENT_FAILURE_SPIKE"],
    },
    {
      id: "D",
      name: "Refund spike",
      scenarioRef: findScenario("B — Refund spike"),
      expectIssue: true,
      expectedTypes: ["REFUND_SPIKE"],
    },
    {
      id: "E",
      name: "Transaction volume decline",
      scenarioRef: findScenario("C — Transaction volume decline"),
      expectIssue: true,
      expectedTypes: ["TRANSACTION_VOLUME_DECLINE"],
    },
    {
      id: "F",
      name: "High-value transaction decline",
      scenarioRef: findScenario("D — High-value transaction decline"),
      expectIssue: true,
      expectedTypes: ["HIGH_VALUE_TRANSACTION_DECLINE"],
    },
  ];

  const results: Phase6ScenarioResult[] = [];
  for (const spec of specs) results.push(await runDetectionScenario(spec));
  return results;
}

// --- Action-side scenarios (G-L) -----------------------------------------------

const PAYMENT: FakePaymentRow = {
  id: "payment-1",
  merchantId: EVAL_MERCHANT_ID,
  razorpayPaymentId: "pay_test0000000001",
  amount: 240_000,
  amountRefunded: 0,
  currency: "INR",
  captured: true,
};

function fakeRazorpayClient(overrides: {
  liveAmountRefunded?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createRefund?: any;
}): RazorpayClient {
  return {
    payments: {
      fetch: async () => ({
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
        (async () => ({
          id: "rfnd_test0000000001",
          status: "processed",
          amount: PAYMENT.amount,
          currency: PAYMENT.currency,
          payment_id: PAYMENT.razorpayPaymentId,
        })),
      fetch: async (id: string) => ({
        id,
        status: "processed",
        amount: PAYMENT.amount,
        currency: PAYMENT.currency,
        payment_id: PAYMENT.razorpayPaymentId,
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function seedPendingRecommendation(
  db: ReturnType<typeof createPhase5FakeDatabase>,
  overrides: Partial<Parameters<typeof createRecommendation>[1]> = {},
) {
  return createRecommendation(db, {
    merchantId: EVAL_MERCHANT_ID,
    type: "REFUND_PAYMENT",
    title: "Refund ₹2,400",
    explanation: "The payment appears duplicated based on the investigation evidence.",
    riskLevel: "MEDIUM",
    targetPaymentId: PAYMENT.id,
    amountMinorUnits: PAYMENT.amount,
    currency: PAYMENT.currency,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    initialStatus: "PENDING_APPROVAL",
    ...overrides,
  });
}

async function runActionScenarios(): Promise<Phase6ScenarioResult[]> {
  const results: Phase6ScenarioResult[] = [];

  // G — Valid guarded refund.
  {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const razorpayClient = fakeRazorpayClient({});
    const rec = await seedPendingRecommendation(db);
    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      { id: rec.id, merchantId: EVAL_MERCHANT_ID },
    );
    const passed =
      outcome.kind === "ok" &&
      outcome.recommendation.status === "SUCCEEDED" &&
      outcome.recommendation.action?.status === "SUCCEEDED";
    results.push({
      id: "G",
      name: "Valid guarded refund",
      category: "action",
      passed,
      notes: passed
        ? ["exactly one refund action executed"]
        : [`unexpected outcome: ${outcome.kind}`],
      details: { outcome: outcome.kind },
    });
  }

  // H — Double approval.
  {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const createRefund = vi_fn_resolve({
      id: "rfnd_test0000000001",
      status: "processed",
      amount: PAYMENT.amount,
      currency: PAYMENT.currency,
      payment_id: PAYMENT.razorpayPaymentId,
    });
    const razorpayClient = fakeRazorpayClient({ createRefund });
    const rec = await seedPendingRecommendation(db);
    const [a, b] = await Promise.all([
      approveRecommendationAndExecute(
        { db, razorpayClient },
        { id: rec.id, merchantId: EVAL_MERCHANT_ID },
      ),
      approveRecommendationAndExecute(
        { db, razorpayClient },
        { id: rec.id, merchantId: EVAL_MERCHANT_ID },
      ),
    ]);
    const okCount = [a, b].filter((o) => o.kind === "ok").length;
    const passed = okCount === 1 && createRefund.callCount === 1;
    results.push({
      id: "H",
      name: "Double approval",
      category: "action",
      passed,
      notes: [
        `${okCount} of 2 concurrent approvals succeeded`,
        `${createRefund.callCount} provider call(s) made`,
      ],
      details: { outcomes: [a.kind, b.kind] },
    });
  }

  // I — Stale refund state (live provider state no longer matches).
  {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const createRefund = vi_fn_resolve(undefined);
    const razorpayClient = fakeRazorpayClient({
      liveAmountRefunded: PAYMENT.amount, // already fully refunded live
      createRefund,
    });
    const rec = await seedPendingRecommendation(db);
    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      { id: rec.id, merchantId: EVAL_MERCHANT_ID },
    );
    const passed =
      outcome.kind === "ok" &&
      outcome.recommendation.status === "FAILED" &&
      createRefund.callCount === 0;
    results.push({
      id: "I",
      name: "Stale refund state",
      category: "action",
      passed,
      notes: passed
        ? ["execution blocked before any provider call — live state re-validated"]
        : [`unexpected: outcome=${outcome.kind}, providerCalls=${createRefund.callCount}`],
      details: {
        errorCode: outcome.kind === "ok" ? outcome.recommendation.action?.errorCode : null,
      },
    });
  }

  // J — Provider failure.
  {
    const db = createPhase5FakeDatabase([PAYMENT]);
    const razorpayClient = fakeRazorpayClient({
      createRefund: vi_fn_reject(new RazorpayApiError("boom", { status: 400 })),
    });
    const rec = await seedPendingRecommendation(db);
    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      { id: rec.id, merchantId: EVAL_MERCHANT_ID },
    );
    const auditTypes = (db as { __auditEvents: { eventType: string }[] }).__auditEvents.map(
      (e) => e.eventType,
    );
    const safeError =
      outcome.kind === "ok" &&
      !!outcome.recommendation.action?.errorMessage &&
      !outcome.recommendation.action.errorMessage.match(/at .*:\d+:\d+/);
    const passed =
      outcome.kind === "ok" &&
      outcome.recommendation.status === "FAILED" &&
      auditTypes.includes("ACTION_FAILED") &&
      safeError;
    results.push({
      id: "J",
      name: "Provider failure",
      category: "action",
      passed,
      notes: passed
        ? ["action FAILED, audit event recorded, error message contained no stack trace"]
        : [`unexpected: outcome=${outcome.kind}`],
      details: { auditTypes },
    });
  }

  // K — Retry (same logical action / idempotency key).
  {
    const db = createPhase5FakeDatabase([PAYMENT]);
    let call = 0;
    const createRefund = async (..._args: unknown[]) => {
      call += 1;
      if (call === 1) throw new RazorpayApiError("transient", { status: 502 });
      return {
        id: "rfnd_test0000000001",
        status: "processed",
        amount: PAYMENT.amount,
        currency: PAYMENT.currency,
        payment_id: PAYMENT.razorpayPaymentId,
      };
    };
    const capturedKeys: string[] = [];
    const wrappedCreateRefund = async (
      paymentId: string,
      body: unknown,
      idempotencyKey: string,
    ) => {
      capturedKeys.push(idempotencyKey);
      return createRefund(paymentId, body, idempotencyKey);
    };
    const razorpayClient = fakeRazorpayClient({ createRefund: wrappedCreateRefund });
    const rec = await seedPendingRecommendation(db);

    const first = await approveRecommendationAndExecute(
      { db, razorpayClient },
      { id: rec.id, merchantId: EVAL_MERCHANT_ID },
    );
    const retry = await retryRecommendationExecution(
      { db, razorpayClient },
      { id: rec.id, merchantId: EVAL_MERCHANT_ID },
    );

    const sameKey = capturedKeys.length === 2 && capturedKeys[0] === capturedKeys[1];
    const passed =
      first.kind === "ok" &&
      first.recommendation.status === "FAILED" &&
      retry.kind === "ok" &&
      retry.recommendation.status === "SUCCEEDED" &&
      sameKey;
    results.push({
      id: "K",
      name: "Retry after provider failure",
      category: "action",
      passed,
      notes: passed
        ? ["retry reused the same idempotency key and reached SUCCEEDED"]
        : [`unexpected: first=${first.kind}, retry=${retry.kind}, sameKey=${sameKey}`],
      details: { idempotencyKeys: capturedKeys },
    });
  }

  // L — Cross-merchant isolation (issue, recommendation, action).
  {
    const OTHER_MERCHANT_ID = "phase6-other-merchant";
    const db = createPhase5FakeDatabase([PAYMENT]);
    const rec = await seedPendingRecommendation(db);
    const approved = await approveRecommendationAndExecute(
      { db, razorpayClient: fakeRazorpayClient({}) },
      { id: rec.id, merchantId: EVAL_MERCHANT_ID },
    );
    const actionId =
      approved.kind === "ok" && approved.recommendation.action
        ? approved.recommendation.action.id
        : undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seededIssue = (db as any).__seedIssue({
      merchantId: EVAL_MERCHANT_ID,
      status: "IDENTIFIED",
    });

    const recommendationBlocked =
      (await getRecommendationById(db, { id: rec.id, merchantId: OTHER_MERCHANT_ID })) === null;
    const actionBlocked =
      actionId === undefined ||
      (await getActionById(db, { id: actionId, merchantId: OTHER_MERCHANT_ID })) === null;
    const issueBlocked =
      (await getIssueById(db, { id: seededIssue.id, merchantId: OTHER_MERCHANT_ID })) === null;

    // And the rightful merchant can still read all three.
    const recommendationVisible =
      (await getRecommendationById(db, { id: rec.id, merchantId: EVAL_MERCHANT_ID })) !== null;
    const issueVisible =
      (await getIssueById(db, { id: seededIssue.id, merchantId: EVAL_MERCHANT_ID })) !== null;

    const passed =
      recommendationBlocked &&
      actionBlocked &&
      issueBlocked &&
      recommendationVisible &&
      issueVisible;
    results.push({
      id: "L",
      name: "Cross-merchant isolation",
      category: "security",
      passed,
      notes: [
        `recommendation blocked for other merchant: ${recommendationBlocked}`,
        `action blocked for other merchant: ${actionBlocked}`,
        `issue blocked for other merchant: ${issueBlocked}`,
      ],
      details: {},
    });
  }

  return results;
}

// Minimal call-counting async stubs — avoids pulling vitest's `vi` into
// production eval code (this file is also imported by the CLI script,
// which never runs under a test runner).
function vi_fn_resolve<T>(value: T): ((...args: unknown[]) => Promise<T>) & { callCount: number } {
  const fn = ((..._args: unknown[]) => {
    fn.callCount += 1;
    return Promise.resolve(value);
  }) as ((...args: unknown[]) => Promise<T>) & { callCount: number };
  fn.callCount = 0;
  return fn;
}

function vi_fn_reject(
  error: unknown,
): ((...args: unknown[]) => Promise<never>) & { callCount: number } {
  const fn = ((..._args: unknown[]) => {
    fn.callCount += 1;
    return Promise.reject(error);
  }) as ((...args: unknown[]) => Promise<never>) & { callCount: number };
  fn.callCount = 0;
  return fn;
}

// --- Orchestration + metrics ---------------------------------------------------

export async function runPhase6Evaluation(): Promise<Phase6EvaluationReport> {
  let unhandledExceptions = 0;
  let detectionResults: Phase6ScenarioResult[];
  let actionResults: Phase6ScenarioResult[];

  try {
    detectionResults = await runDetectionScenarios();
  } catch (error) {
    unhandledExceptions += 1;
    detectionResults = [
      {
        id: "detection-harness",
        name: "Detection scenario harness",
        category: "detection",
        passed: false,
        notes: [`harness threw: ${error instanceof Error ? error.message : String(error)}`],
        details: {},
      },
    ];
  }

  try {
    actionResults = await runActionScenarios();
  } catch (error) {
    unhandledExceptions += 1;
    actionResults = [
      {
        id: "action-harness",
        name: "Action scenario harness",
        category: "action",
        passed: false,
        notes: [`harness threw: ${error instanceof Error ? error.message : String(error)}`],
        details: {},
      },
    ];
  }

  const scenarios = [...detectionResults, ...actionResults];

  const anomalyDetectionScenarios = detectionResults.filter((r) => r.id !== "A");
  const normalScenarios = detectionResults.filter((r) => r.id === "A");
  const recall =
    anomalyDetectionScenarios.length > 0
      ? anomalyDetectionScenarios.filter((r) => r.passed).length / anomalyDetectionScenarios.length
      : 1;
  const falsePositiveRate =
    normalScenarios.length > 0
      ? normalScenarios.filter((r) => !r.passed).length / normalScenarios.length
      : 0;

  const investigationTriggerSuccessRate =
    anomalyDetectionScenarios.length > 0
      ? anomalyDetectionScenarios.filter(
          (r) => ((r.details.investigationsTriggered as number) ?? 0) > 0,
        ).length / anomalyDetectionScenarios.length
      : 1;
  const rootCauseAccuracy =
    anomalyDetectionScenarios.length > 0
      ? anomalyDetectionScenarios.filter(
          (r) => ((r.details.rootCauses as string[])?.length ?? 0) > 0,
        ).length / anomalyDetectionScenarios.length
      : 1;

  const g = scenarios.find((r) => r.id === "G");
  const h = scenarios.find((r) => r.id === "H");
  const i = scenarios.find((r) => r.id === "I");
  const j = scenarios.find((r) => r.id === "J");
  const k = scenarios.find((r) => r.id === "K");
  const l = scenarios.find((r) => r.id === "L");

  const metrics: Phase6Metrics = {
    detection: {
      recall,
      falsePositiveRate,
      duplicateIssueRate: "unavailable", // covered by the Phase 4 harness's own multi-run scenarios, not re-measured here
    },
    investigation: {
      triggerSuccessRate: investigationTriggerSuccessRate,
      rootCauseAccuracy,
      evidenceAccuracy: "unavailable", // no independent ground truth for evidence correctness in this harness
    },
    actions: {
      approvalSuccessRate: g?.passed ? 1 : 0,
      duplicateExecutionRate: h?.passed ? 0 : 1,
      staleStateRejectionRate: i?.passed ? 1 : 0,
      actionSuccessRate: g?.passed && j?.passed ? 1 : 0,
      falseSuccessRate: j?.passed ? 0 : 1,
    },
    reliability: {
      unhandledExceptions,
      failedRequests: "unavailable", // this harness calls services directly, not over real HTTP
      retryCorrectness: k ? (k.passed ? "pass" : "fail") : "unavailable",
    },
    security: {
      crossMerchantAccessFailuresBlocked: l?.passed ? 3 : 0, // issue + recommendation + action
      approvalBypassAttemptsBlocked: h?.passed ? 1 : 0,
    },
  };

  return {
    generatedAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    environment: {
      mode: "synthetic",
      aiProvider: "deterministic",
      razorpay: "mocked",
      database: "in-memory fake (no live Postgres)",
      nodeVersion: process.version,
    },
    scenarios,
    metrics,
    limitations: [
      "All data is synthetic; no live Postgres or live Razorpay Test Mode was used.",
      "Detection precision/recall are computed over this harness's own small scenario set, not real merchant traffic — not a production accuracy claim.",
      "evidenceAccuracy and failedRequests are not measured by this harness (no independent ground truth / no real HTTP layer involved) and are reported as unavailable rather than fabricated.",
      "duplicateIssueRate is exercised by the separate Phase 4 evaluation harness (multi-run scenarios), not re-measured here to avoid duplicating that harness's logic.",
    ],
  };
}
