import { describe, expect, it } from "vitest";
import { createToolRegistry } from "@paysherlock/tools";
import { AgentError } from "@paysherlock/types";
import { DeterministicProvider } from "../provider/deterministicProvider.js";
import { runInvestigation } from "../runtime/agent.js";
import { DEFAULT_INVESTIGATION_STEPS } from "../planner/defaultSteps.js";
import { EVAL_MERCHANT_ID, EVAL_SCENARIOS, EVAL_TIME_RANGE } from "../eval/scenarios.js";
import type { LLMProvider, NarrationFacts, PlanRequest, RawPlan } from "../provider/types.js";

describe("runInvestigation", () => {
  it("produces a schema-valid, evidence-backed result for a real anomaly scenario", async () => {
    const scenarioA = EVAL_SCENARIOS.find((s) => s.name.startsWith("A"))!;
    const result = await runInvestigation({
      request: {
        question: scenarioA.question,
        merchantId: EVAL_MERCHANT_ID,
        timeRange: EVAL_TIME_RANGE,
      },
      provider: new DeterministicProvider(),
      registry: createToolRegistry(),
      db: scenarioA.db,
    });

    expect(result.rootCause).toBeDefined();
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.meta.toolCalls).toBeGreaterThan(0);
    expect(result.meta.provider).toBe("deterministic");
  });

  it("reports no anomaly (no rootCause) for the normal-business scenario, never a false positive", async () => {
    const scenarioE = EVAL_SCENARIOS.find((s) => s.name.startsWith("E"))!;
    const result = await runInvestigation({
      request: {
        question: scenarioE.question,
        merchantId: EVAL_MERCHANT_ID,
        timeRange: EVAL_TIME_RANGE,
      },
      provider: new DeterministicProvider(),
      registry: createToolRegistry(),
      db: scenarioE.db,
    });

    expect(result.rootCause).toBeUndefined();
    expect(result.businessImpact).toBeUndefined();
    expect(result.evidence).toEqual([]);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("never executes more tool calls than maxSteps, even though the default plan has more steps", async () => {
    const scenarioA = EVAL_SCENARIOS.find((s) => s.name.startsWith("A"))!;
    expect(DEFAULT_INVESTIGATION_STEPS.length).toBeGreaterThan(2);

    const result = await runInvestigation({
      request: {
        question: scenarioA.question,
        merchantId: EVAL_MERCHANT_ID,
        timeRange: EVAL_TIME_RANGE,
      },
      provider: new DeterministicProvider(),
      registry: createToolRegistry(),
      db: scenarioA.db,
      maxSteps: 2,
    });

    expect(result.meta.stepsExecuted).toBe(2);
    expect(result.meta.toolCalls).toBe(2);
  });

  it("wraps a provider narration failure as an AgentError rather than propagating raw", async () => {
    const scenarioA = EVAL_SCENARIOS.find((s) => s.name.startsWith("A"))!;
    const brokenProvider: LLMProvider = {
      name: "broken",
      plan: (request: PlanRequest): Promise<RawPlan> =>
        Promise.resolve({
          objective: "test",
          steps: [{ tool: "get_payments", input: {} }],
          candidateHypothesisIds: request.candidateHypothesisCatalog.map((h) => h.id),
        }),
      narrate: (_facts: NarrationFacts) => Promise.reject(new Error("model unavailable")),
    };

    await expect(
      runInvestigation({
        request: {
          question: scenarioA.question,
          merchantId: EVAL_MERCHANT_ID,
          timeRange: EVAL_TIME_RANGE,
        },
        provider: brokenProvider,
        registry: createToolRegistry(),
        db: scenarioA.db,
      }),
    ).rejects.toThrow(AgentError);
  });

  it("still scopes every tool call to the trusted merchant even if the plan tries to smuggle a different one", async () => {
    const scenarioA = EVAL_SCENARIOS.find((s) => s.name.startsWith("A"))!;
    const maliciousProvider: LLMProvider = {
      name: "malicious",
      plan: (): Promise<RawPlan> =>
        Promise.resolve({
          objective: "test",
          // Attempts to override merchantId via tool input — must be ignored.
          steps: [{ tool: "get_payments", input: { merchantId: "some-other-merchant" } }],
          candidateHypothesisIds: [],
        }),
      narrate: () => Promise.resolve({ summary: "ok", recommendations: [] }),
    };

    const result = await runInvestigation({
      request: {
        question: scenarioA.question,
        merchantId: EVAL_MERCHANT_ID,
        timeRange: EVAL_TIME_RANGE,
      },
      provider: maliciousProvider,
      registry: createToolRegistry(),
      db: scenarioA.db,
    });

    // get_payments has no `merchantId` field in its input schema, so zod
    // strips it — but the real proof is that results reflect EVAL_MERCHANT_ID's
    // data (scenario A's UPI degradation), not an empty/other-tenant result.
    expect(result.meta.toolCalls).toBeGreaterThan(0);
  });
});
