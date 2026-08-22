import { describe, expect, it } from "vitest";
import { validateRefundEligibility } from "../validation/refundEligibility.js";

const BASE = {
  captured: true,
  totalAmountMinorUnits: 240_000,
  alreadyRefundedMinorUnits: 0,
  requestedAmountMinorUnits: 240_000,
  requestedCurrency: "INR",
  paymentCurrency: "INR",
};

describe("validateRefundEligibility", () => {
  it("allows a full refund of an untouched captured payment", () => {
    const result = validateRefundEligibility(BASE);
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.refundableAmountMinorUnits).toBe(240_000);
  });

  it("allows a partial refund within the refundable amount", () => {
    const result = validateRefundEligibility({ ...BASE, requestedAmountMinorUnits: 100_000 });
    expect(result.eligible).toBe(true);
  });

  it("rejects an amount that exceeds the refundable amount", () => {
    const result = validateRefundEligibility({
      ...BASE,
      alreadyRefundedMinorUnits: 100_000,
      requestedAmountMinorUnits: 200_000, // only 140,000 remains refundable
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/exceeds the refundable amount/);
  });

  it("rejects a payment that has already been fully refunded", () => {
    const result = validateRefundEligibility({
      ...BASE,
      alreadyRefundedMinorUnits: 240_000,
      requestedAmountMinorUnits: 1,
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/already been fully refunded/);
  });

  it("rejects an uncaptured payment", () => {
    const result = validateRefundEligibility({ ...BASE, captured: false });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/not been captured/);
  });

  it("rejects a zero or negative amount", () => {
    expect(validateRefundEligibility({ ...BASE, requestedAmountMinorUnits: 0 }).eligible).toBe(
      false,
    );
    expect(validateRefundEligibility({ ...BASE, requestedAmountMinorUnits: -100 }).eligible).toBe(
      false,
    );
  });

  it("rejects a non-integer amount — money is always integer minor units", () => {
    const result = validateRefundEligibility({ ...BASE, requestedAmountMinorUnits: 100.5 });
    expect(result.eligible).toBe(false);
  });

  it("rejects a currency mismatch", () => {
    const result = validateRefundEligibility({ ...BASE, requestedCurrency: "USD" });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/currency/i);
  });

  it("is exactly satisfiable at the refundable boundary (not off-by-one)", () => {
    const result = validateRefundEligibility({
      ...BASE,
      alreadyRefundedMinorUnits: 40_000,
      requestedAmountMinorUnits: 200_000, // exactly the remaining amount
    });
    expect(result.eligible).toBe(true);
  });
});
