import { createFakeDatabase, type FakePayment, type FakeRefund } from "./fakeDatabase.js";
import { makePayments, makeRefunds } from "./generators.js";
import { HYPOTHESIS_IDS } from "../hypotheses/catalog.js";

// Synthetic (non-real, non-customer) fixtures for the 5 required Phase 2
// evaluation scenarios. All scenarios share the same 7-day baseline window
// (normal business) and differ only in what happens on the current day —
// so the same deterministic thresholds (hypotheses/rules.ts) have to tell
// them apart from real data, not from scenario-specific scripting.

export const EVAL_MERCHANT_ID = "eval-merchant";
const BASELINE_START = new Date("2026-08-13T00:00:00.000Z");
const BASELINE_END = new Date("2026-08-20T00:00:00.000Z");
const CURRENT_START = new Date("2026-08-20T00:00:00.000Z");
const CURRENT_END = new Date("2026-08-21T00:00:00.000Z");

export const EVAL_TIME_RANGE = {
  startTime: CURRENT_START.toISOString(),
  endTime: CURRENT_END.toISOString(),
};

function baselinePayments(): FakePayment[] {
  return [
    ...makePayments({
      merchantId: EVAL_MERCHANT_ID,
      start: BASELINE_START,
      end: BASELINE_END,
      count: 700,
      status: "CAPTURED",
      method: "UPI",
      amount: 30_000,
    }),
    ...makePayments({
      merchantId: EVAL_MERCHANT_ID,
      start: BASELINE_START,
      end: BASELINE_END,
      count: 35,
      status: "FAILED",
      method: "UPI",
      amount: 30_000,
    }),
    ...makePayments({
      merchantId: EVAL_MERCHANT_ID,
      start: BASELINE_START,
      end: BASELINE_END,
      count: 400,
      status: "CAPTURED",
      method: "CARD",
      amount: 300_000,
    }),
    ...makePayments({
      merchantId: EVAL_MERCHANT_ID,
      start: BASELINE_START,
      end: BASELINE_END,
      count: 20,
      status: "FAILED",
      method: "CARD",
      amount: 300_000,
      errorCode: "GATEWAY_ERROR",
    }),
    ...makePayments({
      merchantId: EVAL_MERCHANT_ID,
      start: BASELINE_START,
      end: BASELINE_END,
      count: 200,
      status: "CAPTURED",
      method: "NETBANKING",
      amount: 1_500_000,
    }),
    ...makePayments({
      merchantId: EVAL_MERCHANT_ID,
      start: BASELINE_START,
      end: BASELINE_END,
      count: 10,
      status: "FAILED",
      method: "NETBANKING",
      amount: 1_500_000,
      errorCode: "BANK_TIMEOUT",
    }),
  ];
}

function baselineRefunds(): FakeRefund[] {
  return makeRefunds({
    merchantId: EVAL_MERCHANT_ID,
    start: BASELINE_START,
    end: BASELINE_END,
    count: 21,
    amount: 30_000,
  });
}

function current(spec: {
  upiCaptured: number;
  upiFailed: number;
  cardCaptured: number;
  cardFailed: number;
  netbankingCaptured: number;
  netbankingFailed: number;
  refundCount: number;
}): { payments: FakePayment[]; refunds: FakeRefund[] } {
  const p = (
    count: number,
    status: FakePayment["status"],
    method: FakePayment["method"],
    amount: number,
  ) =>
    makePayments({
      merchantId: EVAL_MERCHANT_ID,
      start: CURRENT_START,
      end: CURRENT_END,
      count,
      status,
      method,
      amount,
    });

  return {
    payments: [
      ...p(spec.upiCaptured, "CAPTURED", "UPI", 30_000),
      ...p(spec.upiFailed, "FAILED", "UPI", 30_000),
      ...p(spec.cardCaptured, "CAPTURED", "CARD", 300_000),
      ...p(spec.cardFailed, "FAILED", "CARD", 300_000),
      ...p(spec.netbankingCaptured, "CAPTURED", "NETBANKING", 1_500_000),
      ...p(spec.netbankingFailed, "FAILED", "NETBANKING", 1_500_000),
    ],
    refunds: makeRefunds({
      merchantId: EVAL_MERCHANT_ID,
      start: CURRENT_START,
      end: CURRENT_END,
      count: spec.refundCount,
      amount: 30_000,
    }),
  };
}

export interface EvalScenario {
  name: string;
  description: string;
  question: string;
  db: ReturnType<typeof createFakeDatabase>;
  expectedRootCauseId: string | undefined;
  expectedRejectedIds: string[];
  /** [min, max] minor units — only meaningful when expectedRootCauseId is set. */
  expectedImpactRangeMinorUnits?: [number, number];
}

function buildScenarioDb(currentPayments: FakePayment[], currentRefunds: FakeRefund[]) {
  return createFakeDatabase(
    [...baselinePayments(), ...currentPayments],
    [...baselineRefunds(), ...currentRefunds],
  );
}

