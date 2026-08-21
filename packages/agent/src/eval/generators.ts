import type { FakePayment, FakeRefund } from "./fakeDatabase.js";

function evenlySpread(start: Date, end: Date, count: number): Date[] {
  if (count <= 0) return [];
  const span = end.getTime() - start.getTime();
  return Array.from(
    { length: count },
    (_, i) => new Date(start.getTime() + Math.floor((i / count) * span)),
  );
}

export interface MakePaymentsParams {
  merchantId: string;
  start: Date;
  end: Date;
  count: number;
  status: FakePayment["status"];
  method: FakePayment["method"];
  amount: number;
  errorCode?: string | null;
}

/** Deterministically spreads `count` identical synthetic payments evenly
 * across a window — no randomness, so scenario expectations are exact and
 * reproducible. */
export function makePayments(params: MakePaymentsParams): FakePayment[] {
  return evenlySpread(params.start, params.end, params.count).map((razorpayCreatedAt) => ({
    merchantId: params.merchantId,
    razorpayCreatedAt,
    status: params.status,
    method: params.method,
    amount: params.amount,
    errorCode: params.status === "FAILED" ? (params.errorCode ?? "PAYMENT_DECLINED") : null,
  }));
}

export interface MakeRefundsParams {
  merchantId: string;
  start: Date;
  end: Date;
  count: number;
  amount: number;
}

export function makeRefunds(params: MakeRefundsParams): FakeRefund[] {
  return evenlySpread(params.start, params.end, params.count).map((razorpayCreatedAt) => ({
    merchantId: params.merchantId,
    razorpayCreatedAt,
    status: "PROCESSED",
    amount: params.amount,
  }));
}
