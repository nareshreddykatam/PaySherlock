import { describe, expect, it } from "vitest";
import { createToolRegistry } from "@paysherlock/tools";
import type {
  LLMProvider,
  PlanRequest,
  RawPlan,
  NarrationFacts,
  Narration,
} from "../provider/types.js";
import { createInvestigationPlan } from "../planner/planner.js";
import { HYPOTHESIS_CATALOG, HYPOTHESIS_IDS } from "../hypotheses/catalog.js";
import { DEFAULT_INVESTIGATION_STEPS } from "../planner/defaultSteps.js";

function providerReturning(raw: RawPlan): LLMProvider {
  return {
    name: "fake",
    plan: (_req: PlanRequest) => Promise.resolve(raw),
    narrate: (_facts: NarrationFacts): Promise<Narration> =>
      Promise.resolve({ summary: "", recommendations: [] }),
  };
}

describe("createInvestigationPlan", () => {
  it("passes through a well-formed plan referencing only registered tools/hypotheses", async () => {
    const registry = createToolRegistry();
    const provider = providerReturning({
      objective: "Find out why revenue dropped",
      steps: [{ tool: "get_payments", input: {} }],
      candidateHypothesisIds: [HYPOTHESIS_IDS.UPI_FAILURE_INCREASE],
    });

    const plan = await createInvestigationPlan({ provider, registry, question: "why?" });

    expect(plan.steps).toEqual([{ tool: "get_payments", input: {} }]);
    expect(plan.candidateHypotheses).toHaveLength(1);
    expect(plan.candidateHypotheses[0]!.id).toBe(HYPOTHESIS_IDS.UPI_FAILURE_INCREASE);
  });

  it("drops steps that name a tool not in the registry (planner must not invent unavailable tools)", async () => {
    const registry = createToolRegistry();
    const provider = providerReturning({
      objective: "test",
      steps: [
        { tool: "get_payments", input: {} },
        { tool: "delete_all_payments", input: {} },
      ],
      candidateHypothesisIds: [HYPOTHESIS_IDS.UPI_FAILURE_INCREASE],
    });

    const plan = await createInvestigationPlan({ provider, registry, question: "why?" });

    expect(plan.steps).toEqual([{ tool: "get_payments", input: {} }]);
  });

  it("falls back to the default step sequence when every proposed step is invalid", async () => {
    const registry = createToolRegistry();
    const provider = providerReturning({
      objective: "test",
      steps: [{ tool: "not_a_real_tool", input: {} }],
      candidateHypothesisIds: [],
    });

    const plan = await createInvestigationPlan({ provider, registry, question: "why?" });

    expect(plan.steps).toEqual(DEFAULT_INVESTIGATION_STEPS);
    expect(plan.candidateHypotheses).toEqual(HYPOTHESIS_CATALOG);
  });

  it("drops candidate hypothesis ids that aren't in the fixed catalog", async () => {
    const registry = createToolRegistry();
    const provider = providerReturning({
      objective: "test",
      steps: [{ tool: "get_payments", input: {} }],
      candidateHypothesisIds: ["made_up_hypothesis", HYPOTHESIS_IDS.REFUND_SPIKE],
    });

    const plan = await createInvestigationPlan({ provider, registry, question: "why?" });

    expect(plan.candidateHypotheses.map((h) => h.id)).toEqual([HYPOTHESIS_IDS.REFUND_SPIKE]);
  });
});
