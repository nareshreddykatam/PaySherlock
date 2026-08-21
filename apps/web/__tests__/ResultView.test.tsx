import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { InvestigationResult } from "@paysherlock/types";
import { ResultView } from "@/components/investigation/ResultView";

const baseResult: InvestigationResult = {
  question: "Why did revenue drop yesterday?",
  summary: "Likely UPI payment degradation, based on a sharp rise in failure rate.",
  rootCause: "UPI payment failure rate increased significantly",
  confidence: "high",
  businessImpact: {
    estimatedImpactMinorUnits: 172_400,
    currency: "INR",
    basis: "revenue_delta_vs_scaled_baseline",
  },
  evidence: [
    {
      id: "ev_1",
      source: "get_payment_failures",
      metric: "overall_failure_rate",
      observedValue: 0.142,
      baselineValue: 0.087,
      comparison: "+5.5pp vs. baseline",
      significance: "high",
      supportsHypothesisIds: ["upi_failure_increase"],
    },
    {
      id: "ev_2",
      source: "get_payment_failures",
      metric: "upi_share_of_failures",
      observedValue: 0.68,
      comparison: "68% of failed payments used UPI",
      significance: "high",
      supportsHypothesisIds: ["upi_failure_increase"],
    },
  ],
  rejectedHypotheses: [
    "Refund volume/amount increased significantly",
    "Transaction volume (payment attempts) declined significantly while the failure rate stayed normal",
  ],
  hypotheses: [
    {
      id: "upi_failure_increase",
      statement: "UPI payment failure rate increased significantly",
      status: "SUPPORTED",
      evidenceIds: ["ev_1", "ev_2"],
      confidence: 0.8,
      score: 0.82,
    },
    {
      id: "refund_spike",
      statement: "Refund volume/amount increased significantly",
      status: "REJECTED",
      evidenceIds: [],
    },
    {
      id: "transaction_volume_decline",
      statement:
        "Transaction volume (payment attempts) declined significantly while the failure rate stayed normal",
      status: "REJECTED",
      evidenceIds: [],
    },
    {
      id: "payment_method_degradation",
      statement: "A payment method other than UPI degraded (elevated failure rate)",
      status: "REJECTED",
      evidenceIds: [],
    },
    {
      id: "high_value_decline",
      statement:
        "High-value transaction volume declined disproportionately vs. smaller transactions",
      status: "INCONCLUSIVE",
      evidenceIds: [],
    },
  ],
  recommendations: ["Check UPI gateway health.", "Monitor over the next few days."],
  meta: { investigationId: "inv_test1", stepsExecuted: 8, toolCalls: 8, provider: "deterministic" },
};

describe("ResultView", () => {
  it("renders the root cause, confidence, and business impact from the real result", () => {
    render(<ResultView result={baseResult} onFollowUp={vi.fn()} />);

    // Appears twice: once in the root-cause card, once in the hypothesis list.
    expect(
      screen.getAllByText("UPI payment failure rate increased significantly").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getByText("₹1,724")).toBeInTheDocument();
  });

  it("renders evidence exactly as returned by the API, never inventing a claim", () => {
    render(<ResultView result={baseResult} onFollowUp={vi.fn()} />);

    expect(screen.getByText("68% of failed payments used UPI")).toBeInTheDocument();
    expect(screen.getByText("+5.5pp vs. baseline")).toBeInTheDocument();
  });

  it("renders every hypothesis with its real status — supported, rejected, and inconclusive", () => {
    render(<ResultView result={baseResult} onFollowUp={vi.fn()} />);

    expect(screen.getByText("SUPPORTED")).toBeInTheDocument();
    expect(screen.getAllByText("REJECTED")).toHaveLength(3);
    expect(screen.getByText("INCONCLUSIVE")).toBeInTheDocument();
  });

  it("renders a 'no anomaly' state honestly when the API found no root cause", () => {
    const noAnomalyResult: InvestigationResult = {
      ...baseResult,
      rootCause: undefined,
      confidence: undefined,
      businessImpact: undefined,
      evidence: [],
      summary: "No significant anomaly detected in the available data.",
    };
    render(<ResultView result={noAnomalyResult} onFollowUp={vi.fn()} />);

    expect(screen.getByText("No significant anomaly detected")).toBeInTheDocument();
    expect(screen.queryByText("High confidence")).not.toBeInTheDocument();
  });

  it("lets the merchant ask a follow-up question", () => {
    render(<ResultView result={baseResult} onFollowUp={vi.fn()} />);
    expect(screen.getByLabelText("Ask a follow-up")).toBeInTheDocument();
  });
});
