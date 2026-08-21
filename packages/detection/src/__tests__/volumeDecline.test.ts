import { describe, expect, it } from "vitest";
import { volumeDeclineDetector } from "../detectors/volumeDecline.js";
import { createFakeDatabase, makePayments, type FakePayment } from "./fixtures.js";
import type { DetectionContext } from "../engine/types.js";

const MERCHANT_ID = "merchant-1";
const NOW = new Date("2026-08-21T11:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function windowFor(daysBack: number): { start: Date; end: Date } {
  const end = new Date(NOW.getTime() - daysBack * 24 * HOUR_MS);
  return { start: new Date(end.getTime() - HOUR_MS), end };
}

function attempts(daysBack: number, count: number): FakePayment[] {
  const { start, end } = windowFor(daysBack);
  return makePayments({
    merchantId: MERCHANT_ID,
    start,
    end,
    count,
    status: "CAPTURED",
    method: "UPI",
    amount: 30_000,
  });
}

function contextWith(currentCount: number, baselineCountPerDay: number): DetectionContext {
  const rows = [...attempts(0, currentCount)];
  for (let day = 1; day <= 7; day += 1) rows.push(...attempts(day, baselineCountPerDay));
  return { merchantId: MERCHANT_ID, db: createFakeDatabase(rows, []), now: NOW };
}

describe("volumeDeclineDetector", () => {
  it("flags a meaningful decline in transaction attempts", async () => {
    // Expected 10,200 (~7,286/day baseline), actual 7,800 — the brief's own example ratio.
    const ctx = contextWith(78, 102); // -23.5%
    const [result] = await volumeDeclineDetector.detect(ctx);
    expect(result?.status).toBe("ANOMALY");
    expect(result?.type).toBe("TRANSACTION_VOLUME_DECLINE");
    expect(result!.relativeChange).toBeLessThan(-0.2);
  });

  it("does not flag a small, normal dip", async () => {
    const ctx = contextWith(95, 100); // -5%
    expect(await volumeDeclineDetector.detect(ctx)).toEqual([]);
  });

  it("reports INSUFFICIENT_DATA when the baseline itself has too little volume", async () => {
    const ctx = contextWith(2, 3); // baseline total across 7 windows = 21, below the minimum
    const [result] = await volumeDeclineDetector.detect(ctx);
    expect(result?.status).toBe("INSUFFICIENT_DATA");
  });

  it("counts every payment status, not just captured — distinct from a revenue metric", async () => {
    const { start, end } = windowFor(0);
    const rows: FakePayment[] = [
      ...makePayments({
        merchantId: MERCHANT_ID,
        start,
        end,
        count: 40,
        status: "CAPTURED",
        method: "UPI",
        amount: 30_000,
      }),
      ...makePayments({
        merchantId: MERCHANT_ID,
        start,
        end,
        count: 38,
        status: "FAILED",
        method: "UPI",
        amount: 30_000,
      }),
    ];
    for (let day = 1; day <= 7; day += 1) rows.push(...attempts(day, 100));
    const ctx: DetectionContext = {
      merchantId: MERCHANT_ID,
      db: createFakeDatabase(rows, []),
      now: NOW,
    };
    const [result] = await volumeDeclineDetector.detect(ctx);
    // 78 total attempts (40 captured + 38 failed), not 40 — proves it isn't
    // silently filtering to captured-only like a revenue metric would.
    expect(result?.currentValue).toBe(78);
  });
});
