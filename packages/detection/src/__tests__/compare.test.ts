import { describe, expect, it } from "vitest";
import { compareToBaseline } from "../baseline/compare.js";

describe("compareToBaseline", () => {
  it("computes mean/min/max/change from multiple baseline windows", () => {
    const result = compareToBaseline(0.142, [0.08, 0.09, 0.1, 0.087, 0.083, 0.09, 0.085]);
    expect(result.comparisonWindows).toBe(7);
    expect(result.baselineMin).toBeCloseTo(0.08, 5);
    expect(result.baselineMax).toBeCloseTo(0.1, 5);
    expect(result.baselineValue).toBeCloseTo(0.0879, 3);
    expect(result.absoluteChange).toBeCloseTo(0.142 - result.baselineValue, 5);
    expect(result.relativeChange).toBeCloseTo(result.absoluteChange / result.baselineValue, 5);
  });

  it("returns a null relativeChange (not Infinity/NaN) when the baseline is zero", () => {
    const result = compareToBaseline(5, [0, 0, 0]);
    expect(result.baselineValue).toBe(0);
    expect(result.relativeChange).toBeNull();
    expect(result.absoluteChange).toBe(5);
  });

  it("handles an empty baseline set without throwing", () => {
    const result = compareToBaseline(10, []);
    expect(result.comparisonWindows).toBe(0);
    expect(result.baselineValue).toBe(0);
    expect(result.baselineMin).toBe(0);
    expect(result.baselineMax).toBe(0);
  });
});
