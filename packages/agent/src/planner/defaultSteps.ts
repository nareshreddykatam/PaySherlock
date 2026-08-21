import type { InvestigationStep } from "@paysherlock/types";

// The canonical investigation sequence — every registered tool, in an
// order that builds context before drilling into specifics. Used directly
// by the DeterministicProvider, and as the planner's safety net if a real
// provider's plan ends up with zero valid steps (e.g. it named unknown
// tools). Time-range fields are intentionally omitted here — the runtime
// injects sensible defaults (see runtime/context.ts) so neither this list
// nor a real model needs to reason about exact dates.
export const DEFAULT_INVESTIGATION_STEPS: InvestigationStep[] = [
  { tool: "get_payments", input: {}, rationale: "Establish the overall payment volume baseline." },
  {
    tool: "compare_periods",
    input: { metric: "successful_payment_count" },
    rationale: "Check whether transaction volume itself declined vs. baseline.",
  },
  {
    tool: "get_payment_failures",
    input: {},
    rationale: "Check whether failure rate moved vs. baseline.",
  },
  {
    tool: "segment_payments",
    input: { dimension: "method" },
    rationale: "See whether one payment method is driving any change.",
  },
  {
    tool: "analyze_failure_codes",
    input: {},
    rationale: "Identify which failure reasons dominate.",
  },
  { tool: "get_refunds", input: {}, rationale: "Check whether refund activity moved." },
  {
    tool: "segment_payments",
    input: { dimension: "amount_bucket" },
    rationale: "Check whether high-value transactions moved disproportionately.",
  },
  {
    tool: "calculate_revenue_impact",
    input: {},
    rationale: "Quantify the revenue effect deterministically.",
  },
];
