import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Recommendation, RecommendationListResponse } from "@paysherlock/types";
import RecommendationsPage from "@/app/recommendations/page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const getRecommendationsMock = vi.fn<() => Promise<RecommendationListResponse>>();
vi.mock("@/lib/api/recommendations", () => ({
  getRecommendations: () => getRecommendationsMock(),
}));

const pendingRefund: Recommendation = {
  id: "rec-pending",
  merchantId: "merchant-1",
  issueId: null,
  investigationId: "inv_1",
  type: "REFUND_PAYMENT",
  title: "Refund ₹300",
  explanation: "The payment appears affected by a UPI outage identified during investigation.",
  riskLevel: "LOW",
  status: "PENDING_APPROVAL",
  targetPaymentId: "payment-1",
  amountMinorUnits: 30_000,
  currency: "INR",
  action: null,
  createdAt: "2026-08-20T10:00:00.000Z",
  approvedAt: null,
  rejectedAt: null,
  expiresAt: "2026-08-21T10:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
};

const succeededNoAction: Recommendation = {
  id: "rec-history",
  merchantId: "merchant-1",
  issueId: null,
  investigationId: "inv_2",
  type: "NO_ACTION",
  title: "No action needed",
  explanation: "Nothing anomalous found.",
  riskLevel: "LOW",
  status: "SUCCEEDED",
  targetPaymentId: null,
  amountMinorUnits: null,
  currency: null,
  action: null,
  createdAt: "2026-08-19T10:00:00.000Z",
  approvedAt: null,
  rejectedAt: null,
  expiresAt: null,
  updatedAt: "2026-08-19T10:00:00.000Z",
};

describe("RecommendationsPage", () => {
  it("makes a PENDING_APPROVAL recommendation clearly visible with an explicit no-financial-action message, separate from history", async () => {
    getRecommendationsMock.mockResolvedValue({
      data: [pendingRefund, succeededNoAction],
      nextCursor: null,
    });
    render(<RecommendationsPage />);

    await waitFor(() => expect(screen.getByText("Awaiting your decision (1)")).toBeInTheDocument());
    expect(screen.getByText("Refund ₹300")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No financial action has been executed. This refund will only be sent to Razorpay if a human explicitly approves it below.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve & Refund" })).toBeInTheDocument();

    expect(screen.getByText("History (1)")).toBeInTheDocument();
    expect(screen.getByText("No action needed")).toBeInTheDocument();
  });
});
