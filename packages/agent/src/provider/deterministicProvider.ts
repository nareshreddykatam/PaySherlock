import type { LLMProvider, NarrationFacts, Narration, PlanRequest, RawPlan } from "./types.js";
import { DEFAULT_INVESTIGATION_STEPS } from "../planner/defaultSteps.js";

/**
 * Zero-dependency default provider. Always proposes the same canonical
 * investigation plan (every registered tool, sensible default args) and
 * considers every catalog hypothesis worth investigating — it has no
 * "opinion" of its own. The deterministic evidence/verification pipeline
 * (packages/agent/src/hypotheses, .../evidence), not this class, decides
 * the actual outcome from real tool data.
 *
 * This is what keeps PaySherlock runnable and testable without network
 * access or AI provider credentials (it's the default when AI_PROVIDER
 * isn't configured — see provider/factory.ts), and it's what the test
 * suite and evaluation harness use exclusively. See docs/decisions.
 */
export class DeterministicProvider implements LLMProvider {
  readonly name = "deterministic";

  plan(request: PlanRequest): Promise<RawPlan> {
    const availableToolNames = new Set(request.toolCatalog.map((tool) => tool.name));
    return Promise.resolve({
      objective: `Investigate: ${request.question}`,
      steps: DEFAULT_INVESTIGATION_STEPS.filter((step) => availableToolNames.has(step.tool)),
      candidateHypothesisIds: request.candidateHypothesisCatalog.map((h) => h.id),
    });
  }

  narrate(facts: NarrationFacts): Promise<Narration> {
    const impactSuffix = facts.businessImpactSummary
      ? ` Estimated impact: ${facts.businessImpactSummary}.`
      : "";
    const summary = facts.rootCauseStatement
      ? `Investigation into "${facts.question}" found a likely cause: ${facts.rootCauseStatement}.${impactSuffix}`
      : `Investigation into "${facts.question}" did not find a statistically significant anomaly in the available data.`;

    const recommendations: string[] = facts.rootCauseStatement
      ? [
          `Investigate and address: ${facts.rootCauseStatement}.`,
          "Monitor the affected metric over the next few days to confirm recovery.",
        ]
      : ["No action needed — continue routine monitoring."];

    return Promise.resolve({ summary, recommendations });
  }
}
