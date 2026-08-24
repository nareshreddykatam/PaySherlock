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

describe("GET /eval/track03", () => {
  it("returns the synthetic Track 03 evaluation without touching the database", async () => {
    const db = createMockDb();
    const app = buildServer({
      db,
      webhookSecret: "whsec_test",
      runInvestigation: noopRunInvestigation(),
      getOverview: noopGetOverview(),
      approveRecommendation: noopApproveRecommendation(),
      rejectRecommendation: noopRejectRecommendation(),
      retryRecommendation: noopRetryRecommendation(),
    });

    const response = await app.inject({ method: "GET", url: "/eval/track03" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.environment.mode).toBe("synthetic");
    expect(body.environment.disclosure.toLowerCase()).toContain("mocked");
    expect(typeof body.metrics.amountAttemptedMinorUnits).toBe("number");
    expect(typeof body.metrics.amountRecoveredMinorUnits).toBe("number");
    expect(body.metrics.recoveryRate).toBeGreaterThan(0);
    expect(body.scenariosTotal).toBeGreaterThan(0);
    expect(body.scenariosPassed).toBe(body.scenariosTotal);
    expect(Array.isArray(body.limitations)).toBe(true);
    expect(body.limitations.length).toBeGreaterThan(0);

    // Read-only and merchant-independent — never queries the db.
    expect(db.payment.findMany).not.toHaveBeenCalled();
    expect(db.recommendation.findMany).not.toHaveBeenCalled();

    await app.close();
  });
});
