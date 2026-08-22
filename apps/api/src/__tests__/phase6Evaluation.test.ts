import { describe, expect, it } from "vitest";
import { runPhase6Evaluation } from "../eval/runPhase6Evaluation.js";

// The dedicated Phase 6 end-to-end evaluation harness (brief section 4):
// the full lifecycle, payment data through audit, across 12 required
// scenarios (A-L). Synthetic data + a mocked Razorpay client only — no
// live credentials, no live database.

describe("Phase 6 end-to-end evaluation", () => {
  it("passes every required scenario (A-L)", async () => {
    const report = await runPhase6Evaluation();

    const failed = report.scenarios.filter((s) => !s.passed);
    if (failed.length > 0) {
      const details = failed.map((f) => `${f.id} (${f.name}): ${f.notes.join("; ")}`).join("\n");
      throw new Error(`Scenario failures:\n${details}`);
    }

    expect(report.scenarios).toHaveLength(12);
    expect(report.metrics.reliability.unhandledExceptions).toBe(0);
  });

  it("A: a healthy merchant produces no false anomaly, issue, investigation, or recommendation", async () => {
    const report = await runPhase6Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "A")!;
    expect(scenario.passed).toBe(true);
    expect(scenario.details.issuesCreated).toBe(0);
  });

  it("B: UPI degradation is detected, investigated, and produces evidence + impact", async () => {
    const report = await runPhase6Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "B")!;
    expect(scenario.passed).toBe(true);
    expect(scenario.details.issueTypes).toContain("PAYMENT_METHOD_DEGRADATION");
  });

  it("C: a merchant-wide payment failure spike is detected and investigated", async () => {
    const report = await runPhase6Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "C")!;
    expect(scenario.passed).toBe(true);
    expect(scenario.details.issueTypes).toContain("PAYMENT_FAILURE_SPIKE");
  });

  it("G: a valid guarded refund executes exactly once", async () => {
    const report = await runPhase6Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "G")!;
    expect(scenario.passed).toBe(true);
  });

  it("H: double approval results in exactly one execution", async () => {
    const report = await runPhase6Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "H")!;
    expect(scenario.passed).toBe(true);
  });

  it("I: a stale refund state blocks execution before any provider call", async () => {
    const report = await runPhase6Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "I")!;
    expect(scenario.passed).toBe(true);
  });

  it("J: a provider failure produces a safe FAILED action with an audit event, never a false success", async () => {
    const report = await runPhase6Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "J")!;
    expect(scenario.passed).toBe(true);
  });

  it("K: a retry reuses the same idempotency key and never creates a duplicate logical action", async () => {
    const report = await runPhase6Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "K")!;
    expect(scenario.passed).toBe(true);
  });

  it("L: cross-merchant access to an issue, recommendation, and action is blocked", async () => {
    const report = await runPhase6Evaluation();
    const scenario = report.scenarios.find((s) => s.id === "L")!;
    expect(scenario.passed).toBe(true);
  });

  it("never describes synthetic results as real-world/production accuracy", async () => {
    const report = await runPhase6Evaluation();
    expect(report.environment.mode).toBe("synthetic");
    expect(report.limitations.join(" ")).toMatch(/synthetic/i);
  });

  it("reports unmeasurable metrics as unavailable rather than fabricating a number", async () => {
    const report = await runPhase6Evaluation();
    expect(report.metrics.investigation.evidenceAccuracy).toBe("unavailable");
    expect(report.metrics.reliability.failedRequests).toBe("unavailable");
  });
});
