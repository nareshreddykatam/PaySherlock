import { describe, expect, it } from "vitest";
import { highValueDeclineDetector } from "../detectors/highValueDecline.js";
import { createFakeDatabase, makePayments, type FakePayment } from "./fixtures.js";
import type { DetectionContext } from "../engine/types.js";

const MERCHANT_ID = "merchant-1";
const NOW = new Date("2026-08-21T11:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const HIGH_VALUE_AMOUNT = 1_500_000; // above the ₹10,000 threshold
const LOW_VALUE_AMOUNT = 30_000; // below the threshold — should never count

function windowFor(daysBack: number): { start: Date; end: Date } {
  const end = new Date(NOW.getTime() - daysBack * 24 * HOUR_MS);
  return { start: new Date(end.getTime() - HOUR_MS), end };
}

function highValuePayments(daysBack: number, count: number): FakePayment[] {
  const { start, end } = windowFor(daysBack);
  return makePayments({
    merchantId: MERCHANT_ID,
    start,
    end,
    count,
    status: "CAPTURED",
    method: "NETBANKING",
    amount: HIGH_VALUE_AMOUNT,
  });
}

function contextWith(
  currentCount: number,
  baselineCountPerDay: number,
  extraLowValueCurrent = 0,
): DetectionContext {
  const { start, end } = windowFor(0);
  const rows = [
    ...highValuePayments(0, currentCount),
    ...makePayments({
      merchantId: MERCHANT_ID,
      start,
      end,
      count: extraLowValueCurrent,
      status: "CAPTURED",
      method: "UPI",
      amount: LOW_VALUE_AMOUNT,
    }),
  ];
  for (let day = 1; day <= 7; day += 1) rows.push(...highValuePayments(day, baselineCountPerDay));
  return { merchantId: MERCHANT_ID, db: createFakeDatabase(rows, []), now: NOW };
}

describe("highValueDeclineDetector", () => {
  it("flags a decline in high-value transaction count", async () => {
    const ctx = contextWith(4, 10); // -60%
    const [result] = await highValueDeclineDetector.detect(ctx);
    expect(result?.status).toBe("ANOMALY");
    expect(result?.type).toBe("HIGH_VALUE_TRANSACTION_DECLINE");
  });

  it("does not flag a small decline", async () => {
    const ctx = contextWith(9, 10); // -10%
    expect(await highValueDeclineDetector.detect(ctx)).toEqual([]);
  });

  it("reports INSUFFICIENT_DATA when there's too little baseline high-value history", async () => {
    const ctx = contextWith(1, 1); // 7 total baseline high-value transactions
    const [result] = await highValueDeclineDetector.detect(ctx);
    expect(result?.status).toBe("INSUFFICIENT_DATA");
  });

  it("ignores small transactions entirely — a spike in low-value volume doesn't mask a high-value decline", async () => {
    const ctx = contextWith(4, 10, 500); // same -60% high-value decline, plus unrelated small-payment volume
    const [result] = await highValueDeclineDetector.detect(ctx);
    expect(result?.status).toBe("ANOMALY");
    expect(result?.currentValue).toBe(4);
  });
});
