import { describe, expect, it } from "vitest";
import { runDeterministicSnapshot } from "../runtime/snapshot.js";
import { EVAL_MERCHANT_ID, EVAL_SCENARIOS, EVAL_TIME_RANGE } from "../eval/scenarios.js";

describe("runDeterministicSnapshot", () => {
  it("runs the full default tool sequence and verifies hypotheses without any LLM call", async () => {
    const scenarioA = EVAL_SCENARIOS.find((s) => s.name.startsWith("A"))!;

    const snapshot = await runDeterministicSnapshot({
      merchantId: EVAL_MERCHANT_ID,
      db: scenarioA.db,
      timeRange: EVAL_TIME_RANGE,
    });

    expect(snapshot.toolResults.every((result) => result.success)).toBe(true);
    expect(snapshot.hypotheses).toHaveLength(5);
    const upi = snapshot.hypotheses.find((h) => h.id === "upi_failure_increase")!;
    expect(upi.status).toBe("SUPPORTED");
    expect(snapshot.evidence.length).toBeGreaterThan(0);
  });

  it("reports every hypothesis as REJECTED/INCONCLUSIVE (never SUPPORTED) for normal business", async () => {
    const scenarioE = EVAL_SCENARIOS.find((s) => s.name.startsWith("E"))!;

    const snapshot = await runDeterministicSnapshot({
      merchantId: EVAL_MERCHANT_ID,
      db: scenarioE.db,
      timeRange: EVAL_TIME_RANGE,
    });

    expect(snapshot.hypotheses.some((h) => h.status === "SUPPORTED")).toBe(false);
  });
});
