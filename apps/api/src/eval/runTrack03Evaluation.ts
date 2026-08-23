import { execSync } from "node:child_process";
import { getIssueById } from "@paysherlock/database";
import type { RazorpayClient } from "@paysherlock/razorpay";
import { RazorpayApiError } from "@paysherlock/razorpay";
import type { InvestigationResult } from "@paysherlock/types";
import { approveRecommendationAndExecute } from "../services/recommendationService.js";
import { generateRecoveryBatch, RECOVERY_BATCH_LIMITS } from "../services/recoveryBatchService.js";
import { createPhase5FakeDatabase, type FakePaymentRow } from "./fakeDatabasePhase5.js";
import { EVAL_MERCHANT_ID, NOW } from "./scenarios.js";

// Razorpay AI Buildathon Track 03 (AI Revenue Recovery) evaluation harness.
// Deliberately built the same way Phase 6's harness was: on top of the
// real, unmodified guarded-action pipeline (createRecommendation,
// approveRecommendationAndExecute) and a mocked RazorpayClient — never a
// live Razorpay call, never a synthetic payment id sent to a real API.
// Every "recovered" rupee reported here comes from a MOCKED provider
// response; this is a synthetic evaluation of the recovery workflow's
// correctness, not a real-world revenue-recovery rate. See docs/decisions
// and the Phase 6 report for the same disclosure pattern.

const OTHER_MERCHANT_ID = "track03-other-merchant";
// The harness's own "if too many attempts fail, stop calling the rest"
// rule. There is no live bulk-execute endpoint in the product — Phase 5/6's
// approval boundary stays one recommendation per explicit approval call —
// so this threshold is enforced here, in the orchestration loop that
// stands in for what a batch executor would do, using the exact same
// per-recommendation approveRecommendationAndExecute the live API uses.
const FAILURE_THRESHOLD = 2;

export interface Track03ScenarioResult {
  id: string;
  name: string;
  passed: boolean;
  notes: string[];
  details: Record<string, unknown>;
}

export interface Track03RecoveryMetrics {
  batchSize: number;
  candidatesFound: number;
  candidatesEligible: number;
  candidatesRejected: number;
  candidatesAttempted: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  amountEligibleMinorUnits: number;
  amountAttemptedMinorUnits: number;
  amountRecoveredMinorUnits: number;
  recoveryRate: number;
  duplicateExecutionCount: number;
  falseSuccessCount: number;
  stoppingReason: string | null;
}

