import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Issue } from "@paysherlock/types";
import IssueDetailPage from "@/app/issues/[id]/page";
import type { RecoveryBatch } from "@/lib/api/issues";
import type { Track03Evaluation } from "@/lib/api/evaluation";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "issue-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const getIssueMock = vi.fn<() => Promise<Issue>>();
const generateRecoveryBatchMock = vi.fn<() => Promise<RecoveryBatch>>();
vi.mock("@/lib/api/issues", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/issues")>("@/lib/api/issues");
  return {
    ...actual,
    getIssue: () => getIssueMock(),
    generateRecoveryBatch: () => generateRecoveryBatchMock(),
  };
});

const getTrack03EvaluationMock = vi.fn<() => Promise<Track03Evaluation>>();
vi.mock("@/lib/api/evaluation", () => ({
  getTrack03Evaluation: () => getTrack03EvaluationMock(),
}));

const track03EvaluationFixture: Track03Evaluation = {
  generatedAt: "2026-08-23T08:40:21.496Z",
  environment: {
    mode: "synthetic",
    provider: "mocked-razorpay-client",
    disclosure:
      "Every recovery outcome in this report comes from a mocked RazorpayClient against synthetic payment rows, never a live Razorpay Test Mode call.",
  },
  metrics: {
    batchSize: 5,
    candidatesFound: 5,
    candidatesEligible: 5,
    candidatesRejected: 0,
    candidatesAttempted: 4,
    successfulRecoveries: 2,
    failedRecoveries: 2,
    amountEligibleMinorUnits: 150_000,
    amountAttemptedMinorUnits: 120_000,
    amountRecoveredMinorUnits: 60_000,
    recoveryRate: 0.5,
    duplicateExecutionCount: 0,
    falseSuccessCount: 0,
    stoppingReason: "failure_threshold_exceeded",
  },
  scenariosPassed: 11,
  scenariosTotal: 11,
  limitations: ["Synthetic evaluation only — no live Razorpay Test Mode API call is made."],
};

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
  beforeEach(() => {
    getTrack03EvaluationMock.mockReset().mockResolvedValue(track03EvaluationFixture);
    generateRecoveryBatchMock.mockReset();
  });

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

  it("shows the current live recovery-batch result honestly, including a zero-eligible outcome with a real explanation", async () => {
    getIssueMock.mockResolvedValue(baseIssue);
    const rejectedCandidates = Array.from({ length: 19 }, (_, i) => ({
      paymentId: `payment-${i}`,
      razorpayPaymentId: `pay_demo_current_${16802 + i}`,
      reason: "Payment already has an existing recommendation",
    }));
    generateRecoveryBatchMock.mockResolvedValue({
      issueId: "issue-1",
      rootCause: "UPI payment failure rate increased significantly",
      windowStart: "2026-08-23T05:47:38.253Z",
      windowEnd: "2026-08-23T06:47:38.253Z",
      limits: { maxCandidates: 10, maxTotalAmountMinorUnits: 500_000 },
      candidatesScanned: 19,
      eligibleCount: 0,
      rejectedCount: 19,
      amountEligibleMinorUnits: 0,
      stoppedReason: null,
      rejectedCandidates,
      recommendations: [],
    });
    const user = userEvent.setup();
    render(<IssueDetailPage />);

    await waitFor(() => expect(screen.getByText("UPI payment degradation")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Generate Recovery Batch" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          'All 19 payments scanned in this window were rejected for the same reason: "Payment already has an existing recommendation". No financial action was proposed.',
        ),
      ).toBeInTheDocument(),
    );
    // The real numbers, not a placeholder — 0 eligible reads as 0, never hidden.
    expect(screen.getByText("Show rejected candidates (19)")).toBeInTheDocument();
  });

  it("shows the synthetic Track 03 evaluation panel, clearly labeled as mocked and never live", async () => {
    getIssueMock.mockResolvedValue(baseIssue);
    render(<IssueDetailPage />);

    await waitFor(() =>
      expect(screen.getByText("Synthetic Track 03 Evaluation")).toBeInTheDocument(),
    );
    expect(screen.getByText("Mock Razorpay client — no real money recovered.")).toBeInTheDocument();
    expect(screen.getByText("₹1.2K")).toBeInTheDocument();
    expect(screen.getByText("₹600")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("11 / 11")).toBeInTheDocument();
  });
});
