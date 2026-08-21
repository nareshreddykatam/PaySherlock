import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { createMockDb, noopGetOverview } from "./fixtures.js";

const fakeResult = {
  question: "Why did revenue drop?",
  summary: "Likely UPI payment degradation.",
  rootCause: "UPI payment failure rate increased significantly",
  confidence: "high" as const,
  evidence: [],
  rejectedHypotheses: [],
  recommendations: ["Check UPI gateway health."],
  meta: { investigationId: "inv_1", stepsExecuted: 5, toolCalls: 5, provider: "deterministic" },
};

describe("POST /investigations", () => {
  it("derives the merchant server-side and never trusts a client-supplied merchantId", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    const runInvestigation = vi.fn().mockResolvedValue(fakeResult);
    const app = buildServer({
      db,
      webhookSecret: "whsec_test",
      runInvestigation,
      getOverview: noopGetOverview(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/investigations",
      payload: { question: "Why did revenue drop?", merchantId: "attacker-supplied-merchant" },
    });

    expect(response.statusCode).toBe(200);
    expect(runInvestigation).toHaveBeenCalledWith({
      question: "Why did revenue drop?",
      merchantId: "trusted-merchant-1",
    });
    expect(response.json()).toEqual(fakeResult);
    await app.close();
  });

  it("rejects a missing/empty question as a validation error", async () => {
    const db = createMockDb();
    const runInvestigation = vi.fn();
    const app = buildServer({
      db,
      webhookSecret: "whsec_test",
      runInvestigation,
      getOverview: noopGetOverview(),
    });

    const response = await app.inject({ method: "POST", url: "/investigations", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(runInvestigation).not.toHaveBeenCalled();
    await app.close();
  });

  it("surfaces an agent failure as a safe 5xx error, not a raw stack trace", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "merchant-1" });
    const runInvestigation = vi.fn().mockRejectedValue(new Error("provider unreachable"));
    const app = buildServer({
      db,
      webhookSecret: "whsec_test",
      runInvestigation,
      getOverview: noopGetOverview(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/investigations",
      payload: { question: "Why did revenue drop?" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    await app.close();
  });
});
