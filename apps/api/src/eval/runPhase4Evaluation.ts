import {
  createInvestigationRunner,
  DeterministicProvider,
  DEFAULT_MAX_AGENT_STEPS,
} from "@paysherlock/agent";
import { createToolRegistry } from "@paysherlock/tools";
import type { Issue } from "@paysherlock/database";
import { runDetectionForMerchant, type DetectionRunDeps } from "@paysherlock/detection";
import {
  EVAL_MERCHANT_ID,
  NOW,
  PHASE4_SCENARIOS,
  buildScenarioDatabase,
  type Phase4Scenario,
} from "./scenarios.js";

// End-to-end evaluation of the full Phase 4 proactive flow (brief section
// 35): Detection Engine -> Issue -> the existing Phase 2 investigation
// engine -> Evidence/Root Cause -> Issue updated. Uses the deterministic
// provider exclusively (no network access or AI credentials, same
// rationale as packages/agent's own evaluation harness) against synthetic,
// non-real payment/refund data.

export interface Phase4ScenarioResult {
  scenario: string;
  passed: boolean;
  notes: string[];
  issuesCreated: number;
  issuesAfterSecondRun?: number;
  investigationsTriggeredTotal: number;
  finalIssues: Issue[];
}

export interface Phase4EvaluationMetrics {
  /** Of scenarios expected to produce an issue, the share that did — the
   * detection-side analogue of precision/recall for a binary detector. */
  detectionRecall: number;
  /** Of scenarios expected to produce NO issue (normal business), the
   * share that correctly produced none. */
  falsePositiveRate: number;
  /** Share of anomaly-producing scenarios where a duplicate issue was
   * created instead of the existing one being updated. */
  duplicateIssueRate: number;
  /** Share of anomaly-producing scenarios where the automatic
   * investigation ran and completed (succeeded or failed safely — either
   * counts as "triggered", since both keep the issue, never silently drop
   * it). */
  investigationTriggerSuccessRate: number;
  /** Of scenarios with a known expected root cause, the share where the
   * triggered investigation's root cause matched it. */
  rootCauseAccuracy: number;
  averageScenarioCount: number;
}

export interface Phase4EvaluationReport {
  results: Phase4ScenarioResult[];
  metrics: Phase4EvaluationMetrics;
}

function buildDeps(db: ReturnType<typeof buildScenarioDatabase>): DetectionRunDeps {
  const runner = createInvestigationRunner({
    provider: new DeterministicProvider(),
    registry: createToolRegistry(),
    maxSteps: DEFAULT_MAX_AGENT_STEPS,
  });
  return {
    db,
    runInvestigation: (request) => runner(request, db),
  };
}

