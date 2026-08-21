import { describe, expect, it } from "vitest";
import {
  findActiveIssueByFingerprint,
  createIssue,
  updateIssueMetrics,
  setIssueInvestigating,
  completeIssueInvestigation,
  failIssueInvestigation,
  setIssueStatus,
  resolveStaleIssues,
  dismissIssue,
} from "../upsert/issue.js";
import { listIssues, getIssueById } from "../queries/issues.js";
import { createMockDb } from "./fixtures.js";

const issueFixture = {
  id: "issue-1",
  merchantId: "merchant-1",
  type: "PAYMENT_FAILURE_SPIKE",
  title: "Payment failure spike",
  severity: "CRITICAL",
  status: "DETECTED",
  detectedAt: new Date("2026-08-21T10:00:00Z"),
  metric: "failure_rate",
  currentValue: 0.14,
  baselineValue: 0.08,
  absoluteChange: 0.06,
  relativeChange: 0.75,
  sampleSize: 100,
  dimension: null,
  fingerprint: "PAYMENT_FAILURE_SPIKE:_:2026-08-21",
  occurrenceCount: 1,
};

describe("findActiveIssueByFingerprint", () => {
  it("scopes the lookup to merchant + fingerprint + non-terminal statuses", async () => {
    const db = createMockDb();
    db.issue.findFirst.mockResolvedValue(issueFixture);

    const result = await findActiveIssueByFingerprint(db, {
      merchantId: "merchant-1",
      fingerprint: issueFixture.fingerprint,
    });

    expect(result).toEqual(issueFixture);
    expect(db.issue.findFirst).toHaveBeenCalledWith({
      where: {
        merchantId: "merchant-1",
        fingerprint: issueFixture.fingerprint,
        status: {
          in: ["DETECTED", "INVESTIGATING", "IDENTIFIED", "MONITORING", "INVESTIGATION_FAILED"],
        },
      },
    });
  });

  it("returns null when no active issue exists (a resolved one doesn't block a fresh lookup)", async () => {
    const db = createMockDb();
    db.issue.findFirst.mockResolvedValue(null);
    const result = await findActiveIssueByFingerprint(db, {
      merchantId: "merchant-1",
      fingerprint: "x",
    });
    expect(result).toBeNull();
  });
});

describe("createIssue", () => {
  it("creates a new issue in DETECTED status", async () => {
    const db = createMockDb();
    db.issue.create.mockResolvedValue(issueFixture);

    await createIssue(db, {
      merchantId: "merchant-1",
      type: "PAYMENT_FAILURE_SPIKE",
      title: "Payment failure spike",
      severity: "CRITICAL",
      detectedAt: issueFixture.detectedAt,
      metric: "failure_rate",
      currentValue: 0.14,
      baselineValue: 0.08,
      absoluteChange: 0.06,
      relativeChange: 0.75,
      sampleSize: 100,
      dimension: null,
      fingerprint: issueFixture.fingerprint,
    });

    expect(db.issue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "DETECTED", merchantId: "merchant-1" }),
    });
  });
});

describe("updateIssueMetrics", () => {
  it("updates metrics/severity/occurrenceCount without touching status", async () => {
    const db = createMockDb();
    db.issue.update.mockResolvedValue({ ...issueFixture, occurrenceCount: 2 });

    await updateIssueMetrics(db, {
      id: "issue-1",
      severity: "CRITICAL",
      currentValue: 0.15,
      baselineValue: 0.08,
      absoluteChange: 0.07,
      relativeChange: 0.87,
      sampleSize: 120,
      occurrenceCount: 2,
    });

    expect(db.issue.update).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: expect.objectContaining({ occurrenceCount: 2, severity: "CRITICAL" }),
    });
    const callData = db.issue.update.mock.calls[0][0].data;
    expect(callData.status).toBeUndefined();
  });
});

