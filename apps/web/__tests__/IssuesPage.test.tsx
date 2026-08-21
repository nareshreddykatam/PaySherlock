import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Issue, IssueListResponse } from "@paysherlock/types";
import IssuesPage from "@/app/issues/page";

vi.mock("next/navigation", () => ({ usePathname: () => "/issues" }));

const getIssuesMock = vi.fn<() => Promise<IssueListResponse>>();
vi.mock("@/lib/api/issues", () => ({
  getIssues: () => getIssuesMock(),
}));

const issueFixture: Issue = {
  id: "issue-1",
  merchantId: "merchant-1",
  type: "PAYMENT_FAILURE_SPIKE",
  title: "Payment failure spike",
  severity: "CRITICAL",
  status: "IDENTIFIED",
  detectedAt: new Date().toISOString(),
  metric: "failure_rate",
  currentValue: 0.14,
  baselineValue: 0.08,
  absoluteChange: 0.06,
  relativeChange: 0.75,
  sampleSize: 100,
  dimension: null,
  fingerprint: "PAYMENT_FAILURE_SPIKE:_:2026-08-21",
  occurrenceCount: 1,
  investigationId: "inv_1",
  rootCause: "UPI payment failure rate increased significantly",
  confidence: "high",
  estimatedImpactMinorUnits: 172_000,
  investigation: null,
  investigationError: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("IssuesPage", () => {
  it("renders real, persisted issues once loaded", async () => {
    getIssuesMock.mockResolvedValue({ data: [issueFixture], nextCursor: null });
    render(<IssuesPage />);

    await waitFor(() => expect(screen.getByText("Payment failure spike")).toBeInTheDocument());
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(
      screen.getByText(/UPI payment failure rate increased significantly/),
    ).toBeInTheDocument();
  });

  it("shows an honest empty state — never fabricated issues — when there are none", async () => {
    getIssuesMock.mockResolvedValue({ data: [], nextCursor: null });
    render(<IssuesPage />);

    await waitFor(() => expect(screen.getByText("No issues detected yet.")).toBeInTheDocument());
  });

  it("shows an error state with retry when the issues service fails", async () => {
    getIssuesMock.mockRejectedValue(new Error("The request failed."));
    render(<IssuesPage />);

    await waitFor(() => expect(screen.getByText("We couldn't load issues.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