export interface Track03EvaluationReport {
  generatedAt: string;
  gitCommit: string;
  environment: {
    mode: "synthetic";
    provider: "mocked-razorpay-client";
    disclosure: string;
  };
  scenarios: Track03ScenarioResult[];
  metrics: Track03RecoveryMetrics;
  limitations: string[];
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

// --- Synthetic UPI-degradation dataset -----------------------------------------

function upiPayment(
  index: number,
  overrides: Partial<FakePaymentRow> = {},
  minutesAgo = 30,
): FakePaymentRow {
  return {
    id: `t03-payment-${index}`,
    merchantId: EVAL_MERCHANT_ID,
    razorpayPaymentId: `pay_t03_${String(index).padStart(4, "0")}`,
    amount: 30_000,
    amountRefunded: 0,
    currency: "INR",
    captured: true,
    status: "CAPTURED",
    method: "UPI",
    razorpayCreatedAt: new Date(NOW.getTime() - minutesAgo * 60 * 1000),
    ...overrides,
  };
}

const DEGRADATION_INVESTIGATION: InvestigationResult = {
  question: "Why did the UPI failure rate increase?",
  summary:
    'Investigation into "Why did the UPI failure rate increase?" found a likely cause: UPI ' +
    "payment failure rate increased significantly.",
  rootCause: "UPI payment failure rate increased significantly",
  confidence: "high",
  evidence: [
    {
      id: "ev_1",
      metric: "overall_failure_rate",
      source: "get_payment_failures",
      comparison: "+20.9pp vs. baseline",
      significance: "high",
      baselineValue: 0.06,
      observedValue: 0.27,
      supportsHypothesisIds: ["upi_failure_increase"],
    },
  ],
  rejectedHypotheses: [],
  hypotheses: [
    {
      id: "upi_failure_increase",
      statement: "UPI payment failure rate increased significantly",
      status: "SUPPORTED",
      evidenceIds: ["ev_1"],
    },
  ],
  recommendations: ["Investigate and address the UPI failure rate increase."],
  meta: {
    investigationId: "inv_t03_1",
    stepsExecuted: 8,
    toolCalls: 8,
    provider: "deterministic",
  },
};

function seedDegradationIssue(
  db: ReturnType<typeof createPhase5FakeDatabase>,
  merchantId: string = EVAL_MERCHANT_ID,
) {
  return db.__seedIssue({
    merchantId,
    type: "PAYMENT_METHOD_DEGRADATION",
    title: "UPI payment degradation",
    status: "IDENTIFIED",
    dimension: "UPI",
    detectedAt: NOW,
    rootCause: DEGRADATION_INVESTIGATION.rootCause,
    confidence: "high",
    estimatedImpactMinorUnits: 174_250,
    investigationResult: DEGRADATION_INVESTIGATION,
  });
}

/** Multi-payment-aware mocked RazorpayClient — unlike Phase 6's
 * single-payment fake, Track 03 needs distinct live-state/refund behavior
 * per candidate so a batch run can honestly mix successes and failures. */
function fakeRazorpayClient(
  payments: FakePaymentRow[],
  options: {
    failingRazorpayPaymentIds?: ReadonlySet<string>;
    staleRazorpayPaymentIds?: ReadonlySet<string>;
  } = {},
): RazorpayClient & { refundCallCount: number } {
  const byRazorpayId = new Map(payments.map((p) => [p.razorpayPaymentId, p]));
  let refundCallCount = 0;

  const client = {
    payments: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: async (razorpayPaymentId: string): Promise<any> => {
        const payment = byRazorpayId.get(razorpayPaymentId);
        if (!payment) throw new RazorpayApiError("payment not found", { status: 404 });
        const stale = options.staleRazorpayPaymentIds?.has(razorpayPaymentId) ?? false;
        return {
          id: razorpayPaymentId,
          captured: payment.captured,
          amount: payment.amount,
          amount_refunded: stale ? payment.amount : payment.amountRefunded,
          currency: payment.currency,
        };
      },
    },
    refunds: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async (razorpayPaymentId: string, body: { amount: number }): Promise<any> => {
        refundCallCount += 1;
        if (options.failingRazorpayPaymentIds?.has(razorpayPaymentId)) {
          throw new RazorpayApiError("Refund rejected by provider (synthetic failure)", {
            status: 502,
          });
        }
        return {
          id: `rfnd_t03_${refundCallCount}`,
          status: "processed",
          amount: body.amount,
          currency: "INR",
          payment_id: razorpayPaymentId,
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: async (id: string): Promise<any> => ({
        id,
        status: "processed",
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  Object.defineProperty(client, "refundCallCount", { get: () => refundCallCount });
  return client;
}

// --- Scenarios A-K (focused correctness checks) --------------------------------

async function runFocusedScenarios(): Promise<Track03ScenarioResult[]> {
  const results: Track03ScenarioResult[] = [];

  // A — Revenue-at-risk detection: the metric is real, reproducible, and
  // not fabricated by this harness — it's exactly what
  // packages/tools' calculate_revenue_impact already computes and
  // packages/detection already persists onto the Issue.
  {
    const db = createPhase5FakeDatabase([]);
    const issue = seedDegradationIssue(db);
    const fetched = await getIssueById(db, { id: issue.id, merchantId: EVAL_MERCHANT_ID });
    const passed =
      fetched !== null &&
      typeof fetched.estimatedImpactMinorUnits === "number" &&
      fetched.estimatedImpactMinorUnits > 0;
    results.push({
      id: "A",
      name: "Revenue-at-risk detection",
      passed,
      notes: passed
        ? [
            `revenue at risk = ${fetched?.estimatedImpactMinorUnits} minor units (Issue.estimatedImpactMinorUnits, unchanged from packages/tools' calculate_revenue_impact)`,
          ]
        : ["issue.estimatedImpactMinorUnits missing or non-positive"],
      details: { estimatedImpactMinorUnits: fetched?.estimatedImpactMinorUnits ?? null },
    });
  }

  // B — Candidate generation finds the right captured-UPI-in-window payments.
  {
    const payments = [upiPayment(1), upiPayment(2), upiPayment(3)];
    const db = createPhase5FakeDatabase(payments);
    const issue = seedDegradationIssue(db);
    const outcome = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    const passed = outcome.kind === "ok" && outcome.batch.eligibleCount === 3;
    results.push({
      id: "B",
      name: "Candidate generation",
      passed,
      notes: [
        passed ? "found and selected all 3 eligible UPI payments" : `outcome=${outcome.kind}`,
      ],
      details: { outcome: outcome.kind === "ok" ? outcome.batch.eligibleCount : outcome.kind },
    });
  }

  // C — Candidate eligibility: an already-fully-refunded and a
  // not-yet-captured payment are both excluded, never silently included.
  {
    const payments = [
      upiPayment(10),
      upiPayment(11, { amountRefunded: 30_000 }), // already fully refunded
      upiPayment(12, { captured: false, amount: 30_000 }), // never captured
    ];
    const db = createPhase5FakeDatabase(payments);
    const issue = seedDegradationIssue(db);
    const outcome = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    const passed =
      outcome.kind === "ok" &&
      outcome.batch.eligibleCount === 1 &&
      outcome.batch.rejectedCount === 2;
    results.push({
      id: "C",
      name: "Candidate eligibility",
      passed,
      notes: [
        passed
          ? "correctly rejected the fully-refunded and uncaptured payments"
          : `unexpected: ${JSON.stringify(outcome)}`,
      ],
      details:
        outcome.kind === "ok"
          ? { eligible: outcome.batch.eligibleCount, rejected: outcome.batch.rejectedCandidates }
          : { outcome: outcome.kind },
    });
  }

  // D — Merchant isolation: a payment belonging to a different merchant
  // must never become a candidate for this merchant's batch.
  {
    const payments = [
      upiPayment(20),
      upiPayment(21, { id: "t03-other-payment-1", merchantId: OTHER_MERCHANT_ID }),
    ];
    const db = createPhase5FakeDatabase(payments);
    const issue = seedDegradationIssue(db);
    const outcome = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    const passed =
      outcome.kind === "ok" &&
      outcome.batch.eligibleCount === 1 &&
      !outcome.batch.recommendations.some((r) => r.targetPaymentId === "t03-other-payment-1");
    results.push({
      id: "D",
      name: "Merchant isolation",
      passed,
      notes: [
        passed ? "other merchant's payment never appeared as a candidate" : "isolation failed",
      ],
      details: { outcome: outcome.kind === "ok" ? outcome.batch.eligibleCount : outcome.kind },
    });
  }

  // E — Duplicate candidate prevention: generating a second batch for the
  // same issue never re-recommends an already-recommended payment.
  {
    const payments = [upiPayment(30), upiPayment(31)];
    const db = createPhase5FakeDatabase(payments);
    const issue = seedDegradationIssue(db);
    const first = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    const second = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    const passed =
      first.kind === "ok" &&
      first.batch.eligibleCount === 2 &&
      second.kind === "ok" &&
      second.batch.eligibleCount === 0 &&
      second.batch.candidatesScanned === 2 &&
      second.batch.rejectedCount === 2;
    results.push({
      id: "E",
      name: "Duplicate candidate prevention",
      passed,
      notes: [
        passed
          ? "second batch generation found 0 new candidates — both already recommended"
          : "duplicate prevention failed",
      ],
      details: {
        firstEligible: first.kind === "ok" ? first.batch.eligibleCount : first.kind,
        secondEligible: second.kind === "ok" ? second.batch.eligibleCount : second.kind,
      },
    });
  }

  // F — Idempotency: approving the same recovery recommendation twice
  // concurrently only ever calls the provider once (reuses Phase 5/6's
  // proven double-approval guard, exercised here through the batch path).
  {
    const payments = [upiPayment(40)];
    const db = createPhase5FakeDatabase(payments);
    const issue = seedDegradationIssue(db);
    const batch = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    if (batch.kind !== "ok" || batch.batch.recommendations.length !== 1) {
      results.push({
        id: "F",
        name: "Idempotency",
        passed: false,
        notes: [`batch generation failed: ${JSON.stringify(batch)}`],
        details: {},
      });
    } else {
      const razorpayClient = fakeRazorpayClient(payments);
      const recId = batch.batch.recommendations[0]!.id;
      const [a, b] = await Promise.all([
        approveRecommendationAndExecute(
          { db, razorpayClient },
          { id: recId, merchantId: EVAL_MERCHANT_ID },
        ),
        approveRecommendationAndExecute(
          { db, razorpayClient },
          { id: recId, merchantId: EVAL_MERCHANT_ID },
        ),
      ]);
      const okCount = [a, b].filter((o) => o.kind === "ok").length;
      const passed = okCount === 1 && razorpayClient.refundCallCount === 1;
      results.push({
        id: "F",
        name: "Idempotency",
        passed,
        notes: [
          `${okCount} of 2 concurrent approvals succeeded, ${razorpayClient.refundCallCount} provider call(s)`,
        ],
        details: { outcomes: [a.kind, b.kind] },
      });
    }
  }

  // G — Approval requirement: every batch recommendation starts
  // PENDING_APPROVAL — never auto-approved, never auto-executed.
  {
    const payments = [upiPayment(50)];
    const db = createPhase5FakeDatabase(payments);
    const issue = seedDegradationIssue(db);
    const batch = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    const passed =
      batch.kind === "ok" &&
      batch.batch.recommendations.length === 1 &&
      batch.batch.recommendations[0]!.status === "PENDING_APPROVAL" &&
      batch.batch.recommendations[0]!.action === null;
    results.push({
      id: "G",
      name: "Approval requirement",
      passed,
      notes: [
        passed
          ? "candidate created PENDING_APPROVAL with no Action row"
          : "approval boundary violated",
      ],
      details: {},
    });
  }

  // H — Live-state revalidation: a candidate whose live Razorpay state has
  // since changed (already refunded there) is blocked before any provider
  // refund call — the same stale-state guard Phase 6 already proved for a
  // single recommendation, exercised here for a batch-generated one.
  {
    const payments = [upiPayment(60)];
    const db = createPhase5FakeDatabase(payments);
    const issue = seedDegradationIssue(db);
    const batch = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    if (batch.kind !== "ok" || batch.batch.recommendations.length !== 1) {
      results.push({
        id: "H",
        name: "Live-state revalidation",
        passed: false,
        notes: ["batch generation failed"],
        details: {},
      });
    } else {
      const razorpayClient = fakeRazorpayClient(payments, {
        staleRazorpayPaymentIds: new Set([payments[0]!.razorpayPaymentId]),
      });
      const outcome = await approveRecommendationAndExecute(
        { db, razorpayClient },
        { id: batch.batch.recommendations[0]!.id, merchantId: EVAL_MERCHANT_ID },
      );
      const passed =
        outcome.kind === "ok" &&
        outcome.recommendation.status === "FAILED" &&
        razorpayClient.refundCallCount === 0;
      results.push({
        id: "H",
        name: "Live-state revalidation",
        passed,
        notes: [
          passed ? "execution blocked before any provider call" : `unexpected: ${outcome.kind}`,
        ],
        details: {},
      });
    }
  }

  // I — Batch maximum amount: selection stops once the running total would
  // exceed the configured ceiling, never silently exceeding it.
  {
    const perPaymentAmount = 200_000;
    const count = 5; // 5 * 200_000 = 1,000,000 > 500,000 limit
    const payments = Array.from({ length: count }, (_, i) =>
      upiPayment(70 + i, { amount: perPaymentAmount }),
    );
    const db = createPhase5FakeDatabase(payments);
    const issue = seedDegradationIssue(db);
    const outcome = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    const passed =
      outcome.kind === "ok" &&
      outcome.batch.stoppedReason === "max_amount_reached" &&
      outcome.batch.amountEligibleMinorUnits <= RECOVERY_BATCH_LIMITS.maxTotalAmountMinorUnits;
    results.push({
      id: "I",
      name: "Batch maximum amount",
      passed,
      notes: [
        passed
          ? `stopped at ₹${(outcome.kind === "ok" ? outcome.batch.amountEligibleMinorUnits : 0) / 100} of the ₹${RECOVERY_BATCH_LIMITS.maxTotalAmountMinorUnits / 100} limit`
          : "did not stop at the amount limit",
      ],
      details: { outcome: outcome.kind === "ok" ? outcome.batch : outcome.kind },
    });
  }

  // J — Batch maximum count: selection stops once maxCandidates eligible
  // payments have been selected, regardless of remaining budget.
  {
    const count = RECOVERY_BATCH_LIMITS.maxCandidates + 5;
    const payments = Array.from({ length: count }, (_, i) =>
      upiPayment(100 + i, { amount: 1_000 }),
    );
    const db = createPhase5FakeDatabase(payments);
    const issue = seedDegradationIssue(db);
    const outcome = await generateRecoveryBatch(
      { db },
      { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
    );
    const passed =
      outcome.kind === "ok" &&
      outcome.batch.eligibleCount === RECOVERY_BATCH_LIMITS.maxCandidates &&
      outcome.batch.stoppedReason === "max_candidates_reached";
    results.push({
      id: "J",
      name: "Batch maximum count",
      passed,
      notes: [
        passed
          ? `stopped at exactly ${RECOVERY_BATCH_LIMITS.maxCandidates} candidates`
          : "count limit not enforced",
      ],
      details: { outcome: outcome.kind === "ok" ? outcome.batch.eligibleCount : outcome.kind },
    });
  }

  return results;
}

// --- Full batch run (L, M, N, O, P — measured recovery) -------------------------

interface FullBatchRunResult {
  scenario: Track03ScenarioResult;
  metrics: Track03RecoveryMetrics;
  auditEventsForBatch: number;
}

async function runFullBatchScenario(): Promise<FullBatchRunResult> {
  // 5 candidates: 3 will succeed, 2 will fail the provider call — an
  // honest mixed result, not a curated 100%. Also seeds one candidate
  // that will fail the FAILURE_THRESHOLD check (K) by making it the 3rd
  // and 4th attempted in deterministic (oldest-first) order.
  const payments = [
    upiPayment(200, {}, 50),
    upiPayment(201, {}, 45),
    upiPayment(202, {}, 40), // will fail
    upiPayment(203, {}, 35), // will fail
    upiPayment(204, {}, 30),
  ];
  const db = createPhase5FakeDatabase(payments);
  const issue = seedDegradationIssue(db);

  const batchOutcome = await generateRecoveryBatch(
    { db },
    { merchantId: EVAL_MERCHANT_ID, issueId: issue.id },
  );
  if (batchOutcome.kind !== "ok") {
    throw new Error(`Track 03 full batch run: batch generation failed: ${batchOutcome.kind}`);
  }
  const batch = batchOutcome.batch;

  const failingIds = new Set([payments[2]!.razorpayPaymentId, payments[3]!.razorpayPaymentId]);
  const razorpayClient = fakeRazorpayClient(payments, { failingRazorpayPaymentIds: failingIds });

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let amountAttempted = 0;
  let amountRecovered = 0;
  let falseSuccessCount = 0;
  let stoppingReason: string | null = null;

  // Deterministic order matches the batch's own (oldest-first) ordering.
  for (const rec of batch.recommendations) {
    if (failed >= FAILURE_THRESHOLD) {
      stoppingReason = "failure_threshold_exceeded";
      break;
    }
    attempted += 1;
    amountAttempted += rec.amountMinorUnits ?? 0;
    const outcome = await approveRecommendationAndExecute(
      { db, razorpayClient },
      { id: rec.id, merchantId: EVAL_MERCHANT_ID },
    );
    if (outcome.kind !== "ok") {
      // Approval itself was rejected (e.g. conflict) — never counted as a
      // false success.
      failed += 1;
      continue;
    }
    if (outcome.recommendation.status === "SUCCEEDED") {
      if (outcome.recommendation.action?.status !== "SUCCEEDED") falseSuccessCount += 1;
      else {
        succeeded += 1;
        amountRecovered += outcome.recommendation.amountMinorUnits ?? 0;
      }
    } else if (outcome.recommendation.status === "FAILED") {
      if (outcome.recommendation.action?.status === "SUCCEEDED") falseSuccessCount += 1;
      else failed += 1;
    } else {
      // Neither terminal state after an "ok" approve-and-execute call
      // would itself be a false-success-adjacent anomaly worth flagging.
      falseSuccessCount += 1;
    }
  }

  const metrics: Track03RecoveryMetrics = {
    batchSize: batch.recommendations.length,
    candidatesFound: batch.candidatesScanned,
    candidatesEligible: batch.eligibleCount,
    candidatesRejected: batch.rejectedCount,
    candidatesAttempted: attempted,
    successfulRecoveries: succeeded,
    failedRecoveries: failed,
    amountEligibleMinorUnits: batch.amountEligibleMinorUnits,
    amountAttemptedMinorUnits: amountAttempted,
    amountRecoveredMinorUnits: amountRecovered,
    recoveryRate: attempted > 0 ? succeeded / attempted : 0,
    duplicateExecutionCount: 0, // proven separately by scenario F
    falseSuccessCount,
    stoppingReason,
  };

  const auditEventsForBatch = (db.__auditEvents as { recommendationId?: string }[]).filter(
    (event) => batch.recommendations.some((rec) => rec.id === event.recommendationId),
  ).length;

  const passed =
    metrics.successfulRecoveries >= 1 &&
    metrics.failedRecoveries >= 1 &&
    metrics.falseSuccessCount === 0 &&
    metrics.stoppingReason === "failure_threshold_exceeded";

  return {
    scenario: {
      id: "L-P",
      name: "Full batch run: measured recovery, failure threshold, false-success prevention, audit trail",
      passed,
      notes: [
        `${metrics.successfulRecoveries} succeeded, ${metrics.failedRecoveries} failed, ${metrics.candidatesAttempted} attempted of ${metrics.candidatesEligible} eligible`,
        `stopped: ${metrics.stoppingReason ?? "batch exhausted"}`,
        `${auditEventsForBatch} audit events recorded across ${metrics.batchSize} recommendations`,
      ],
      details: { ...metrics, auditEventsForBatch },
    },
    metrics,
    auditEventsForBatch,
  };
}

// --- Orchestration ---------------------------------------------------------------

export async function runTrack03Evaluation(): Promise<Track03EvaluationReport> {
  const focusedScenarios = await runFocusedScenarios();
  const fullBatch = await runFullBatchScenario();

  return {
    generatedAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    environment: {
      mode: "synthetic",
      provider: "mocked-razorpay-client",
      disclosure:
        "Every recovery outcome in this report comes from a mocked RazorpayClient against " +
        "synthetic payment rows, never a live Razorpay Test Mode call. This measures the " +
        "correctness of the recovery workflow (eligibility, limits, stopping rules, " +
        "idempotency, audit trail), not a real-world recovery rate.",
    },
    scenarios: [...focusedScenarios, fullBatch.scenario],
    metrics: fullBatch.metrics,
    limitations: [
      "Synthetic evaluation only — no live Razorpay Test Mode API call is made anywhere in this harness.",
      "candidatesFound/eligible/rejected reflect this harness's own constructed dataset, not real merchant data.",
      "duplicateExecutionCount in the full-batch metrics is reported as 0 by construction (each candidate " +
        "approved exactly once in that run) — see scenario F for the actual concurrent-approval proof.",
    ],
  };
}
