import { describe, expect, it } from "vitest";
import { runTrack03Evaluation } from "../eval/runTrack03Evaluation.js";

describe("Track 03 (AI Revenue Recovery) evaluation", () => {
  it("passes every required scenario (A-K, L-P)", async () => {
    const report = await runTrack03Evaluation();
    for (const scenario of report.scenarios) {
      expect(
        scenario.passed,
        `${scenario.id} — ${scenario.name}: ${scenario.notes.join("; ")}`,
      ).toBe(true);
    }
  });

  it("A: revenue at risk is a real, reproducible, non-fabricated number", async () => {
    const report = await runTrack03Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "A");
    expect(scenario?.passed).toBe(true);
  });

  it("B: candidate generation finds captured payments in the degradation window", async () => {
    const report = await runTrack03Evaluation();
    expect(report.scenarios.find((s) => s.id === "B")?.passed).toBe(true);
  });

  it("C: ineligible payments (refunded, uncaptured) are never included", async () => {
    const report = await runTrack03Evaluation();
    expect(report.scenarios.find((s) => s.id === "C")?.passed).toBe(true);
  });

  it("D: cross-merchant payments never become candidates", async () => {
    const report = await runTrack03Evaluation();
    expect(report.scenarios.find((s) => s.id === "D")?.passed).toBe(true);
  });

  it("E: a payment already recommended is never recommended twice", async () => {
    const report = await runTrack03Evaluation();
    expect(report.scenarios.find((s) => s.id === "E")?.passed).toBe(true);
  });

  it("F: concurrent approval of the same recommendation never double-executes", async () => {
    const report = await runTrack03Evaluation();
    expect(report.scenarios.find((s) => s.id === "F")?.passed).toBe(true);
  });

  it("G: every batch candidate requires explicit approval before any action exists", async () => {
    const report = await runTrack03Evaluation();
    expect(report.scenarios.find((s) => s.id === "G")?.passed).toBe(true);
  });

  it("H: stale live provider state blocks execution before any refund call", async () => {
    const report = await runTrack03Evaluation();
    expect(report.scenarios.find((s) => s.id === "H")?.passed).toBe(true);
  });

  it("I: batch selection stops at the configured maximum total amount", async () => {
    const report = await runTrack03Evaluation();
    expect(report.scenarios.find((s) => s.id === "I")?.passed).toBe(true);
  });

  it("J: batch selection stops at the configured maximum candidate count", async () => {
    const report = await runTrack03Evaluation();
    expect(report.scenarios.find((s) => s.id === "J")?.passed).toBe(true);
  });

  it("L-P: the full batch run reports honest mixed results — at least one success and one failure, zero false successes, a recorded stopping reason, and a complete audit trail", async () => {
    const report = await runTrack03Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "L-P");
    expect(scenario?.passed).toBe(true);
    expect(report.metrics.successfulRecoveries).toBeGreaterThanOrEqual(1);
    expect(report.metrics.failedRecoveries).toBeGreaterThanOrEqual(1);
    expect(report.metrics.falseSuccessCount).toBe(0);
    expect(report.metrics.stoppingReason).toBe("failure_threshold_exceeded");
  });

  it("never describes synthetic recovery results as real-world/production accuracy", async () => {
    const report = await runTrack03Evaluation();
    expect(report.environment.mode).toBe("synthetic");
    expect(report.environment.disclosure.toLowerCase()).toContain("mocked");
    expect(report.limitations.length).toBeGreaterThan(0);
  });

  it("reports amountRecoveredMinorUnits strictly from successful executions, never fabricated", async () => {
    const report = await runTrack03Evaluation();
    // Each captured payment in the harness is ₹300 (30,000 minor units) —
    // amountRecovered must be an exact multiple of that, matching
    // successfulRecoveries, never an invented/rounded figure.
    expect(report.metrics.amountRecoveredMinorUnits).toBe(
      report.metrics.successfulRecoveries * 30_000,
    );
  });
});
