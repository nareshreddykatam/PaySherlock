import { describe, expect, it } from "vitest";
import { runEvaluation } from "../eval/runEvaluation.js";
import { EVAL_SCENARIOS } from "../eval/scenarios.js";

describe("evaluation harness — 5 required Phase 2 scenarios", () => {
  it("identifies the correct root cause (or no anomaly) for every scenario", async () => {
    const report = await runEvaluation();

    for (const result of report.results) {
      expect(result, `${result.scenario}: root cause mismatch`).toMatchObject({
        rootCauseMatch: true,
      });
    }
  });

  it("stays within the expected revenue-impact range where one is defined", async () => {
    const report = await runEvaluation();
    for (const result of report.results) {
      if (result.impactInRange !== "n/a") {
        expect(result.impactInRange, `${result.scenario}: impact out of range`).toBe(true);
      }
    }
  });

  it("never reports a false-positive anomaly on the normal-business scenario", async () => {
    const report = await runEvaluation();
    expect(report.metrics.falsePositiveRate).toBe(0);
  });

  it("keeps tool execution fully successful and never issues an invalid tool call", async () => {
    const report = await runEvaluation();
    expect(report.metrics.toolExecutionSuccessRate).toBe(1);
    expect(report.metrics.invalidToolCallRate).toBe(0);
  });

  it("every evidence item traces back to a real, known tool", async () => {
    const report = await runEvaluation();
    expect(report.metrics.evidenceAccuracy).toBe(1);
  });

  it("stays within the bounded step count for every scenario", async () => {
    const report = await runEvaluation();
    for (const result of report.results) {
      expect(result.stepsExecuted).toBeGreaterThan(0);
      expect(result.stepsExecuted).toBeLessThanOrEqual(EVAL_SCENARIOS.length + 5);
    }
  });

  it("achieves 100% root-cause accuracy across all 5 scenarios", async () => {
    const report = await runEvaluation();
    expect(report.metrics.rootCauseAccuracy).toBe(1);
  });
});
