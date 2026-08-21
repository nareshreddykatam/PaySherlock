import { describe, expect, it, vi } from "vitest";
import type { InvestigationResult } from "@paysherlock/types";
import { runDetectionForMerchant, type DetectionRunDeps } from "@paysherlock/detection";
import {
  PHASE4_SCENARIOS,
  buildScenarioDatabase,
  EVAL_MERCHANT_ID,
  NOW,
} from "../eval/scenarios.js";

// Uses the same real (deterministic, synthetic) fixtures as the Phase 4
// evaluation harness — real detectors, real persistence functions — but
// stubs runInvestigation directly, so these tests can assert precisely on
// detectionService's OWN orchestration (lifecycle transitions, storm
// prevention, failure handling) without depending on the real Phase 2
// pipeline's exact hypothesis outcome for every case.

const ANOMALOUS_SCENARIO = PHASE4_SCENARIOS.find((s) => s.name.startsWith("A"))!;
const NORMAL_SCENARIO = PHASE4_SCENARIOS.find((s) => s.name.startsWith("E"))!;

function fakeInvestigationResult(
  overrides: Partial<InvestigationResult> = {},
): InvestigationResult {
  return {
    question: "Why did the payment failure rate increase?",
    summary: "Stubbed investigation result.",
    rootCause: "UPI payment failure rate increased significantly",
    confidence: "high",
    businessImpact: {
      estimatedImpactMinorUnits: 172_000,
      currency: "INR",
      basis: "revenue_delta_vs_scaled_baseline",
    },
    evidence: [],
    rejectedHypotheses: [],
    hypotheses: [],
    recommendations: [],
    meta: { investigationId: "inv_stub_1", stepsExecuted: 8, toolCalls: 8, provider: "stub" },
    ...overrides,
  };
}

