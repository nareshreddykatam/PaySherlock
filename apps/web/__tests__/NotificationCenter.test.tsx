import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Issue, IssueListResponse } from "@paysherlock/types";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

const getIssuesMock = vi.fn<() => Promise<IssueListResponse>>();
vi.mock("@/lib/api/issues", () => ({
  getIssues: () => getIssuesMock(),
}));

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    merchantId: "merchant-1",
    type: "PAYMENT_FAILURE_SPIKE",
    title: "Payment failure spike",
    severity: "WARNING",
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
    ...overrides,
  };
}

describe("NotificationCenter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    getIssuesMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not notify for issues that already existed when the session started", async () => {
    getIssuesMock.mockResolvedValue({ data: [issue()], nextCursor: null });
    render(<NotificationCenter />);

    await vi.waitFor(() => expect(getIssuesMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("PaySherlock found something unusual")).toBeNull();
  });

  it("notifies for a genuinely new issue that appears on a later poll", async () => {
    getIssuesMock.mockResolvedValueOnce({ data: [], nextCursor: null });
    render(<NotificationCenter />);
    await vi.waitFor(() => expect(getIssuesMock).toHaveBeenCalledTimes(1));

    getIssuesMock.mockResolvedValueOnce({ data: [issue()], nextCursor: null });
    await vi.advanceTimersByTimeAsync(30_000);

    await vi.waitFor(() =>
      expect(screen.getByText("PaySherlock found something unusual")).toBeInTheDocument(),
    );
    expect(screen.getByText("Payment failure spike")).toBeInTheDocument();
  });

  it("does not re-notify for the same issue at the same severity on a subsequent poll", async () => {
    getIssuesMock.mockResolvedValue({ data: [issue()], nextCursor: null });
    render(<NotificationCenter />);
    await vi.waitFor(() => expect(getIssuesMock).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(screen.queryByText("PaySherlock found something unusual")).toBeNull();
  });

  it("clears its poll interval and pending auto-dismiss timers on unmount — no update-after-unmount", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getIssuesMock.mockResolvedValueOnce({ data: [], nextCursor: null });
    const { unmount } = render(<NotificationCenter />);
    await vi.waitFor(() => expect(getIssuesMock).toHaveBeenCalledTimes(1));

    // A new issue arrives, scheduling an auto-dismiss timer for it.
    getIssuesMock.mockResolvedValueOnce({ data: [issue()], nextCursor: null });
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() =>
      expect(screen.getByText("PaySherlock found something unusual")).toBeInTheDocument(),
    );

    unmount();
    // Advance well past both the poll interval and the auto-dismiss delay —
    // if either timer weren't cleared, this would call setState on an
    // unmounted component.
    await vi.advanceTimersByTimeAsync(60_000);

    const unmountedUpdateWarning = errorSpy.mock.calls.some((call) =>
      String(call[0]).includes("unmounted component"),
    );
    expect(unmountedUpdateWarning).toBe(false);
    errorSpy.mockRestore();
  });

  it("notifies again when a known issue's severity escalates", async () => {
    getIssuesMock.mockResolvedValueOnce({
      data: [issue({ severity: "WARNING" })],
      nextCursor: null,
    });
    render(<NotificationCenter />);
    await vi.waitFor(() => expect(getIssuesMock).toHaveBeenCalledTimes(1));

    getIssuesMock.mockResolvedValueOnce({
      data: [issue({ severity: "CRITICAL" })],
      nextCursor: null,
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await vi.waitFor(() =>
      expect(screen.getByText("An issue got more severe")).toBeInTheDocument(),
    );
  });
});
