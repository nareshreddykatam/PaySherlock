import type { Database, PaymentMethod, PaymentStatus } from "@paysherlock/database";

// Deterministic synthetic demo data — the same "same time of day on
// preceding days" shape packages/detection's baseline engine expects, but
// written directly against a real (even local/throwaway) Postgres via
// Prisma, not a fake in-memory database — this is what makes `demo:run`
// exercise the actual, unmodified detection/investigation pipeline end to
// end, not a scripted approximation of it. Every row is clearly synthetic
// (id-prefixed `pay_demo_...`) and scoped to one dedicated demo merchant —
// see seed.ts/reset.ts for how that scoping is enforced.

export const DEMO_MERCHANT_MARKER = "demo_merchant";
export const DEMO_MERCHANT_NAME = "PaySherlock Demo Merchant";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface RowSpec {
  count: number;
  status: PaymentStatus;
  method: PaymentMethod;
  amount: number;
}

function spreadTimestamps(start: Date, end: Date, count: number): Date[] {
  if (count <= 0) return [];
  const span = end.getTime() - start.getTime();
  return Array.from(
    { length: count },
    (_, i) => new Date(start.getTime() + Math.floor((i / count) * span)),
  );
}

async function seedRows(
  db: Database,
  merchantId: string,
  start: Date,
  end: Date,
  specs: RowSpec[],
  idPrefix: string,
  counter: { n: number },
): Promise<string[]> {
  const createdRazorpayIds: string[] = [];
  for (const spec of specs) {
    for (const razorpayCreatedAt of spreadTimestamps(start, end, spec.count)) {
      counter.n += 1;
      const razorpayPaymentId = `pay_demo_${idPrefix}_${String(counter.n).padStart(5, "0")}`;
      await db.payment.create({
        data: {
          merchantId,
          razorpayPaymentId,
          amount: spec.amount,
          amountRefunded: 0,
          currency: "INR",
          status: spec.status,
          method: spec.method,
          captured: spec.status === "CAPTURED",
          international: false,
          raw: { demo: true, scenario: idPrefix },
          razorpayCreatedAt,
        },
      });
      createdRazorpayIds.push(razorpayPaymentId);
    }
  }
  return createdRazorpayIds;
}

/**
 * Seeds the "UPI degradation" scenario (the recommended primary Buildathon
 * demo — brief section 34): a healthy 7-day baseline, then a sharp UPI
 * failure-rate spike in the last hour. Returns the razorpayPaymentId of
 * one CAPTURED UPI payment from the *current* (degraded) window, useful
 * for a payment-scoped "Investigate this payment" -> recommendation demo
 * of the same real anomaly the merchant-wide flow just found — see
 * docs/buildathon/DEMO.md for why this (not an invented "duplicate
 * payment" detector, which doesn't exist in this codebase) is the honest
 * way to demo the recommendation step.
 */
export async function seedUpiDegradationScenario(
  db: Database,
  merchantId: string,
  now: Date = new Date(),
): Promise<{ targetPaymentRazorpayId: string }> {
  const counter = { n: 0 };

  // 7 days of healthy baseline, spread across each full day.
  for (let daysBack = 1; daysBack <= 7; daysBack += 1) {
    const dayEnd = new Date(now.getTime() - daysBack * DAY_MS);
    const dayStart = new Date(dayEnd.getTime() - DAY_MS);
    await seedRows(
      db,
      merchantId,
      dayStart,
      dayEnd,
      [
        { count: 46 * 24, status: "CAPTURED", method: "UPI", amount: 30_000 },
        { count: 4 * 24, status: "FAILED", method: "UPI", amount: 30_000 },
        { count: 48 * 24, status: "CAPTURED", method: "CARD", amount: 50_000 },
        { count: 2 * 24, status: "FAILED", method: "CARD", amount: 50_000 },
      ],
      "baseline",
      counter,
    );
  }

  // The last hour: UPI degraded sharply, Card stays normal.
  const currentEnd = now;
  const currentStart = new Date(now.getTime() - HOUR_MS);
  const currentRazorpayIds = await seedRows(
    db,
    merchantId,
    currentStart,
    currentEnd,
    [
      { count: 20, status: "CAPTURED", method: "UPI", amount: 30_000 },
      { count: 15, status: "FAILED", method: "UPI", amount: 30_000 },
      { count: 20, status: "CAPTURED", method: "CARD", amount: 50_000 },
      { count: 1, status: "FAILED", method: "CARD", amount: 50_000 },
    ],
    "current",
    counter,
  );

  // The first CAPTURED UPI payment in the degraded window — a real,
  // still-refundable payment to demo the recommendation flow against.
  const targetPaymentRazorpayId = currentRazorpayIds[0]!;
  return { targetPaymentRazorpayId };
}

export { HOUR_MS, DAY_MS };
