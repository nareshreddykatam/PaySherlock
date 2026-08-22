import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Recommendation } from "@paysherlock/types";
import { RecommendationCard } from "@/components/recommendation/RecommendationCard";

const BASE: Recommendation = {
  id: "rec-1",
  merchantId: "merchant-1",
  issueId: null,
  investigationId: "inv_1",
  type: "REFUND_PAYMENT",
  title: "Refund ₹2,400",
  explanation: "The payment appears duplicated based on the investigation evidence.",
  riskLevel: "MEDIUM",
  status: "PENDING_APPROVAL",
  targetPaymentId: "payment-1",
  amountMinorUnits: 240_000,
  currency: "INR",
  action: null,
  createdAt: "2026-08-22T10:00:00.000Z",
  approvedAt: null,
  rejectedAt: null,
  expiresAt: "2026-08-23T10:00:00.000Z",
  updatedAt: "2026-08-22T10:00:00.000Z",
};

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecommendationCard", () => {
  it("shows the recommendation, its risk, and an explicit action-naming button — never an ambiguous one", () => {
    render(<RecommendationCard recommendation={BASE} />);

    expect(screen.getByText("Refund ₹2,400")).toBeInTheDocument();
    expect(screen.getByText(/appears duplicated/)).toBeInTheDocument();
    expect(screen.getByText("MEDIUM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve & Refund" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OK" })).not.toBeInTheDocument();
  });

  it("requires an explicit confirmation naming the action before approving", async () => {
    const user = userEvent.setup();
    mockFetchOnce(200, { ...BASE, status: "SUCCEEDED" });
    render(<RecommendationCard recommendation={BASE} />);

    await user.click(screen.getByRole("button", { name: "Approve & Refund" }));

    expect(screen.getByText("Confirm refund")).toBeInTheDocument();
    expect(screen.getByText(/cannot be automatically undone/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm Refund" }));
    await waitFor(() => expect(screen.getByText("Succeeded")).toBeInTheDocument());
  });

  it("rejects without ever calling the provider (no approve/execute call is made)", async () => {
    const user = userEvent.setup();
    mockFetchOnce(200, { ...BASE, status: "REJECTED" });
    render(<RecommendationCard recommendation={BASE} />);

    await user.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(screen.getByText("Rejected")).toBeInTheDocument());
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain("/reject");
  });

  it("shows a safe failure message and a Retry action — never a raw provider error", async () => {
    const user = userEvent.setup();
    mockFetchOnce(200, {
      ...BASE,
      status: "FAILED",
      action: {
        id: "action-1",
        merchantId: "merchant-1",
        recommendationId: "rec-1",
        type: "REFUND_PAYMENT",
        status: "FAILED",
        paymentId: "payment-1",
        amountMinorUnits: 240_000,
        currency: "INR",
        idempotencyKey: "paysherlock-refund-rec-1",
        providerReference: null,
        providerStatus: null,
        errorCode: "PROVIDER_HTTP_400",
        errorMessage: "Razorpay rejected the refund request",
        createdAt: "2026-08-22T10:00:00.000Z",
        approvedAt: "2026-08-22T10:00:00.000Z",
        startedAt: "2026-08-22T10:00:01.000Z",
        completedAt: "2026-08-22T10:00:02.000Z",
        updatedAt: "2026-08-22T10:00:02.000Z",
      },
    });
    render(<RecommendationCard recommendation={BASE} />);

    await user.click(screen.getByRole("button", { name: "Approve & Refund" }));
    await user.click(screen.getByRole("button", { name: "Confirm Refund" }));

    await waitFor(() => expect(screen.getByText("Failed")).toBeInTheDocument());
    expect(screen.getByText(/No successful refund was recorded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows the provider refund reference on success", async () => {
    const succeeded: Recommendation = {
      ...BASE,
      status: "SUCCEEDED",
      action: {
        id: "action-1",
        merchantId: "merchant-1",
        recommendationId: "rec-1",
        type: "REFUND_PAYMENT",
        status: "SUCCEEDED",
        paymentId: "payment-1",
        amountMinorUnits: 240_000,
        currency: "INR",
        idempotencyKey: "paysherlock-refund-rec-1",
        providerReference: "rfnd_test0000000001",
        providerStatus: "processed",
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-08-22T10:00:00.000Z",
        approvedAt: "2026-08-22T10:00:00.000Z",
        startedAt: "2026-08-22T10:00:01.000Z",
        completedAt: "2026-08-22T10:00:02.000Z",
        updatedAt: "2026-08-22T10:00:02.000Z",
      },
    };
    render(<RecommendationCard recommendation={succeeded} />);

    expect(screen.getByText("rfnd_test0000000001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve & Refund" })).not.toBeInTheDocument();
  });

  it("surfaces a stale-recommendation conflict as a safe error message, not a crash", async () => {
    const user = userEvent.setup();
    mockFetchOnce(409, {
      error: {
        code: "ALREADY_PROCESSED",
        message: "This recommendation has already been processed.",
      },
    });
    render(<RecommendationCard recommendation={BASE} />);

    await user.click(screen.getByRole("button", { name: "Approve & Refund" }));
    await user.click(screen.getByRole("button", { name: "Confirm Refund" }));

    await waitFor(() =>
      expect(
        screen.getByText("This recommendation has already been processed."),
      ).toBeInTheDocument(),
    );
  });
});
