import { describe, expect, it } from "vitest";
import { getRecommendationById, listRecommendations } from "../queries/recommendations.js";
import { getActionById } from "../queries/actions.js";
import { createMockDb } from "./fixtures.js";

const MERCHANT_ID = "merchant-1";

describe("listRecommendations", () => {
  it("scopes the query to the given merchant and includes the linked action", async () => {
    const db = createMockDb();
    db.recommendation.findMany.mockResolvedValue([{ id: "rec-1", action: null }]);

    await listRecommendations(db, { merchantId: MERCHANT_ID });

    const call = db.recommendation.findMany.mock.calls[0][0];
    expect(call.where.merchantId).toBe(MERCHANT_ID);
    expect(call.include).toEqual({ action: true });
  });
});

describe("getRecommendationById", () => {
  it("never does a bare findUnique by id alone — always merchant-scoped", async () => {
    const db = createMockDb();
    db.recommendation.findFirst.mockResolvedValue({
      id: "rec-1",
      merchantId: MERCHANT_ID,
      action: null,
    });

    await getRecommendationById(db, { id: "rec-1", merchantId: MERCHANT_ID });

    expect(db.recommendation.findFirst).toHaveBeenCalledWith({
      where: { id: "rec-1", merchantId: MERCHANT_ID },
      include: { action: true },
    });
  });
});

describe("getActionById", () => {
  it("is merchant-scoped", async () => {
    const db = createMockDb();
    db.action.findFirst.mockResolvedValue({ id: "action-1", merchantId: MERCHANT_ID });

    await getActionById(db, { id: "action-1", merchantId: MERCHANT_ID });

    expect(db.action.findFirst).toHaveBeenCalledWith({
      where: { id: "action-1", merchantId: MERCHANT_ID },
    });
  });
});
