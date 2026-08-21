import { describe, expect, it } from "vitest";
import { failureSpikeDetector } from "../detectors/failureSpike.js";
import { createFakeDatabase, makePayments, type FakePayment } from "./fixtures.js";
import type { DetectionContext } from "../engine/types.js";

const MERCHANT_ID = "merchant-1";
const NOW = new Date("2026-08-21T11:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function windowFor(daysBack: number): { start: Date; end: Date } {
  const end = new Date(NOW.getTime() - daysBack * 24 * HOUR_MS);
  return { start: new Date(end.getTime() - HOUR_MS), end };
}

function payments(daysBack: number, captured: number, failed: number): FakePayment[] {
  const { start, end } = windowFor(daysBack);
  return [
    ...makePayments({
      merchantId: MERCHANT_ID,
      start,
      end,
      count: captured,
      status: "CAPTURED",
      method: "UPI",
      amount: 30_000,
    }),
    ...makePayments({
      merchantId: MERCHANT_ID,
      start,
      end,
      count: failed,
      status: "FAILED",
      method: "UPI",
      amount: 30_000,
    }),
  ];
}

function contextWith(
  currentCaptured: number,
  currentFailed: number,
  baselineCaptured: number,
  baselineFailed: number,
): DetectionContext {
  const rows = [...payments(0, currentCaptured, currentFailed)];
  for (let day = 1; day <= 7; day += 1) {
    rows.push(...payments(day, baselineCaptured, baselineFailed));
  }
  return { merchantId: MERCHANT_ID, db: createFakeDatabase(rows, []), now: NOW };
}

describe("failureSpikeDetector", () => {
  it("flags a merchant-wide failure-rate spike (8% baseline -> 14% current)", async () => {
    const ctx = contextWith(86, 14, 92, 8); // current 100 @ 14%, baseline 100/day @ 8%
    const [result] = await failureSpikeDetector.detect(ctx);
    expect(result).toBeDefined();
    expect(result!.status).toBe("ANOMALY");
    expect(result!.type).toBe("PAYMENT_FAILURE_SPIKE");
    expect(result!.currentValue).toBeCloseTo(0.14, 5);
    expect(result!.baselineValue).toBeCloseTo(0.08, 5);
    expect(result!.absoluteChange).toBeCloseTo(0.06, 5);
    expect(result!.severity).toBe("CRITICAL");
    expect(result!.comparisonWindows).toBe(7);
  });

  it("does not flag normal day-to-day variance", async () => {
    const ctx = contextWith(91, 9, 92, 8); // 9% vs 8% baseline — 1pp, below threshold
    const results = await failureSpikeDetector.detect(ctx);
    expect(results).toEqual([]);
  });

  it("reports INSUFFICIENT_DATA instead of an anomaly for a tiny current sample", async () => {
    const ctx = contextWith(1, 1, 92, 8); // 2 attempts total, 1 failed = 50% "rate"
    const [result] = await failureSpikeDetector.detect(ctx);
    expect(result).toBeDefined();
    expect(result!.status).toBe("INSUFFICIENT_DATA");
    expect(result!.severity).toBeUndefined();
  });

  it("is anomalous exactly at the configured threshold (boundary is inclusive)", async () => {
    const ctx = contextWith(89, 11, 92, 8); // current 11%, baseline 8% => exactly +3pp
    const [result] = await failureSpikeDetector.detect(ctx);
    expect(result?.status).toBe("ANOMALY");
  });

  it("does not flag just below the threshold", async () => {
    const ctx = contextWith(90, 10, 92, 8); // current 10%, baseline 8% => +2pp, below 3pp
    const results = await failureSpikeDetector.detect(ctx);
    expect(results).toEqual([]);
  });
});
