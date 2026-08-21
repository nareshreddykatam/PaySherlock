import type { CandidateHypothesis, InvestigationStep } from "@paysherlock/types";

/**
 * Provider-independent LLM interface — see docs/decisions for why the
 * agent uses two bounded, structured calls (`plan`, `narrate`) instead of a
 * free-form multi-turn chat loop, and why every provider (including the
 * zero-dependency default) implements the exact same shape.
 */
export interface ToolCatalogEntry {
  name: string;
  description: string;
}

export interface PlanRequest {
  question: string;
  context?: string | undefined;
  toolCatalog: ToolCatalogEntry[];
  candidateHypothesisCatalog: CandidateHypothesis[];
}

export interface RawPlan {
  objective: string;
  steps: InvestigationStep[];
  /** Ids from `candidateHypothesisCatalog` the provider thinks are worth
   * investigating. The provider's opinion is only a starting point — the
   * deterministic verifier decides each hypothesis's real status from
   * evidence, never the provider. */
  candidateHypothesisIds: string[];
}

export interface NarrationFacts {
  question: string;
  rootCauseStatement?: string | undefined;
  confidence?: "low" | "medium" | "high" | undefined;
  businessImpactSummary?: string | undefined;
  supportedEvidenceSummaries: string[];
  rejectedHypothesisStatements: string[];
}

export interface Narration {
  summary: string;
  recommendations: string[];
}

export interface LLMProvider {
  readonly name: string;
  /** Produce an investigation plan (objective, tool-call steps, candidate
   * hypotheses to consider). No tool has run yet. */
  plan(request: PlanRequest): Promise<RawPlan>;
  /** Phrase the already-decided findings in natural language. Must not
   * introduce new numbers or change the decided root cause/confidence —
   * those are fixed by the deterministic pipeline before this is called. */
  narrate(facts: NarrationFacts): Promise<Narration>;
}
