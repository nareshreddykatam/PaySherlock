import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import {
  createMockDb,
  noopApproveRecommendation,
  noopGetOverview,
  noopRejectRecommendation,
  noopRetryRecommendation,
  noopRunInvestigation,
} from "./fixtures.js";

const issueRowFixture = {
  id: "issue-1",
  merchantId: "trusted-merchant-1",
  type: "PAYMENT_FAILURE_SPIKE",
  title: "Payment failure spike",
  severity: "CRITICAL",
  status: "IDENTIFIED",
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
  investigationId: "inv_1",
  rootCause: "UPI payment failure rate increased significantly",
  confidence: "high",
  estimatedImpactMinorUnits: 172_000,
  investigationResult: null,
  investigationError: null,
  createdAt: new Date("2026-08-21T10:00:00Z"),
  updatedAt: new Date("2026-08-21T10:05:00Z"),
};

function buildApp(db: ReturnType<typeof createMockDb>) {
  return buildServer({
    db,
    webhookSecret: "whsec_test",
    runInvestigation: noopRunInvestigation(),
    getOverview: noopGetOverview(),
    approveRecommendation: noopApproveRecommendation(),
    rejectRecommendation: noopRejectRecommendation(),
    retryRecommendation: noopRetryRecommendation(),
  });
}

describe("GET /issues", () => {
  it("derives the merchant server-side and returns a normalized page (dates as ISO strings)", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.issue.findMany.mockResolvedValue([issueRowFixture]);
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/issues" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "issue-1",
      type: "PAYMENT_FAILURE_SPIKE",
      severity: "CRITICAL",
      status: "IDENTIFIED",
      rootCause: "UPI payment failure rate increased significantly",
    });
    expect(body.data[0].detectedAt).toBe("2026-08-21T10:00:00.000Z");
    expect(db.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "trusted-merchant-1", status: undefined } }),
    );
    await app.close();
  });

  it("never trusts a client-supplied merchantId — merchant is always derived server-side", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.issue.findMany.mockResolvedValue([]);
    const app = buildApp(db);

    await app.inject({ method: "GET", url: "/issues?merchantId=attacker-supplied-id" });

    expect(db.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "trusted-merchant-1", status: undefined } }),
    );
    await app.close();
  });

  it("rejects an out-of-range limit as a validation error", async () => {
    const app = buildApp(createMockDb());
    const response = await app.inject({ method: "GET", url: "/issues?limit=500" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});

describe("GET /issues/:id", () => {
  it("returns the issue, including the cached investigation result, when found", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.issue.findFirst.mockResolvedValue({
      ...issueRowFixture,
      investigationResult: { question: "auto", summary: "stub" },
    });
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/issues/issue-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json().investigation).toEqual({ question: "auto", summary: "stub" });
    expect(db.issue.findFirst).toHaveBeenCalledWith({
      where: { id: "issue-1", merchantId: "trusted-merchant-1" },
    });
    await app.close();
  });

  it("returns 404 with a safe error body for an unknown or cross-merchant id", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    db.issue.findFirst.mockResolvedValue(null);
    const app = buildApp(db);

    const response = await app.inject({ method: "GET", url: "/issues/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "NOT_FOUND", message: expect.stringContaining("does-not-exist") },
    });
    await app.close();
  });
});
