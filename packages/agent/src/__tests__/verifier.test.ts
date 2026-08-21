import { describe, expect, it } from "vitest";
import type { GetPaymentFailuresOutput } from "@paysherlock/tools";
import { generateHypotheses } from "../hypotheses/generator.js";
import { verifyHypotheses } from "../hypotheses/verifier.js";
import { HYPOTHESIS_CATALOG, HYPOTHESIS_IDS } from "../hypotheses/catalog.js";
import type { Findings } from "../evidence/findings.js";

function emptyFindings(): Findings {
  return { periodComparisons: {} };
}

function failuresFixture(overrides: Partial<GetPaymentFailuresOutput>): GetPaymentFailuresOutput {
  return {
    totalAttempts: 200,
    failedCount: 40,
    failureRate: 0.2,
    previousFailureRate: 0.05,
    failureRateChange: 0.15,
    failureReasons: [{ code: "PAYMENT_DECLINED", count: 40, share: 1 }],
    paymentMethods: [
      { method: "UPI", count: 120, failureRate: 0.3, shareOfFailures: 0.9 },
      { method: "CARD", count: 80, failureRate: 0.05, shareOfFailures: 0.1 },
    ],
    timeDistribution: [],
    ...overrides,
  };
}

describe("generateHypotheses", () => {
  it("starts every candidate hypothesis as PENDING, never pre-declaring one correct", () => {
    const hypotheses = generateHypotheses(HYPOTHESIS_CATALOG);
    expect(hypotheses).toHaveLength(HYPOTHESIS_CATALOG.length);
    expect(hypotheses.every((h) => h.status === "PENDING")).toBe(true);
    expect(hypotheses.every((h) => h.evidenceIds.length === 0)).toBe(true);
  });
});

describe("verifyHypotheses — upi_failure_increase", () => {
  it("marks SUPPORTED with a deterministic confidence when both thresholds are clearly met", () => {
    const pending = generateHypotheses([
      HYPOTHESIS_CATALOG.find((h) => h.id === HYPOTHESIS_IDS.UPI_FAILURE_INCREASE)!,
    ]);
    const findings = { ...emptyFindings(), failures: failuresFixture({}) };

    const { hypotheses, evidence } = verifyHypotheses(pending, findings);

    expect(hypotheses[0]!.status).toBe("SUPPORTED");
    expect(hypotheses[0]!.confidence).toBeGreaterThan(0);
    expect(hypotheses[0]!.confidence).toBeLessThanOrEqual(1);
    expect(hypotheses[0]!.evidenceIds.length).toBeGreaterThan(0);
    // Every evidence id on the hypothesis must correspond to a real,
    // returned Evidence object — nothing invented.
    for (const id of hypotheses[0]!.evidenceIds) {
      expect(evidence.some((e) => e.id === id)).toBe(true);
    }
  });

  it("marks REJECTED when the failure rate barely moved", () => {
    const pending = generateHypotheses([
      HYPOTHESIS_CATALOG.find((h) => h.id === HYPOTHESIS_IDS.UPI_FAILURE_INCREASE)!,
    ]);
    const findings = {
      ...emptyFindings(),
      failures: failuresFixture({
        failureRate: 0.051,
        previousFailureRate: 0.05,
        failureRateChange: 0.001,
      }),
    };

    const { hypotheses } = verifyHypotheses(pending, findings);

    expect(hypotheses[0]!.status).toBe("REJECTED");
    expect(hypotheses[0]!.confidence).toBeUndefined();
  });

  it("marks INCONCLUSIVE — not SUPPORTED — on borderline/conflicting evidence (rate up, but UPI isn't the dominant failure share)", () => {
    const pending = generateHypotheses([
      HYPOTHESIS_CATALOG.find((h) => h.id === HYPOTHESIS_IDS.UPI_FAILURE_INCREASE)!,
    ]);
    const findings = {
      ...emptyFindings(),
      failures: failuresFixture({
        failureRate: 0.09,
        previousFailureRate: 0.05,
        failureRateChange: 0.04, // clears the 3pp bar
        paymentMethods: [
          { method: "UPI", count: 120, failureRate: 0.09, shareOfFailures: 0.35 }, // but UPI isn't dominant
          { method: "CARD", count: 80, failureRate: 0.09, shareOfFailures: 0.65 },
        ],
      }),
    };

    const { hypotheses } = verifyHypotheses(pending, findings);

    expect(hypotheses[0]!.status).toBe("INCONCLUSIVE");
  });

  it("marks INCONCLUSIVE (not SUPPORTED/REJECTED) when the required tool never ran", () => {
    const pending = generateHypotheses([
      HYPOTHESIS_CATALOG.find((h) => h.id === HYPOTHESIS_IDS.UPI_FAILURE_INCREASE)!,
    ]);

    const { hypotheses, evidence } = verifyHypotheses(pending, emptyFindings());

    expect(hypotheses[0]!.status).toBe("INCONCLUSIVE");
    expect(evidence).toHaveLength(0);
  });
});
