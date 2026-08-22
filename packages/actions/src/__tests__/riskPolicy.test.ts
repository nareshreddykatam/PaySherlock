import { describe, expect, it } from "vitest";
import { determineRiskLevel } from "../policy/riskPolicy.js";

describe("determineRiskLevel", () => {
  it("is LOW for NO_ACTION regardless of amount", () => {
    expect(determineRiskLevel({ type: "NO_ACTION" })).toBe("LOW");
    expect(determineRiskLevel({ type: "NO_ACTION", amountMinorUnits: 50_000_000 })).toBe("LOW");
  });

  it("is MEDIUM for a REFUND_PAYMENT below the high-risk threshold", () => {
    expect(determineRiskLevel({ type: "REFUND_PAYMENT", amountMinorUnits: 240_000 })).toBe(
      "MEDIUM",
    );
  });

  it("is HIGH for a REFUND_PAYMENT at or above the high-risk threshold", () => {
    expect(determineRiskLevel({ type: "REFUND_PAYMENT", amountMinorUnits: 5_000_000 })).toBe(
      "HIGH",
    );
    expect(determineRiskLevel({ type: "REFUND_PAYMENT", amountMinorUnits: 10_000_000 })).toBe(
      "HIGH",
    );
  });

  it("is deterministic — never LOW for a real refund, even a tiny one", () => {
    expect(determineRiskLevel({ type: "REFUND_PAYMENT", amountMinorUnits: 1 })).toBe("MEDIUM");
  });
});
