import { describe, expect, it } from "vitest";
import { refundSpikeDetector } from "../detectors/refundSpike.js";
import {
  createFakeDatabase,
  makePayments,
  makeRefunds,
  type FakePayment,
  type FakeRefund,
} from "./fixtures.js";
import type { DetectionContext } from "../engine/types.js";

const MERCHANT_ID = "merchant-1";
const NOW = new Date("2026-08-21T11:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const AMOUNT = 30_000;

function windowFor(daysBack: number): { start: Date; end: Date } {
  const end = new Date(NOW.getTime() - daysBack * 24 * HOUR_MS);
  return { start: new Date(end.getTime() - HOUR_MS), end };
}

function build(
  daysBack: number,
  capturedCount: number,
  refundCount: number,
): { payments: FakePayment[]; refunds: FakeRefund[] } {
  const { start, end } = windowFor(daysBack);
  return {
    payments: makePayments({
      merchantId: MERCHANT_ID,
      start,
      end,
      count: capturedCount,
      status: "CAPTURED",
      method: "UPI",
      amount: AMOUNT,
    }),
    refunds: makeRefunds({
      merchantId: MERCHANT_ID,
      start,
      end,
      count: refundCount,
      amount: AMOUNT,
    }),
  };
}

function contextWith(
  currentCaptured: number,
  currentRefunds: number,
  baselineCaptured: number,
  baselineRefunds: number,
): DetectionContext {
  const current = build(0, currentCaptured, currentRefunds);
  const payments = [...current.payments];
  const refunds = [...current.refunds];
  for (let day = 1; day <= 7; day += 1) {
    const b = build(day, baselineCaptured, baselineRefunds);
    payments.push(...b.payments);
    refunds.push(...b.refunds);
  }
  return { merchantId: MERCHANT_ID, db: createFakeDatabase(payments, refunds), now: NOW };
}

describe("refundSpikeDetector", () => {
  it("flags a refund-rate spike vs. baseline", async () => {
    // Baseline: 100 captured @ 30k, 3 refunds @ 30k -> rate = 90k/3,000k = 3%
    // Current: 100 captured @ 30k, 10 refunds @ 30k -> rate = 300k/3,000k = 10%
    const ctx = contextWith(100, 10, 100, 3);
    const [result] = await refundSpikeDetector.detect(ctx);
    expect(result?.status).toBe("ANOMALY");
    expect(result?.type).toBe("REFUND_SPIKE");
    expect(result!.absoluteChange).toBeGreaterThan(0.02);
  });

  it("does not flag ordinary refund fluctuation", async () => {
    // Both samples comfortably clear the minimum refund count; the rate
    // only moves 1pp (6% vs 5%), well under the anomaly threshold.
    const ctx = contextWith(100, 6, 100, 5);
    expect(await refundSpikeDetector.detect(ctx)).toEqual([]);
  });

  it("reports INSUFFICIENT_DATA when too few refunds occurred to trust the rate", async () => {
    // 1 refund out of very few payments — the brief's "1 failed out of 2" case, for refunds.
    const ctx = contextWith(100, 1, 100, 3);
    const [result] = await refundSpikeDetector.detect(ctx);
    expect(result?.status).toBe("INSUFFICIENT_DATA");
  });
});
