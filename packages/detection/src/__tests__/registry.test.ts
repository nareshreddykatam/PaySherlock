import { describe, expect, it } from "vitest";
import { createDetectorRegistry, runDetectors } from "../engine/registry.js";
import {
  createFakeDatabase,
  makePayments,
  makeRefunds,
  type FakePayment,
  type FakeRefund,
} from "./fixtures.js";
import type { DetectionContext, Detector } from "../engine/types.js";

const MERCHANT_ID = "merchant-1";
const NOW = new Date("2026-08-21T11:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function windowFor(daysBack: number): { start: Date; end: Date } {
  const end = new Date(NOW.getTime() - daysBack * 24 * HOUR_MS);
  return { start: new Date(end.getTime() - HOUR_MS), end };
}

describe("createDetectorRegistry", () => {
  it("registers exactly the five Phase 4 detector categories", () => {
    const registry = createDetectorRegistry();
    expect(registry.map((d) => d.type).sort()).toEqual(
      [
        "HIGH_VALUE_TRANSACTION_DECLINE",
        "PAYMENT_FAILURE_SPIKE",
        "PAYMENT_METHOD_DEGRADATION",
        "REFUND_SPIKE",
        "TRANSACTION_VOLUME_DECLINE",
      ].sort(),
    );
  });
});

describe("runDetectors", () => {
  it("flattens results across every detector for normal (no-anomaly) data", async () => {
    const rows: FakePayment[] = [];
    const refunds: FakeRefund[] = [];
    for (let day = 0; day <= 7; day += 1) {
      const { start, end } = windowFor(day);
      rows.push(
        ...makePayments({
          merchantId: MERCHANT_ID,
          start,
          end,
          count: 92,
          status: "CAPTURED",
          method: "UPI",
          amount: 30_000,
        }),
        ...makePayments({
          merchantId: MERCHANT_ID,
          start,
          end,
          count: 8,
          status: "FAILED",
          method: "UPI",
          amount: 30_000,
        }),
        // Stable, comfortably-sampled high-value activity every window so
        // the high-value detector doesn't report INSUFFICIENT_DATA.
        ...makePayments({
          merchantId: MERCHANT_ID,
          start,
          end,
          count: 10,
          status: "CAPTURED",
          method: "NETBANKING",
          amount: 1_500_000,
        }),
      );
      refunds.push(
        ...makeRefunds({ merchantId: MERCHANT_ID, start, end, count: 5, amount: 30_000 }),
      );
    }
    const ctx: DetectionContext = {
      merchantId: MERCHANT_ID,
      db: createFakeDatabase(rows, refunds),
      now: NOW,
    };
    const outcome = await runDetectors(ctx);
    expect(outcome.results).toEqual([]);
    expect(outcome.errors).toEqual([]);
  });

  it("isolates one detector's failure — the rest still run and report", async () => {
    const throwingDetector: Detector = {
      type: "PAYMENT_FAILURE_SPIKE",
      detect: () => {
        throw new Error("simulated database failure");
      },
    };
    const okDetector: Detector = {
      type: "REFUND_SPIKE",
      detect: async () => [],
    };
    const ctx: DetectionContext = {
      merchantId: MERCHANT_ID,
      db: createFakeDatabase([], []),
      now: NOW,
    };

    const outcome = await runDetectors(ctx, [throwingDetector, okDetector]);
    expect(outcome.results).toEqual([]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]!.type).toBe("PAYMENT_FAILURE_SPIKE");
    expect(outcome.errors[0]!.message).toContain("simulated database failure");
  });
});
