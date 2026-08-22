import type { RecommendationType, RiskLevel } from "@paysherlock/types";

// Deterministic risk policy (Phase 5 brief section 8). The LLM may explain
// *why* an action is recommended (Recommendation.explanation), but never
// decides how risky it is — this is the one and only place riskLevel is
// computed, and it is a pure function of the action type and amount.

/** Above this, a refund is HIGH risk regardless of anything else — a
 * deliberately conservative, documented threshold (₹50,000), not
 * statistically derived. Below it, every real refund is MEDIUM: moving
 * money is never LOW risk in this policy, even for a tiny amount. */
const HIGH_RISK_REFUND_THRESHOLD_MINOR_UNITS = 5_000_000;

export interface RiskPolicyInput {
  type: RecommendationType;
  amountMinorUnits?: number | null;
}

export function determineRiskLevel(input: RiskPolicyInput): RiskLevel {
  if (input.type === "NO_ACTION") return "LOW";

  // REFUND_PAYMENT.
  const amount = input.amountMinorUnits ?? 0;
  return amount >= HIGH_RISK_REFUND_THRESHOLD_MINOR_UNITS ? "HIGH" : "MEDIUM";
}