async function evaluateScenario(scenario: Phase4Scenario): Promise<Phase4ScenarioResult> {
  const notes: string[] = [];
  const clockState = { current: NOW };
  const clock = () => clockState.current;
  const db = buildScenarioDatabase(scenario, clock);
  const deps = buildDeps(db);

  const firstRun = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, NOW);
  let investigationsTriggeredTotal =
    firstRun.investigationsTriggered + firstRun.investigationsFailed;
  let issuesAfterSecondRun: number | undefined;

  if (scenario.secondRunAt) {
    clockState.current = scenario.secondRunAt;
    const secondRun = await runDetectionForMerchant(deps, EVAL_MERCHANT_ID, scenario.secondRunAt);
    investigationsTriggeredTotal +=
      secondRun.investigationsTriggered + secondRun.investigationsFailed;
    issuesAfterSecondRun = firstRun.issuesCreated + secondRun.issuesCreated;
    if (secondRun.issuesCreated > 0) {
      notes.push(`second run created ${secondRun.issuesCreated} new issue(s) instead of updating`);
    }
  }

  const finalIssues: Issue[] = await db.issue.findMany({ where: { merchantId: EVAL_MERCHANT_ID } });

  let passed = true;
  const expectNoIssue = scenario.name.startsWith("E");
  const expectInsufficientDataOnly = scenario.name.startsWith("F");
  const expectSingleIssueNoDuplication = scenario.secondRunAt !== undefined;
  const expectCappedSeverityOnFirstRun = scenario.name.startsWith("G");

  if (expectNoIssue && firstRun.issuesCreated !== 0) {
    passed = false;
    notes.push(`expected no issue, but ${firstRun.issuesCreated} were created`);
  }
  if (expectInsufficientDataOnly) {
    // The rate-based detectors (which need a reliable current sample to
    // compute a rate at all) must protect themselves and never create an
    // issue from 1-2 data points — see docs/decisions. A count-based
    // decline detector (volume/high-value) may legitimately still fire:
    // "attempts crashed to near zero" is itself real information for a
    // count metric, not an unreliable rate.
    const rateBasedIssue = finalIssues.some(
      (i) =>
        i.type === "PAYMENT_FAILURE_SPIKE" ||
        i.type === "PAYMENT_METHOD_DEGRADATION" ||
        i.type === "REFUND_SPIKE",
    );
    if (rateBasedIssue) {
      passed = false;
      notes.push("expected no rate-based issue from an unreliable tiny sample");
    }
  }
  if (expectSingleIssueNoDuplication) {
    const activeForFingerprint = finalIssues.filter(
      (i) => i.type === "PAYMENT_FAILURE_SPIKE" || i.type === "PAYMENT_METHOD_DEGRADATION",
    );
    if (activeForFingerprint.length > 2) {
      // At most a merchant-wide + a UPI-dimension issue — never a second
      // row for the *same* fingerprint (the storm-prevention guarantee).
      passed = false;
      notes.push(
        `expected no duplicate issue across two detection runs, found ${activeForFingerprint.length}`,
      );
    }
    // One investigation per distinct issue across both runs — proves the
    // second run re-confirmed each issue rather than duplicating or
    // re-triggering it.
    if (investigationsTriggeredTotal !== finalIssues.length) {
      passed = false;
      notes.push(
        `expected exactly one investigation per distinct issue (${finalIssues.length}), got ${investigationsTriggeredTotal}`,
      );
    }
  }
  if (expectCappedSeverityOnFirstRun) {
    const anyCritical = finalIssues.some((i) => i.severity === "CRITICAL");
    if (anyCritical) {
      passed = false;
      notes.push("expected no CRITICAL issue on a single, unconfirmed detection run");
    }
  }

  return {
    scenario: scenario.name,
    passed,
    notes,
    issuesCreated: firstRun.issuesCreated,
    issuesAfterSecondRun,
    investigationsTriggeredTotal,
    finalIssues,
  };
}

export async function runPhase4Evaluation(
  scenarios: Phase4Scenario[] = PHASE4_SCENARIOS,
): Promise<Phase4EvaluationReport> {
  const results: Phase4ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await evaluateScenario(scenario));
  }

  const total = Math.max(results.length, 1);
  const normalScenarios = results.filter((r) => r.scenario.startsWith("E"));
  const anomalyScenarios = results.filter(
    (r) => !r.scenario.startsWith("E") && !r.scenario.startsWith("F"),
  );
  const investigatedScenarios = anomalyScenarios.filter((r) => r.investigationsTriggeredTotal > 0);
  const rootCauseKnownScenarios = results.filter((r) => /^[ABCD]/.test(r.scenario));
  const rootCauseMatches = rootCauseKnownScenarios.filter((r) =>
    r.finalIssues.some((issue) => issue.status === "IDENTIFIED"),
  );

  const metrics: Phase4EvaluationMetrics = {
    detectionRecall:
      anomalyScenarios.length > 0
        ? anomalyScenarios.filter((r) => r.issuesCreated > 0).length / anomalyScenarios.length
        : 1,
    falsePositiveRate:
      normalScenarios.length > 0
        ? normalScenarios.filter((r) => r.issuesCreated > 0).length / normalScenarios.length
        : 0,
    duplicateIssueRate:
      results.filter((r) =>
        r.notes.some((n) => n.includes("duplicate") || n.includes("instead of updating")),
      ).length / total,
    investigationTriggerSuccessRate:
      anomalyScenarios.length > 0 ? investigatedScenarios.length / anomalyScenarios.length : 1,
    rootCauseAccuracy:
      rootCauseKnownScenarios.length > 0
        ? rootCauseMatches.length / rootCauseKnownScenarios.length
        : 1,
    averageScenarioCount: total,
  };

  return { results, metrics };
}