describe("investigation lifecycle transitions", () => {
  it("setIssueInvestigating moves status to INVESTIGATING", async () => {
    const db = createMockDb();
    db.issue.update.mockResolvedValue({ ...issueFixture, status: "INVESTIGATING" });
    await setIssueInvestigating(db, { id: "issue-1" });
    expect(db.issue.update).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: { status: "INVESTIGATING" },
    });
  });

  it("completeIssueInvestigation stores the root cause and cached result, clears any prior error", async () => {
    const db = createMockDb();
    db.issue.update.mockResolvedValue({ ...issueFixture, status: "IDENTIFIED" });

    await completeIssueInvestigation(db, {
      id: "issue-1",
      investigationId: "inv_123",
      status: "IDENTIFIED",
      rootCause: "UPI payment failure rate increased significantly",
      confidence: "high",
      estimatedImpactMinorUnits: 172_000,
      investigationResult: { question: "auto" },
    });

    expect(db.issue.update).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: expect.objectContaining({
        status: "IDENTIFIED",
        investigationId: "inv_123",
        rootCause: "UPI payment failure rate increased significantly",
        investigationError: null,
      }),
    });
  });

  it("failIssueInvestigation keeps the issue and records a safe error message", async () => {
    const db = createMockDb();
    db.issue.update.mockResolvedValue({ ...issueFixture, status: "INVESTIGATION_FAILED" });

    await failIssueInvestigation(db, { id: "issue-1", error: "provider unreachable" });

    expect(db.issue.update).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: { status: "INVESTIGATION_FAILED", investigationError: "provider unreachable" },
    });
  });
});

describe("setIssueStatus / dismissIssue", () => {
  it("setIssueStatus sets an arbitrary lifecycle status", async () => {
    const db = createMockDb();
    db.issue.update.mockResolvedValue({ ...issueFixture, status: "MONITORING" });
    await setIssueStatus(db, { id: "issue-1", status: "MONITORING" });
    expect(db.issue.update).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: { status: "MONITORING" },
    });
  });

  it("dismissIssue returns null for an issue that doesn't belong to this merchant", async () => {
    const db = createMockDb();
    db.issue.findFirst.mockResolvedValue(null);
    const result = await dismissIssue(db, { id: "issue-1", merchantId: "other-merchant" });
    expect(result).toBeNull();
    expect(db.issue.update).not.toHaveBeenCalled();
  });

  it("dismissIssue sets DISMISSED when the issue belongs to the merchant", async () => {
    const db = createMockDb();
    db.issue.findFirst.mockResolvedValue(issueFixture);
    db.issue.update.mockResolvedValue({ ...issueFixture, status: "DISMISSED" });
    const result = await dismissIssue(db, { id: "issue-1", merchantId: "merchant-1" });
    expect(result?.status).toBe("DISMISSED");
    expect(db.issue.update).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: { status: "DISMISSED" },
    });
  });
});

describe("resolveStaleIssues", () => {
  it("auto-resolves active issues not reconfirmed since the cutoff, scoped to the merchant", async () => {
    const db = createMockDb();
    db.issue.updateMany.mockResolvedValue({ count: 3 });
    const cutoff = new Date("2026-08-20T00:00:00Z");

    const count = await resolveStaleIssues(db, { merchantId: "merchant-1", staleBefore: cutoff });

    expect(count).toBe(3);
    expect(db.issue.updateMany).toHaveBeenCalledWith({
      where: {
        merchantId: "merchant-1",
        status: {
          in: ["DETECTED", "INVESTIGATING", "IDENTIFIED", "MONITORING", "INVESTIGATION_FAILED"],
        },
        updatedAt: { lt: cutoff },
      },
      data: { status: "RESOLVED" },
    });
  });
});

describe("listIssues", () => {
  it("scopes to the merchant and paginates newest-first", async () => {
    const db = createMockDb();
    db.issue.findMany.mockResolvedValue([issueFixture]);

    const page = await listIssues(db, { merchantId: "merchant-1" });

    expect(page.items).toEqual([issueFixture]);
    expect(db.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { merchantId: "merchant-1", status: undefined },
        orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
      }),
    );
  });
});

describe("getIssueById", () => {
  it("never returns an issue belonging to a different merchant", async () => {
    const db = createMockDb();
    db.issue.findFirst.mockResolvedValue(null);

    const result = await getIssueById(db, { id: "issue-1", merchantId: "someone-elses-merchant" });

    expect(result).toBeNull();
    expect(db.issue.findFirst).toHaveBeenCalledWith({
      where: { id: "issue-1", merchantId: "someone-elses-merchant" },
    });
  });
});
