import type {
  AnalyzeFailureCodesOutput,
  CalculateRevenueImpactOutput,
  ComparePeriodsOutput,
  GetPaymentFailuresOutput,
  GetPaymentsOutput,
  GetRefundsOutput,
  SegmentPaymentsOutput,
} from "@paysherlock/tools";
import type { ToolResult } from "@paysherlock/types";

/** Typed view over the tool results collected for one investigation —
 * the deterministic evidence/hypothesis stages read from this instead of
 * re-scanning the raw ToolResult[] array. Only ever populated from a
 * *successful* ToolResult; a failed/missing tool call simply leaves the
 * corresponding field undefined (handled gracefully downstream, never as
 * an invented value). */
export interface Findings {
  paymentsOverview?: GetPaymentsOutput;
  failures?: GetPaymentFailuresOutput;
  segmentsByMethod?: SegmentPaymentsOutput;
  segmentsByAmountBucket?: SegmentPaymentsOutput;
  failureCodes?: AnalyzeFailureCodesOutput;
  refunds?: GetRefundsOutput;
  revenueImpact?: CalculateRevenueImpactOutput;
  /** Keyed by metric — `compare_periods` may be called more than once for
   * different metrics. */
  periodComparisons: Partial<Record<ComparePeriodsOutput["metric"], ComparePeriodsOutput>>;
}

export function extractFindings(toolResults: ToolResult[]): Findings {
  const findings: Findings = { periodComparisons: {} };

  for (const result of toolResults) {
    if (!result.success) continue;

    switch (result.tool) {
      case "get_payments":
        findings.paymentsOverview = result.output as GetPaymentsOutput;
        break;
      case "get_payment_failures":
        findings.failures = result.output as GetPaymentFailuresOutput;
        break;
      case "segment_payments": {
        const output = result.output as SegmentPaymentsOutput;
        if (output.dimension === "method") findings.segmentsByMethod = output;
        else if (output.dimension === "amount_bucket") findings.segmentsByAmountBucket = output;
        break;
      }
      case "analyze_failure_codes":
        findings.failureCodes = result.output as AnalyzeFailureCodesOutput;
        break;
      case "get_refunds":
        findings.refunds = result.output as GetRefundsOutput;
        break;
      case "calculate_revenue_impact":
        findings.revenueImpact = result.output as CalculateRevenueImpactOutput;
        break;
      case "compare_periods": {
        const output = result.output as ComparePeriodsOutput;
        findings.periodComparisons[output.metric] = output;
        break;
      }
      default:
        break;
    }
  }

  return findings;
}
