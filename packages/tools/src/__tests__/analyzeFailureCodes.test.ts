import { describe, expect, it } from "vitest";
import { analyzeFailureCodesTool } from "../definitions/analyzeFailureCodes.js";
import { createMockDb, createToolContext } from "./fixtures.js";

describe("analyze_failure_codes", () => {
  it("ranks failure codes by share of total failures", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([
      { errorCode: "GATEWAY_ERROR", _count: 5 },
      { errorCode: "BAD_REQUEST_ERROR", _count: 45 },
      { errorCode: null, _count: 10 },
    ]);

    const result = await analyzeFailureCodesTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db),
    );

    expect(result.totalFailures).toBe(60);
    expect(result.codes[0]).toEqual({ code: "BAD_REQUEST_ERROR", count: 45, share: 0.75 });
    expect(result.codes.find((c) => c.code === "UNKNOWN")).toEqual({
      code: "UNKNOWN",
      count: 10,
      share: 10 / 60,
    });
  });

  it("respects the limit parameter", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({ errorCode: `CODE_${i}`, _count: 15 - i })),
    );

    const result = await analyzeFailureCodesTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z", limit: 3 },
      createToolContext(db),
    );

    expect(result.codes).toHaveLength(3);
    expect(result.codes[0]!.code).toBe("CODE_0");
  });

  it("handles zero failures without dividing by zero", async () => {
    const db = createMockDb();
    db.payment.groupBy.mockResolvedValue([]);

    const result = await analyzeFailureCodesTool.handler(
      { startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-21T00:00:00.000Z" },
      createToolContext(db),
    );

    expect(result).toEqual({ totalFailures: 0, codes: [] });
  });
});
