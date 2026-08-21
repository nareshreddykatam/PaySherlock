import type { CandidateHypothesis } from "@paysherlock/types";

// The fixed set of hypotheses PaySherlock knows how to test for a
// revenue/payment-anomaly question. Deliberately closed rather than
// LLM-invented — see docs/decisions: this is what keeps hypothesis
// verification/scoring deterministic and evaluable, and stops the agent
// from "declaring the first idea correct" (Phase 2 brief, hypothesis
// engine section) since every one of these is only ever PENDING until the
// evidence/verifier stage runs.

export const HYPOTHESIS_IDS = {
  UPI_FAILURE_INCREASE: "upi_failure_increase",
  TRANSACTION_VOLUME_DECLINE: "transaction_volume_decline",
  REFUND_SPIKE: "refund_spike",
  PAYMENT_METHOD_DEGRADATION: "payment_method_degradation",
  HIGH_VALUE_DECLINE: "high_value_decline",
} as const;

export const HYPOTHESIS_CATALOG: CandidateHypothesis[] = [
  {
    id: HYPOTHESIS_IDS.UPI_FAILURE_INCREASE,
    statement: "UPI payment failure rate increased significantly",
  },
  {
    id: HYPOTHESIS_IDS.TRANSACTION_VOLUME_DECLINE,
    statement:
      "Transaction volume (payment attempts) declined significantly while the failure rate stayed normal",
  },
  {
    id: HYPOTHESIS_IDS.REFUND_SPIKE,
    statement: "Refund volume/amount increased significantly",
  },
  {
    id: HYPOTHESIS_IDS.PAYMENT_METHOD_DEGRADATION,
    statement: "A payment method other than UPI degraded (elevated failure rate)",
  },
  {
    id: HYPOTHESIS_IDS.HIGH_VALUE_DECLINE,
    statement: "High-value transaction volume declined disproportionately vs. smaller transactions",
  },
];
