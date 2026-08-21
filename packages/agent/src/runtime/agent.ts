import type { Database, ToolRegistry } from "@paysherlock/tools";
import type { InvestigationRequest, InvestigationResult } from "@paysherlock/types";
import { AgentError, InvestigationResultSchema } from "@paysherlock/types";
import type { LLMProvider, NarrationFacts } from "../provider/types.js";
import { createInvestigationPlan } from "../planner/planner.js";
import { runToolPlan } from "./loop.js";
import {
  generateInvestigationId,
  resolveDefaultToolArgs,
  type ToolCallLogEntry,
} from "./context.js";
import { extractFindings } from "../evidence/findings.js";
import { generateHypotheses } from "../hypotheses/generator.js";
import { verifyHypotheses } from "../hypotheses/verifier.js";
import { assembleInvestigationResult, selectRootCause } from "../output/result.js";
import { formatMinorUnitsAsINR } from "../output/formatter.js";

export const DEFAULT_MAX_AGENT_STEPS = 8;

export interface RunInvestigationParams {
  request: InvestigationRequest;
  provider: LLMProvider;
  registry: ToolRegistry;
  db: Database;
  /** Hard cap on tool-call steps — see MAX_AGENT_STEPS in apps/api config.
   * Always bounded; never an unbounded loop. */
  maxSteps?: number;
  /** Optional sink for safe observability records (see runtime/context.ts). */
  onToolCall?: (entry: ToolCallLogEntry) => void;
}

/**
 * The full investigation pipeline (Phase 2 brief's core architecture
 * diagram): plan → bounded tool execution → deterministic hypothesis
 * verification → deterministic root-cause ranking → LLM narration of the
 * already-decided facts → validated InvestigationResult. The LLM never
 * touches the database, Razorpay credentials, or a financial action —
 * it only ever sees structured tool results and structured facts.
 */
export async function runInvestigation(
  params: RunInvestigationParams,
): Promise<InvestigationResult> {
  const investigationId = generateInvestigationId();
  const maxSteps =
    params.maxSteps && params.maxSteps > 0 ? params.maxSteps : DEFAULT_MAX_AGENT_STEPS;

  const plan = await createInvestigationPlan({
    provider: params.provider,
    registry: params.registry,
    question: params.request.question,
    context: params.request.context,
  });

  const defaultArgs = resolveDefaultToolArgs(params.request);
  const { toolResults, stepsExecuted } = await runToolPlan({
    investigationId,
    steps: plan.steps,
    registry: params.registry,
    ctx: { merchantId: params.request.merchantId, db: params.db },
    defaultArgs,
    maxSteps,
    onStep: params.onToolCall,
  });

  const findings = extractFindings(toolResults);
  const pendingHypotheses = generateHypotheses(plan.candidateHypotheses);
  const { hypotheses, evidence } = verifyHypotheses(pendingHypotheses, findings);

  const rootCause = selectRootCause(hypotheses);
  const rejected = hypotheses.filter((h) => h.status === "REJECTED").map((h) => h.statement);
  const businessImpactSummary =
    rootCause && findings.revenueImpact
      ? `${formatMinorUnitsAsINR(findings.revenueImpact.estimatedImpactMinorUnits)}${
          findings.revenueImpact.estimatedImpactMinorUnits < 0 ? " (above baseline)" : ""
        }`
      : undefined;

  const narrationFacts: NarrationFacts = {
    question: params.request.question,
    rootCauseStatement: rootCause?.statement,
    confidence:
      rootCause?.confidence !== undefined
        ? rootCause.confidence >= 0.75
          ? "high"
          : rootCause.confidence >= 0.6
            ? "medium"
            : "low"
        : undefined,
    businessImpactSummary,
    supportedEvidenceSummaries: evidence
      .filter((item) => rootCause && item.supportsHypothesisIds.includes(rootCause.id))
      .map((item) => item.comparison ?? `${item.metric}: ${item.observedValue}`),
    rejectedHypothesisStatements: rejected,
  };

  let narration;
  try {
    narration = await params.provider.narrate(narrationFacts);
  } catch (cause) {
    throw new AgentError(
      `Provider "${params.provider.name}" failed to narrate the investigation result`,
      { cause },
    );
  }

  const result = assembleInvestigationResult({
    question: params.request.question,
    hypotheses,
    evidence,
    revenueImpact: findings.revenueImpact,
    narration,
    investigationId,
    stepsExecuted,
    toolCallCount: toolResults.length,
    providerName: params.provider.name,
  });

  const parsed = InvestigationResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new AgentError(`Assembled an invalid InvestigationResult: ${parsed.error.message}`);
  }
  return parsed.data;
}
