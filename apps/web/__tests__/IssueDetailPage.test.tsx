import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Issue } from "@paysherlock/types";
import IssueDetailPage from "@/app/issues/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "issue-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const getIssueMock = vi.fn<() => Promise<Issue>>();
vi.mock("@/lib/api/issues", () => ({
  getIssue: () => getIssueMock(),
}));

const baseIssue: Issue = {
  id: "issue-1",
  merchantId: "merchant-1",
  type: "PAYMENT_METHOD_DEGRADATION",
  title: "UPI payment degradation",
  severity: "CRITICAL",
  status: "IDENTIFIED",
  detectedAt: new Date().toISOString(),
  metric: "method_failure_rate",
  currentValue: 0.142,
  baselineValue: 0.087,
  absoluteChange: 0.055,
  relativeChange: 0.632,
  sampleSize: 12481,
  dimension: "UPI",
  fingerprint: "PAYMENT_METHOD_DEGRADATION:UPI:2026-08-21",
  occurrenceCount: 2,
  investigationId: "inv_1",
  rootCause: "UPI payment failure rate increased significantly",
  confidence: "high",
  estimatedImpactMinorUnits: 172_000,
  investigation: null,
  investigationError: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("IssueDetailPage", () => {
  it("renders the issue's real metrics honestly, and an honest not-yet-investigated message when there is no cached result", async () => {
    getIssueMock.mockResolvedValue({
      ...baseIssue,
      investigation: null,
      status: "DETECTED",
      rootCause: null,
    });
    render(<IssueDetailPage />);

    await waitFor(() => expect(screen.getByText("UPI payment degradation")).toBeInTheDocument());
    expect(screen.getByText("14.2%")).toBeInTheDocument();
    expect(screen.getByText("8.7%")).toBeInTheDocument();
    expect(screen.getByText("This anomaly hasn't been investigated yet.")).toBeInTheDocument();
  });

  it("renders the full investigation (root cause, evidence, hypotheses) when the issue has a cached result", async () => {
    getIssueMock.mockResolvedValue({
      ...baseIssue,
      investigation: {
        question: "Why did the UPI failure rate increase?",
        summary: "UPI failure rate increased sharply.",
        rootCause: "UPI payment failure rate increased significantly",
        confidence: "high",
        businessImpact: {
          estimatedImpactMinorUnits: 172_000,
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
        ],
        rejectedHypotheses: [],
        hypotheses: [
          {
            id: "upi_failure_increase",
            statement: "UPI payment failure rate increased significantly",
            status: "SUPPORTED",
            evidenceIds: ["ev_1"],
            confidence: 0.8,
            score: 0.8,
          },
        ],
        recommendations: ["Check UPI gateway health."],
        meta: {
          investigationId: "inv_1",
          stepsExecuted: 8,
          toolCalls: 8,
          provider: "deterministic",
        },
      },
    });
    render(<IssueDetailPage />);

    await waitFor(() => expect(screen.getByText("Likely root cause")).toBeInTheDocument());
    expect(screen.getByText("+5.5pp vs. baseline")).toBeInTheDocument();
    expect(screen.getByText("SUPPORTED")).toBeInTheDocument();
  });

  it("shows a safe error state (no stack trace) when the automatic investigation failed", async () => {
    getIssueMock.mockResolvedValue({
      ...baseIssue,
      status: "INVESTIGATION_FAILED",
      investigation: null,
      investigationError: "provider unreachable",
    });
    render(<IssueDetailPage />);

    await waitFor(() =>
      expect(screen.getByText("We couldn't complete the investigation.")).toBeInTheDocument(),
    );
    expect(screen.getByText("provider unreachable")).toBeInTheDocument();
  });
});
