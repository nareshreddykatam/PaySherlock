import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { getOverview } from "../services/overviewService.js";
import { createMockDb, noopRunInvestigation } from "./fixtures.js";

describe("GET /overview (route)", () => {
  it("derives the merchant server-side and returns whatever getOverview produces", async () => {
    const db = createMockDb();
    db.merchant.findFirst.mockResolvedValue({ id: "trusted-merchant-1" });
    const fakeOverview = { currency: "INR", hasData: false, issues: [] };
    const overviewFn = vi.fn().mockResolvedValue(fakeOverview);
    const app = buildServer({
      db,
      webhookSecret: "whsec_test",
      runInvestigation: noopRunInvestigation(),
      getOverview: overviewFn,
    });

    const response = await app.inject({ method: "GET", url: "/overview" });

    expect(response.statusCode).toBe(200);
    expect(overviewFn).toHaveBeenCalledWith("trusted-merchant-1");
    expect(response.json()).toEqual(fakeOverview);
    await app.close();
  });
});

describe("getOverview (service)", () => {
  it("reports hasData=false and no revenue-at-risk for a merchant with no payments at all", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([]);
    db.payment.aggregate.mockResolvedValue({ _count: 0, _sum: { amount: null } });
    db.payment.findMany.mockResolvedValue([]);
    db.refund.aggregate.mockResolvedValue({ _count: 0, _sum: { amount: null } });

    const overview = await getOverview(db, "merchant-1");

    expect(overview.hasData).toBe(false);
    expect(overview.revenueAtRisk).toBeNull();
    expect(overview.issues).toHaveLength(5);
    expect(overview.issues.every((issue) => issue.severity !== "critical")).toBe(true);
  });
});