describe("runDetectionForMerchant", () => {
  it("creates issues and triggers an investigation for a newly-detected anomaly", async () => {
    const clock = { current: NOW };
    const db = buildScenarioDatabase(ANOMALOUS_SCENARIO, () => clock.current);
    const runInvestigation = vi.fn().mockResolvedValue(fakeInvestigationResult());
    const deps: DetectionRunDeps = { db, runInvestigation };

    const summary = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);

    expect(summary.issuesCreated).toBeGreaterThan(0);
    expect(summary.investigationsTriggered).toBe(summary.issuesCreated);
    expect(runInvestigation).toHaveBeenCalled();

    const issues = await db.issue.findMany({ where: { merchantId: EVAL_MERCHANT_ID } });
    for (const issue of issues) {
      expect(issue.status).toBe("IDENTIFIED");
      expect(issue.rootCause).toBe("UPI payment failure rate increased significantly");
      expect(issue.investigationId).toBe("inv_stub_1");
    }
  });

  it("does not create or trigger anything for normal business data", async () => {
    const clock = { current: NOW };
    const db = buildScenarioDatabase(NORMAL_SCENARIO, () => clock.current);
    const runInvestigation = vi.fn();
    const deps: DetectionRunDeps = { db, runInvestigation };

    const summary = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);

    expect(summary.issuesCreated).toBe(0);
    expect(runInvestigation).not.toHaveBeenCalled();
  });

  it("never re-triggers an investigation for an issue that already has one in flight/complete (storm prevention)", async () => {
    const clock = { current: NOW };
    const db = buildScenarioDatabase(ANOMALOUS_SCENARIO, () => clock.current);
    const runInvestigation = vi.fn().mockResolvedValue(fakeInvestigationResult());
    const deps: DetectionRunDeps = { db, runInvestigation };

    const first = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);
    runInvestigation.mockClear();
    const second = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);

    expect(first.issuesCreated).toBeGreaterThan(0);
    expect(second.issuesCreated).toBe(0); // same fingerprint — updated, not duplicated
    expect(second.issuesUpdated).toBe(first.issuesCreated);
    expect(runInvestigation).not.toHaveBeenCalled();

    const issues = await db.issue.findMany({ where: { merchantId: EVAL_MERCHANT_ID } });
    for (const issue of issues) {
      expect(issue.occurrenceCount).toBe(2);
    }
  });

  it("keeps the issue and records a safe error when the automatic investigation fails", async () => {
    const clock = { current: NOW };
    const db = buildScenarioDatabase(ANOMALOUS_SCENARIO, () => clock.current);
    const runInvestigation = vi
      .fn()
      .mockRejectedValue(new Error("provider unreachable: connection reset"));
    const deps: DetectionRunDeps = { db, runInvestigation };

    const summary = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);

    expect(summary.investigationsFailed).toBeGreaterThan(0);
    expect(summary.investigationsTriggered).toBe(0);

    const issues = await db.issue.findMany({ where: { merchantId: EVAL_MERCHANT_ID } });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.status).toBe("INVESTIGATION_FAILED");
      expect(issue.investigationError).toBe("provider unreachable: connection reset");
      expect(issue.investigationId).toBeNull();
    }
  });

  it("retries a previously-failed investigation on a later detection run", async () => {
    const clock = { current: NOW };
    const db = buildScenarioDatabase(ANOMALOUS_SCENARIO, () => clock.current);
    const runInvestigation = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValue(fakeInvestigationResult());
    const deps: DetectionRunDeps = { db, runInvestigation };

    await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);
    const second = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);

    expect(second.investigationsTriggered).toBeGreaterThan(0);
    const issues = await db.issue.findMany({ where: { merchantId: EVAL_MERCHANT_ID } });
    for (const issue of issues) {
      expect(issue.status).toBe("IDENTIFIED");
    }
  });

  it("caps a brand-new issue's severity at WARNING even if the raw detection would be CRITICAL", async () => {
    const clock = { current: NOW };
    const db = buildScenarioDatabase(ANOMALOUS_SCENARIO, () => clock.current);
    const runInvestigation = vi.fn().mockResolvedValue(fakeInvestigationResult());
    const deps: DetectionRunDeps = { db, runInvestigation };

    await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);

    const issues = await db.issue.findMany({ where: { merchantId: EVAL_MERCHANT_ID } });
    expect(issues.some((i: { severity: string }) => i.severity === "CRITICAL")).toBe(false);
  });

  it("auto-resolves an active issue that hasn't been reconfirmed within the staleness window", async () => {
    const clock = { current: NOW };
    const db = buildScenarioDatabase(ANOMALOUS_SCENARIO, () => clock.current);
    const runInvestigation = vi.fn().mockResolvedValue(fakeInvestigationResult());
    const deps: DetectionRunDeps = { db, runInvestigation };

    await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);
    // Jump forward well past the staleness window — far enough that the
    // detection window itself (a trailing 1 hour) no longer overlaps the
    // anomalous data at all, so this run doesn't reconfirm the issue.
    const muchLater = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
    clock.current = muchLater;
    const summary = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, muchLater);

    expect(summary.issuesResolved).toBeGreaterThan(0);
    const issues = await db.issue.findMany({ where: { merchantId: EVAL_MERCHANT_ID } });
    // The originally-detected issues (UPI-related) are no longer being
    // reconfirmed and are auto-resolved. A near-empty trailing window can
    // legitimately surface its own (different, also real) volume-decline
    // signal — that's a separate, correct detection, not a test failure.
    const originalIssues = issues.filter(
      (i: { type: string }) =>
        i.type === "PAYMENT_FAILURE_SPIKE" || i.type === "PAYMENT_METHOD_DEGRADATION",
    );
    expect(originalIssues.length).toBeGreaterThan(0);
    expect(originalIssues.every((i: { status: string }) => i.status === "RESOLVED")).toBe(true);
  });

  it("reports detector errors without throwing", async () => {
    const clock = { current: NOW };
    const db = buildScenarioDatabase(NORMAL_SCENARIO, () => clock.current);
    db.payment.groupBy = vi.fn().mockRejectedValue(new Error("simulated query failure"));
    const runInvestigation = vi.fn();
    const deps: DetectionRunDeps = { db, runInvestigation };

    const summary = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);
    expect(summary.detectorErrors.length).toBeGreaterThan(0);
  });
});
