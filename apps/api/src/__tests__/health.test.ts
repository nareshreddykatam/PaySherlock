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

describe("GET /health", () => {
  it("returns an ok status without leaking internal details", async () => {
    const app = buildServer({
      db: createMockDb(),
      webhookSecret: "whsec_test",
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
    });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ status: "ok", timestamp: expect.any(String) });
    await app.close();
  });
});
