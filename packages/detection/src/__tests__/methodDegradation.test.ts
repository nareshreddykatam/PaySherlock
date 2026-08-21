import { describe, expect, it } from "vitest";
import { methodDegradationDetector } from "../detectors/methodDegradation.js";
import { createFakeDatabase, makePayments, type FakePayment } from "./fixtures.js";
import type { DetectionContext } from "../engine/types.js";

const MERCHANT_ID = "merchant-1";
const NOW = new Date("2026-08-21T11:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function windowFor(daysBack: number): { start: Date; end: Date } {
  const end = new Date(NOW.getTime() - daysBack * 24 * HOUR_MS);
  return { start: new Date(end.getTime() - HOUR_MS), end };
}

function methodPayments(
  daysBack: number,
  method: FakePayment["method"],
  captured: number,
  failed: number,
): FakePayment[] {
  const { start, end } = windowFor(daysBack);
  return [
    ...makePayments({
      merchantId: MERCHANT_ID,
      start,
      end,
      count: captured,
      status: "CAPTURED",
      method,
      amount: 30_000,
    }),
    ...makePayments({
      merchantId: MERCHANT_ID,
      start,
      end,
      count: failed,
      status: "FAILED",
      method,
      amount: 30_000,
    }),
  ];
}

describe("methodDegradationDetector", () => {
  it("flags one degraded method (UPI) while a healthy method (CARD) stays clean", async () => {
    const rows: FakePayment[] = [
      // Current window: UPI degraded (8% -> 20%), CARD healthy (5% -> 5.4%).
      ...methodPayments(0, "UPI", 40, 10), // 20% failure
      ...methodPayments(0, "CARD", 47, 3), // 6% failure
    ];
    for (let day = 1; day <= 7; day += 1) {
      rows.push(...methodPayments(day, "UPI", 46, 4)); // 8% baseline
      rows.push(...methodPayments(day, "CARD", 48, 2)); // ~4% baseline
    }
    const ctx: DetectionContext = {
      merchantId: MERCHANT_ID,
      db: createFakeDatabase(rows, []),
      now: NOW,
    };

    const results = await methodDegradationDetector.detect(ctx);
    const upiResult = results.find((r) => r.dimension === "UPI");
    const cardResult = results.find((r) => r.dimension === "CARD");

    expect(upiResult).toBeDefined();
    expect(upiResult!.status).toBe("ANOMALY");
    expect(upiResult!.type).toBe("PAYMENT_METHOD_DEGRADATION");
    expect(cardResult).toBeUndefined();
  });

  it("does not evaluate a method with too little current-window volume", async () => {
    const rows: FakePayment[] = [
      ...methodPayments(0, "WALLET", 2, 8), // only 10 wallet payments this window
    ];
    for (let day = 1; day <= 7; day += 1) {
      rows.push(...methodPayments(day, "WALLET", 46, 4));
    }
    const ctx: DetectionContext = {
      merchantId: MERCHANT_ID,
      db: createFakeDatabase(rows, []),
      now: NOW,
    };
    const results = await methodDegradationDetector.detect(ctx);
    expect(results.find((r) => r.dimension === "WALLET")).toBeUndefined();
  });

  it("reports INSUFFICIENT_DATA for a method with current volume but no baseline history", async () => {
    const rows: FakePayment[] = [...methodPayments(0, "EMI", 30, 5)];
    const ctx: DetectionContext = {
      merchantId: MERCHANT_ID,
      db: createFakeDatabase(rows, []),
      now: NOW,
    };
    const [result] = await methodDegradationDetector.detect(ctx);
    expect(result?.dimension).toBe("EMI");
    expect(result?.status).toBe("INSUFFICIENT_DATA");
  });

  it("returns no results when every method is within normal variance", async () => {
    const rows: FakePayment[] = [...methodPayments(0, "UPI", 46, 4)];
    for (let day = 1; day <= 7; day += 1) rows.push(...methodPayments(day, "UPI", 46, 4));
    const ctx: DetectionContext = {
      merchantId: MERCHANT_ID,
      db: createFakeDatabase(rows, []),
      now: NOW,
    };
    expect(await methodDegradationDetector.detect(ctx)).toEqual([]);
  });
});
