import { describe, expect, it } from "vitest";
import { validateRecommendationCandidate } from "../validation/recommendationValidation.js";
import type { RecommendationCandidate } from "@paysherlock/types";

const MERCHANT_ID = "merchant-1";
const PAYMENT = {
  id: "payment-1",
  merchantId: MERCHANT_ID,
  captured: true,
  amount: 240_000,
  amountRefunded: 0,
  currency: "INR",
};

function candidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    type: "REFUND_PAYMENT",
    title: "Refund ₹2,400",
    explanation: "The payment appears duplicated.",
    targetPaymentId: PAYMENT.id,
    amountMinorUnits: 240_000,
    currency: "INR",
    ...overrides,
  };
}

describe("validateRecommendationCandidate", () => {
  it("accepts a NO_ACTION candidate unconditionally", () => {
    const result = validateRecommendationCandidate(
      { type: "NO_ACTION", title: "No action required", explanation: "Nothing unusual found." },
      { merchantId: MERCHANT_ID, targetPayment: null },
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a valid REFUND_PAYMENT candidate against a real, owned, eligible payment", () => {
    const result = validateRecommendationCandidate(candidate(), {
      merchantId: MERCHANT_ID,
      targetPayment: PAYMENT,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.amountMinorUnits).toBe(240_000);
      expect(result.currency).toBe("INR");
    }
  });

  it("rejects REFUND_PAYMENT with no targetPaymentId", () => {
    const result = validateRecommendationCandidate(candidate({ targetPaymentId: null }), {
      merchantId: MERCHANT_ID,
      targetPayment: null,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects when the target payment was not found", () => {
    const result = validateRecommendationCandidate(candidate(), {
      merchantId: MERCHANT_ID,
      targetPayment: null,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/not found/);
  });

  it("rejects when the target payment belongs to a different merchant", () => {
    const result = validateRecommendationCandidate(candidate(), {
      merchantId: "merchant-2",
      targetPayment: PAYMENT,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/does not belong/);
  });

  it("rejects a non-positive amount", () => {
    const result = validateRecommendationCandidate(candidate({ amountMinorUnits: 0 }), {
      merchantId: MERCHANT_ID,
      targetPayment: PAYMENT,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a missing currency", () => {
    const result = validateRecommendationCandidate(candidate({ currency: null }), {
      merchantId: MERCHANT_ID,
      targetPayment: PAYMENT,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an amount exceeding the refundable amount on the real payment record", () => {
    const result = validateRecommendationCandidate(candidate({ amountMinorUnits: 500_000 }), {
      merchantId: MERCHANT_ID,
      targetPayment: PAYMENT,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/exceeds the refundable amount/);
  });

  it("rejects an uncaptured target payment", () => {
    const result = validateRecommendationCandidate(candidate(), {
      merchantId: MERCHANT_ID,
      targetPayment: { ...PAYMENT, captured: false },
    });
    expect(result.valid).toBe(false);
  });
});
