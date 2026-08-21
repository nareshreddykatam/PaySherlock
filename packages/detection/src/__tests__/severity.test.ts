import { describe, expect, it } from "vitest";
import { computeSeverity } from "../severity/severity.js";

describe("computeSeverity", () => {
  it("is INFO for a small rate-points change with a strong sample", () => {
    expect(
      computeSeverity({
        kind: "rate-points",
        magnitude: 0.01,
        sampleSize: 1000,
        minSampleSize: 30,
      }),
    ).toBe("INFO");
  });

  it("is WARNING for a moderate rate-points change with a strong sample", () => {
    expect(
      computeSeverity({
        kind: "rate-points",
        magnitude: 0.03,
        sampleSize: 1000,
        minSampleSize: 30,
      }),
    ).toBe("WARNING");
  });

  it("is CRITICAL for a large rate-points change with a strong sample", () => {
    expect(
      computeSeverity({
        kind: "rate-points",
        magnitude: 0.06,
        sampleSize: 1000,
        minSampleSize: 30,
      }),
    ).toBe("CRITICAL");
  });

  it("downgrades one level when the sample is only barely above the minimum", () => {
    // Same 6pp magnitude as the CRITICAL case above, but a borderline
    // sample (just over minSampleSize, not comfortably over it).
    expect(
      computeSeverity({ kind: "rate-points", magnitude: 0.06, sampleSize: 31, minSampleSize: 30 }),
    ).toBe("WARNING");
  });

  it("never downgrades below INFO", () => {
    expect(
      computeSeverity({ kind: "rate-points", magnitude: 0.01, sampleSize: 31, minSampleSize: 30 }),
    ).toBe("INFO");
  });

  it("is deterministic — identical input always produces identical output", () => {
    const input = {
      kind: "relative" as const,
      magnitude: 0.25,
      sampleSize: 500,
      minSampleSize: 30,
    };
    const results = Array.from({ length: 20 }, () => computeSeverity(input));
    expect(new Set(results).size).toBe(1);
  });

  it("uses the relative scale (not rate-points) for volume/high-value detectors", () => {
    expect(
      computeSeverity({ kind: "relative", magnitude: 0.25, sampleSize: 1000, minSampleSize: 30 }),
    ).toBe("WARNING");
    expect(
      computeSeverity({ kind: "relative", magnitude: 0.5, sampleSize: 1000, minSampleSize: 30 }),
    ).toBe("CRITICAL");
  });

  it("escalates to CRITICAL when the estimated impact is very large, even at moderate magnitude", () => {
    expect(
      computeSeverity({
        kind: "rate-points",
        magnitude: 0.03,
        sampleSize: 1000,
        minSampleSize: 30,
        estimatedImpactMinorUnits: 50_000_000,
      }),
    ).toBe("CRITICAL");
  });

  it("does not let a huge impact number turn a genuinely INFO-level change into an anomaly", () => {
    expect(
      computeSeverity({
        kind: "rate-points",
        magnitude: 0.005,
        sampleSize: 1000,
        minSampleSize: 30,
        estimatedImpactMinorUnits: 50_000_000,
      }),
    ).toBe("INFO");
  });
});