const scenarioA = current({
  upiCaptured: 60,
  upiFailed: 90,
  cardCaptured: 55,
  cardFailed: 3,
  netbankingCaptured: 27,
  netbankingFailed: 1,
  refundCount: 3,
});

const scenarioB = current({
  upiCaptured: 100,
  upiFailed: 5,
  cardCaptured: 57,
  cardFailed: 3,
  netbankingCaptured: 29,
  netbankingFailed: 1,
  refundCount: 50,
});

const scenarioC = current({
  upiCaptured: 24,
  upiFailed: 1,
  cardCaptured: 14,
  cardFailed: 1,
  netbankingCaptured: 7,
  netbankingFailed: 0,
  refundCount: 3,
});

const scenarioD = current({
  upiCaptured: 100,
  upiFailed: 5,
  cardCaptured: 57,
  cardFailed: 3,
  netbankingCaptured: 5,
  netbankingFailed: 0,
  refundCount: 3,
});

const scenarioE = current({
  upiCaptured: 98,
  upiFailed: 5,
  cardCaptured: 56,
  cardFailed: 2,
  netbankingCaptured: 28,
  netbankingFailed: 1,
  refundCount: 3,
});

export const EVAL_SCENARIOS: EvalScenario[] = [
  {
    name: "A — UPI degradation",
    description: "UPI failure rate spikes sharply while other methods stay normal.",
    question: "Why did successful payments drop yesterday?",
    db: buildScenarioDb(scenarioA.payments, scenarioA.refunds),
    expectedRootCauseId: HYPOTHESIS_IDS.UPI_FAILURE_INCREASE,
    expectedRejectedIds: [
      HYPOTHESIS_IDS.TRANSACTION_VOLUME_DECLINE,
      HYPOTHESIS_IDS.PAYMENT_METHOD_DEGRADATION,
    ],
    // Baseline (scaled to 1 day) ~63,000,000 minus current ~58,800,000.
    expectedImpactRangeMinorUnits: [1, 10_000_000],
  },
  {
    name: "B — Refund spike",
    description: "Refund volume/rate spikes sharply while payment success stays normal.",
    question: "Why did net revenue drop yesterday?",
    db: buildScenarioDb(scenarioB.payments, scenarioB.refunds),
    expectedRootCauseId: HYPOTHESIS_IDS.REFUND_SPIKE,
    expectedRejectedIds: [
      HYPOTHESIS_IDS.UPI_FAILURE_INCREASE,
      HYPOTHESIS_IDS.TRANSACTION_VOLUME_DECLINE,
      HYPOTHESIS_IDS.PAYMENT_METHOD_DEGRADATION,
    ],
  },
  {
    name: "C — Volume decline",
    description: "Payment attempts fall sharply while the success rate stays normal.",
    question: "Why did successful payments drop yesterday?",
    db: buildScenarioDb(scenarioC.payments, scenarioC.refunds),
    expectedRootCauseId: HYPOTHESIS_IDS.TRANSACTION_VOLUME_DECLINE,
    expectedRejectedIds: [
      HYPOTHESIS_IDS.UPI_FAILURE_INCREASE,
      HYPOTHESIS_IDS.PAYMENT_METHOD_DEGRADATION,
    ],
    // Baseline (scaled to 1 day) ~63,000,000 minus current ~15,420,000.
    expectedImpactRangeMinorUnits: [1, 100_000_000],
  },
  {
    name: "D — High-value transaction decline",
    description:
      "High-value (netbanking-bucket) transactions fall sharply; small transactions stay normal.",
    question: "Why did revenue drop yesterday?",
    db: buildScenarioDb(scenarioD.payments, scenarioD.refunds),
    expectedRootCauseId: HYPOTHESIS_IDS.HIGH_VALUE_DECLINE,
    expectedRejectedIds: [HYPOTHESIS_IDS.UPI_FAILURE_INCREASE, HYPOTHESIS_IDS.REFUND_SPIKE],
    // Baseline (scaled to 1 day) ~63,000,000 minus current ~27,600,000.
    expectedImpactRangeMinorUnits: [1, 100_000_000],
  },
  {
    name: "E — Normal business",
    description: "Everything within normal day-to-day variance — no anomaly.",
    question: "Why did successful payments drop yesterday?",
    db: buildScenarioDb(scenarioE.payments, scenarioE.refunds),
    expectedRootCauseId: undefined,
    expectedRejectedIds: [
      HYPOTHESIS_IDS.UPI_FAILURE_INCREASE,
      HYPOTHESIS_IDS.TRANSACTION_VOLUME_DECLINE,
      HYPOTHESIS_IDS.REFUND_SPIKE,
      HYPOTHESIS_IDS.PAYMENT_METHOD_DEGRADATION,
      HYPOTHESIS_IDS.HIGH_VALUE_DECLINE,
    ],
  },
];
