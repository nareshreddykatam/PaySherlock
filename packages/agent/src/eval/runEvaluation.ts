import { createToolRegistry } from "@paysherlock/tools";
import { DeterministicProvider } from "../provider/deterministicProvider.js";
import { runInvestigation } from "../runtime/agent.js";
import type { ToolCallLogEntry } from "../runtime/context.js";
import { HYPOTHESIS_CATALOG } from "../hypotheses/catalog.js";
import {
  EVAL_MERCHANT_ID,
  EVAL_SCENARIOS,
  EVAL_TIME_RANGE,
  type EvalScenario,
} from "./scenarios.js";

const KNOWN_TOOL_NAMES = new Set([
  "get_payments",
  "get_payment_failures",
  "compare_periods",
  "segment_payments",
  "analyze_failure_codes",
  "get_refunds",
  "calculate_revenue_impact",
]);

export interface ScenarioEvalResult {
  scenario: string;
  passed: boolean;
  rootCauseMatch: boolean;
  actualRootCause: string | undefined;
  expectedRootCause: string | undefined;
  /** "n/a" when the scenario has no expected impact range to check. */
  impactInRange: boolean | "n/a";
  stepsExecuted: number;
  toolCalls: number;
  toolCallSuccesses: number;
  toolCallFailures: number;
  invalidToolCalls: number;
  evidenceCount: number;
  evidenceTracesToKnownTool: boolean;
}

export interface EvaluationMetrics {
  rootCauseAccuracy: number;
  evidenceAccuracy: number;
  falsePositiveRate: number;
  toolExecutionSuccessRate: number;
  invalidToolCallRate: number;
  averageInvestigationSteps: number;
}

export interface EvaluationReport {
  results: ScenarioEvalResult[];
  metrics: EvaluationMetrics;
}

function statementForHypothesisId(id: string | undefined): string | undefined {
  return HYPOTHESIS_CATALOG.find((h) => h.id === id)?.statement;
}

/**
 * Runs the full agent pipeline against every scenario in `scenarios`
 * (default: the 5 required Phase 2 scenarios), using the deterministic
 * provider so this never depends on network access or credentials, and
 * scores it — not just on whether the textual answer "sounds right", but
 * on whether the right tools ran and the right evidence-backed conclusion
 * came out (Phase 2 brief, evaluation section).
 */
export async function runEvaluation(
  scenarios: EvalScenario[] = EVAL_SCENARIOS,
): Promise<EvaluationReport> {
  const registry = createToolRegistry();
  const provider = new DeterministicProvider();
  const results: ScenarioEvalResult[] = [];

  for (const scenario of scenarios) {
    const toolCalls: ToolCallLogEntry[] = [];
    const result = await runInvestigation({
      request: {
        question: scenario.question,
        merchantId: EVAL_MERCHANT_ID,
        timeRange: EVAL_TIME_RANGE,
      },
      provider,
      registry,
      db: scenario.db,
      onToolCall: (entry) => toolCalls.push(entry),
    });

    const expectedStatement = statementForHypothesisId(scenario.expectedRootCauseId);
    const rootCauseMatch =
      expectedStatement === undefined
        ? result.rootCause === undefined
        : result.rootCause === expectedStatement;

    let impactInRange: boolean | "n/a" = "n/a";
    if (scenario.expectedImpactRangeMinorUnits) {
      const impact = result.businessImpact?.estimatedImpactMinorUnits;
      const [min, max] = scenario.expectedImpactRangeMinorUnits;
      impactInRange = impact !== undefined && impact >= min && impact <= max;
    }

    const toolCallSuccesses = toolCalls.filter((c) => c.success).length;
    const invalidToolCalls = toolCalls.filter(
      (c) =>
        !c.success && (c.error?.includes("Unknown tool") || c.error?.includes("Invalid input")),
    ).length;
    const evidenceTracesToKnownTool = result.evidence.every((e) => KNOWN_TOOL_NAMES.has(e.source));

    results.push({
      scenario: scenario.name,
      passed: rootCauseMatch && impactInRange !== false,
      rootCauseMatch,
      actualRootCause: result.rootCause,
      expectedRootCause: expectedStatement,
      impactInRange,
      stepsExecuted: result.meta.stepsExecuted,
      toolCalls: toolCalls.length,
      toolCallSuccesses,
      toolCallFailures: toolCalls.length - toolCallSuccesses,
      invalidToolCalls,
      evidenceCount: result.evidence.length,
      evidenceTracesToKnownTool,
    });
  }

  const total = Math.max(results.length, 1);
  const noAnomalyResults = results.filter(
    (_, i) => scenarios[i]!.expectedRootCauseId === undefined,
  );
  const totalToolCalls = results.reduce((sum, r) => sum + r.toolCalls, 0);
  const totalToolSuccesses = results.reduce((sum, r) => sum + r.toolCallSuccesses, 0);
  const totalInvalidToolCalls = results.reduce((sum, r) => sum + r.invalidToolCalls, 0);

  const metrics: EvaluationMetrics = {
    rootCauseAccuracy: results.filter((r) => r.rootCauseMatch).length / total,
    evidenceAccuracy: results.filter((r) => r.evidenceTracesToKnownTool).length / total,
    falsePositiveRate:
      noAnomalyResults.length > 0
        ? noAnomalyResults.filter((r) => !r.rootCauseMatch).length / noAnomalyResults.length
        : 0,
    toolExecutionSuccessRate: totalToolCalls > 0 ? totalToolSuccesses / totalToolCalls : 1,
    invalidToolCallRate: totalToolCalls > 0 ? totalInvalidToolCalls / totalToolCalls : 0,
    averageInvestigationSteps: results.reduce((sum, r) => sum + r.stepsExecuted, 0) / total,
  };

  return { results, metrics };
}
