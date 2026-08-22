import type { Phase4Scenario } from "./scenarios.js";

// Phase 6's end-to-end harness (brief section 5) deliberately reuses Phase
// 4's proven synthetic fixture generator (packages/agent's makePayments/
// makeRefunds + the comparable-hour-window baseline shape already
// calibrated in scenarios.ts) rather than inventing a fourth synthetic
// data system (Phase 2 has EVAL_SCENARIOS, Phase 4 has PHASE4_SCENARIOS) —
// see docs/decisions. Only one genuinely new scenario is added here: a
// merchant-wide (all-methods) failure spike, since none of Phase 4's
// existing scenarios isolate PAYMENT_FAILURE_SPIKE from
// PAYMENT_METHOD_DEGRADATION.

/** A true infrastructure-wide failure spike — every method's failure rate
 * rises by roughly the same amount. Note this legitimately also crosses
 * every individual method's own PAYMENT_METHOD_DEGRADATION threshold —
 * that's not a false positive, it's the expected signature of a genuinely
 * merchant-wide (not single-method) outage, and the report says so rather
 * than hiding it. */
export const PAYMENT_FAILURE_SPIKE_SCENARIO: Phase4Scenario = {
  name: "Payment failure spike (merchant-wide)",
  description:
    "Failure rate rises to roughly the same elevated level across every payment method at once.",
  currentMix: {
    upiCaptured: 15,
    upiFailed: 10,
    cardCaptured: 15,
    cardFailed: 10,
    netbankingCaptured: 12,
    netbankingFailed: 8,
  },
};
