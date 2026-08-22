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

function buildApp() {
  return buildServer({
    db: createMockDb(),
    webhookSecret: "whsec_test",
    runInvestigation: noopRunInvestigation(),
    getOverview: noopGetOverview(),
    approveRecommendation: noopApproveRecommendation(),
    rejectRecommendation: noopRejectRecommendation(),
    retryRecommendation: noopRetryRecommendation(),
  });
}

describe("request correlation (X-Request-Id)", () => {
  it("echoes back a well-formed client-supplied request id", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "client-supplied-id-123" },
    });
    expect(response.headers["x-request-id"]).toBe("client-supplied-id-123");
    await app.close();
  });

  it("generates a request id when the client doesn't supply one", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(typeof response.headers["x-request-id"]).toBe("string");
    expect((response.headers["x-request-id"] as string).length).toBeGreaterThan(0);
    await app.close();
  });

  it("replaces a malformed/oversized client-supplied id with a generated one, never trusting it as-is", async () => {
    const app = buildApp();
    const tooLong = "x".repeat(500);
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": tooLong },
    });
    expect(response.headers["x-request-id"]).not.toBe(tooLong);
    await app.close();
  });

  it("generates a distinct id for each request", async () => {
    const app = buildApp();
    const first = await app.inject({ method: "GET", url: "/health" });
    const second = await app.inject({ method: "GET", url: "/health" });
    expect(first.headers["x-request-id"]).not.toBe(second.headers["x-request-id"]);
    await app.close();
  });
});
