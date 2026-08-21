import type { ToolRegistry } from "@paysherlock/tools";
import type { CandidateHypothesis, InvestigationStep } from "@paysherlock/types";
import { AgentError } from "@paysherlock/types";
import type { LLMProvider } from "../provider/types.js";
import { HYPOTHESIS_CATALOG } from "../hypotheses/catalog.js";
import { DEFAULT_INVESTIGATION_STEPS } from "./defaultSteps.js";
import { RawPlanSchema } from "./schemas.js";

export interface PlannedInvestigation {
  objective: string;
  steps: InvestigationStep[];
  candidateHypotheses: CandidateHypothesis[];
}

export interface CreatePlanParams {
  provider: LLMProvider;
  registry: ToolRegistry;
  question: string;
  context?: string | undefined;
}

/**
 * Asks the provider for a plan, then enforces the "must not invent
 * unavailable tools/hypotheses" rule (Phase 2 brief, planner section) by
 * filtering the response against what's actually registered — never
 * trusting the provider's output at face value. Falls back to the
 * canonical default plan/full hypothesis catalog if filtering leaves
 * nothing usable, so a malformed or overly-narrow provider response never
 * stalls the investigation.
 */
export async function createInvestigationPlan(
  params: CreatePlanParams,
): Promise<PlannedInvestigation> {
  const toolCatalog = params.registry.catalog();

  const raw = await params.provider.plan({
    question: params.question,
    context: params.context,
    toolCatalog,
    candidateHypothesisCatalog: HYPOTHESIS_CATALOG,
  });

  const parsed = RawPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentError(
      `Provider "${params.provider.name}" returned a malformed plan: ${parsed.error.message}`,
    );
  }

  const validSteps = parsed.data.steps.filter((step) => params.registry.has(step.tool));
  const validHypotheses = parsed.data.candidateHypothesisIds
    .map((id) => HYPOTHESIS_CATALOG.find((h) => h.id === id))
    .filter((h): h is CandidateHypothesis => h !== undefined);

  return {
    objective: parsed.data.objective,
    steps: validSteps.length > 0 ? validSteps : DEFAULT_INVESTIGATION_STEPS,
    candidateHypotheses: validHypotheses.length > 0 ? validHypotheses : HYPOTHESIS_CATALOG,
  };
}
