import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../fingerprint/fingerprint.js";

describe("computeFingerprint", () => {
  it("is identical for the same type/dimension/day — the dedup case", () => {
    const a = computeFingerprint({
      type: "PAYMENT_METHOD_DEGRADATION",
      dimension: "UPI",
      at: new Date("2026-08-21T10:15:00.000Z"),
    });
    const b = computeFingerprint({
      type: "PAYMENT_METHOD_DEGRADATION",
      dimension: "UPI",
      at: new Date("2026-08-21T22:45:00.000Z"),
    });
    expect(a).toBe(b);
  });

  it("differs for a different dimension (different payment method)", () => {
    const upi = computeFingerprint({
      type: "PAYMENT_METHOD_DEGRADATION",
      dimension: "UPI",
      at: new Date("2026-08-21T10:00:00.000Z"),
    });
    const card = computeFingerprint({
      type: "PAYMENT_METHOD_DEGRADATION",
      dimension: "CARD",
      at: new Date("2026-08-21T10:00:00.000Z"),
    });
    expect(upi).not.toBe(card);
  });

  it("differs for a different anomaly type", () => {
    const a = computeFingerprint({
      type: "PAYMENT_FAILURE_SPIKE",
      at: new Date("2026-08-21T10:00:00Z"),
    });
    const b = computeFingerprint({ type: "REFUND_SPIKE", at: new Date("2026-08-21T10:00:00Z") });
    expect(a).not.toBe(b);
  });

  it("differs for a different day bucket", () => {
    const day1 = computeFingerprint({
      type: "TRANSACTION_VOLUME_DECLINE",
      at: new Date("2026-08-21T10:00:00.000Z"),
    });
    const day2 = computeFingerprint({
      type: "TRANSACTION_VOLUME_DECLINE",
      at: new Date("2026-08-22T10:00:00.000Z"),
    });
    expect(day1).not.toBe(day2);
  });

  it("omits merchantId from the string — callers scope by merchant separately", () => {
    const fp = computeFingerprint({ type: "REFUND_SPIKE", at: new Date("2026-08-21T10:00:00Z") });
    expect(fp).not.toMatch(/merchant/i);
  });
});
