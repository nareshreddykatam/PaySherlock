import { makePayments, makeRefunds, type FakePayment, type FakeRefund } from "@paysherlock/agent";
import { createPhase4FakeDatabase } from "./fakeDatabase.js";

// Synthetic (non-real, non-customer) fixtures for the Phase 4 required
// evaluation scenarios (brief section 35). Every scenario uses the same
// merchant and the same 1-hour "current" detection window (10:00–11:00 UTC
// on the current day).
//
// Baseline data is spread evenly across each *full* preceding day (not
// clustered into the matching hour) and generated at 24x the target
// per-hour count, so that:
//   - packages/detection's own comparable-hour-window baseline sees
//     exactly the target count in the 10:00–11:00 slice of each day
//     (evenlySpread's deterministic spacing guarantees this exactly), and
//   - the *triggered investigation* — which reuses Phase 2's engine
//     unmodified, and therefore always uses Phase 2's own "preceding 7
//     days, duration-scaled" baseline (see
//     packages/agent/src/runtime/context.ts) rather than detection's — also
//     sees a realistic, evenly-distributed baseline instead of an
//     artificially clustered one. Real payment traffic isn't clustered
//     into one hour of the day either way, so this is also the more
//     realistic fixture, not just a workaround.
//
// The per-hour baseline mix is deliberately small: packages/database's
// getPaymentAmounts (which segment_payments(amount_bucket) — and therefore
// the high-value-decline hypothesis check — depends on) caps a query at
// 2000 rows, a real and correct existing safety guard (never send an
// unbounded row dump to the LLM), not something this phase should touch.
// Phase 2's own baseline window for a triggered investigation spans the
// full preceding 7*24 hours in one lumped query, so the combined
// (all-methods) captured-payment count across that whole window must stay
// comfortably under 2000 — hence a small per-hour target, not the larger
// round numbers a first draft of this fixture used.
export const EVAL_MERCHANT_ID = "phase4-eval-merchant";
export const NOW = new Date("2026-08-21T11:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURS_PER_DAY = 24;

export function windowFor(daysBack: number, at: Date = NOW): { start: Date; end: Date } {
  const end = new Date(at.getTime() - daysBack * DAY_MS);
  return { start: new Date(end.getTime() - HOUR_MS), end };
}

function fullDayFor(daysBack: number, at: Date = NOW): { start: Date; end: Date } {
  const { end: hourEnd } = windowFor(daysBack, at);
  const dayStart = new Date(
    Date.UTC(hourEnd.getUTCFullYear(), hourEnd.getUTCMonth(), hourEnd.getUTCDate()),
  );
  return { start: dayStart, end: new Date(dayStart.getTime() + DAY_MS) };
}

interface DayMix {
  upiCaptured: number;
  upiFailed: number;
  cardCaptured: number;
  cardFailed: number;
  netbankingCaptured: number; // high-value method
  netbankingFailed: number;
  refundCount: number;
}

const STABLE_BASELINE_MIX: DayMix = {
  upiCaptured: 4,
  upiFailed: 1,
  cardCaptured: 4,
  cardFailed: 0,
  netbankingCaptured: 3,
  netbankingFailed: 0,
  refundCount: 3,
};

/** Current-window (day 0) data. Placed entirely in the 10:30–11:00
 * half-hour — the overlap between the first detection window
 * (10:00–11:00) and a *second*, later run up to 30 minutes after that
 * (10:30–11:30, scenario H's persistence check) — so both windows see
 * exactly the same, exact target count with no rounding/splitting at all
 * (splitting an odd target count across two buckets would silently
 * distort it — see git history of this fixture for the bug that caused). */
function currentPayments(mix: DayMix): FakePayment[] {
  const { end: hourEnd } = windowFor(0);
  const start = new Date(hourEnd.getTime() - 30 * 60 * 1000);
  const p = (
    count: number,
    status: FakePayment["status"],
    method: FakePayment["method"],
    amount: number,
  ) =>
    makePayments({
      merchantId: EVAL_MERCHANT_ID,
      start,
      end: hourEnd,
      count,
      status,
      method,
      amount,
    });
  return [
    ...p(mix.upiCaptured, "CAPTURED", "UPI", 30_000),
    ...p(mix.upiFailed, "FAILED", "UPI", 30_000),
    ...p(mix.cardCaptured, "CAPTURED", "CARD", 30_000),
    ...p(mix.cardFailed, "FAILED", "CARD", 30_000),
    ...p(mix.netbankingCaptured, "CAPTURED", "NETBANKING", 1_500_000),
    ...p(mix.netbankingFailed, "FAILED", "NETBANKING", 1_500_000),
  ];
}

function currentRefunds(mix: DayMix): FakeRefund[] {
  const { end: hourEnd } = windowFor(0);
  const start = new Date(hourEnd.getTime() - 30 * 60 * 1000);
  return makeRefunds({
    merchantId: EVAL_MERCHANT_ID,
    start,
    end: hourEnd,
    count: mix.refundCount,
    amount: 30_000,
  });
}

/** One baseline day's data, spread evenly across the *full* day so any
 * 1-hour slice of it — including the 10:00–11:00 comparable window — sees
 * exactly `mix`'s target count. */
function baselineDayPayments(daysBack: number, mix: DayMix): FakePayment[] {
  const { start, end } = fullDayFor(daysBack);
  const p = (
    count: number,
    status: FakePayment["status"],
    method: FakePayment["method"],
    amount: number,
  ) =>
    makePayments({
      merchantId: EVAL_MERCHANT_ID,
      start,
      end,
      count: count * HOURS_PER_DAY,
      status,
      method,
      amount,
    });
  return [
    ...p(mix.upiCaptured, "CAPTURED", "UPI", 30_000),
    ...p(mix.upiFailed, "FAILED", "UPI", 30_000),
    ...p(mix.cardCaptured, "CAPTURED", "CARD", 30_000),
    ...p(mix.cardFailed, "FAILED", "CARD", 30_000),
    ...p(mix.netbankingCaptured, "CAPTURED", "NETBANKING", 1_500_000),
    ...p(mix.netbankingFailed, "FAILED", "NETBANKING", 1_500_000),
  ];
}

function baselineDayRefunds(daysBack: number, mix: DayMix): FakeRefund[] {
  const { start, end } = fullDayFor(daysBack);
  return makeRefunds({
    merchantId: EVAL_MERCHANT_ID,
    start,
    end,
    count: mix.refundCount * HOURS_PER_DAY,
    amount: 30_000,
  });
}

function baselinePayments(): FakePayment[] {
  return Array.from({ length: 7 }, (_, i) => i + 1).flatMap((day) =>
    baselineDayPayments(day, STABLE_BASELINE_MIX),
  );
}

function baselineRefunds(): FakeRefund[] {
  return Array.from({ length: 7 }, (_, i) => i + 1).flatMap((day) =>
    baselineDayRefunds(day, STABLE_BASELINE_MIX),
  );
}

export interface Phase4Scenario {
  name: string;
  description: string;
  currentMix: Partial<DayMix>;
  /** For scenario H (persistence): a second, later "now" at which
   * detection is run again with the same anomalous mix. */
  secondRunAt?: Date;
}

function mix(overrides: Partial<DayMix>): DayMix {
  return { ...STABLE_BASELINE_MIX, ...overrides };
}

export const PHASE4_SCENARIOS: Phase4Scenario[] = [
  {
    name: "A — UPI degradation",
    description: "UPI failure rate spikes sharply while other methods stay normal.",
    currentMix: { upiCaptured: 30, upiFailed: 25 },
  },
  {
    name: "B — Refund spike",
    description: "Refund volume/rate spikes sharply while payment success stays normal.",
    currentMix: { refundCount: 30 },
  },
  {
    name: "C — Transaction volume decline",
    description: "Payment attempts fall sharply while the failure rate stays normal.",
    // refundCount also drops with captured volume — a near-total traffic
    // collapse realistically brings refund activity down with it, and
    // keeping it at the baseline level would spike refund-*rate* (refund
    // amount ÷ captured amount) purely from the shrunken denominator, a
    // side effect unrelated to what this scenario tests. See docs/decisions.
    currentMix: {
      upiCaptured: 1,
      upiFailed: 0,
      cardCaptured: 1,
      cardFailed: 0,
      netbankingCaptured: 0,
      netbankingFailed: 0,
      refundCount: 0,
    },
  },
  {
    name: "D — High-value transaction decline",
    description: "High-value (netbanking) transactions fall sharply; other activity stays normal.",
    // See the refundCount note on scenario C — netbanking payments carry
    // most of the captured *amount* despite being a small share of count,
    // so losing them alone already shrinks the refund-rate denominator
    // sharply; keep refunds proportionally quiet too.
    currentMix: { netbankingCaptured: 0, refundCount: 0 },
  },
  {
    name: "E — Normal business",
    description: "Everything within normal day-to-day variance — no anomaly.",
    currentMix: {},
  },
  {
    name: "F — Small sample",
    description: "Far too little data in the current window to trust any rate.",
    currentMix: {
      upiCaptured: 1,
      upiFailed: 1,
      cardCaptured: 0,
      cardFailed: 0,
      netbankingCaptured: 0,
      netbankingFailed: 0,
      refundCount: 0,
    },
  },
  {
    name: "G — One-window transient spike",
    description: "A sharp anomaly detected once, not (yet) confirmed by a second run.",
    currentMix: { upiCaptured: 30, upiFailed: 25 },
  },
  {
    name: "H — Persistent anomaly",
    description: "The same sharp anomaly confirmed by a second detection run later the same day.",
    currentMix: { upiCaptured: 30, upiFailed: 25 },
    secondRunAt: new Date(NOW.getTime() + 30 * 60 * 1000), // 30 minutes later, same day
  },
];

export function buildScenarioDatabase(scenario: Phase4Scenario, clock: () => Date) {
  const currentMixValue = mix(scenario.currentMix);
  const payments = [...currentPayments(currentMixValue), ...baselinePayments()];
  const refunds = [...currentRefunds(currentMixValue), ...baselineRefunds()];
  return createPhase4FakeDatabase(payments, refunds, clock);
}
