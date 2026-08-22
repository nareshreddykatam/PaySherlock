import { describe, expect, it } from "vitest";
import {
  generateNoActionCandidate,
  generateRefundRecommendationCandidate,
} from "../recommend/generateRecommendation.js";
import type { InvestigationResult } from "@paysherlock/types";

const BASE_INVESTIGATION: Pick<InvestigationResult, "rootCause" | "summary" | "meta"> = {
  rootCause: "UPI payment failure rate increased significantly",
  summary: "Investigation found a likely cause: UPI payment failure rate increased significantly.",
  meta: { investigationId: "inv_test1", stepsExecuted: 8, toolCalls: 8, provider: "deterministic" },
};

const PAYMENT = {
  id: "payment-1",
  captured: true,
  amount: 240_000,
  amountRefunded: 0,
  currency: "INR",
};

describe("generateRefundRecommendationCandidate", () => {
  it("produces a REFUND_PAYMENT candidate for the full refundable amount when a root cause was found", () => {
    const candidate = generateRefundRecommendationCandidate(BASE_INVESTIGATION, {
      payment: PAYMENT,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe("REFUND_PAYMENT");
    expect(candidate!.amountMinorUnits).toBe(240_000);
    expect(candidate!.currency).toBe("INR");
    expect(candidate!.targetPaymentId).toBe("payment-1");
    expect(candidate!.title).toContain("₹2,400");
    expect(candidate!.investigationId).toBe("inv_test1");
  });

  it("returns null when the investigation found no root cause", () => {
    const candidate = generateRefundRecommendationCandidate(
      { ...BASE_INVESTIGATION, rootCause: undefined },
      { payment: PAYMENT },
    );
    expect(candidate).toBeNull();
  });

  it("returns null when the payment has no refundable room left", () => {
    const candidate = generateRefundRecommendationCandidate(BASE_INVESTIGATION, {
      payment: { ...PAYMENT, amountRefunded: 240_000 },
    });
    expect(candidate).toBeNull();
  });

  it("returns null when the payment was never captured", () => {
    const candidate = generateRefundRecommendationCandidate(BASE_INVESTIGATION, {
      payment: { ...PAYMENT, captured: false },
    });
    expect(candidate).toBeNull();
  });

  it("only ever recommends up to the payment's own refundable amount, never an invented number", () => {
    const candidate = generateRefundRecommendationCandidate(BASE_INVESTIGATION, {
      payment: { ...PAYMENT, amountRefunded: 100_000 },
    });
    expect(candidate!.amountMinorUnits).toBe(140_000);
  });
});

describe("generateNoActionCandidate", () => {
  it("always produces a NO_ACTION candidate carrying the investigation's own summary", () => {
    const candidate = generateNoActionCandidate(BASE_INVESTIGATION);
    expect(candidate.type).toBe("NO_ACTION");
    expect(candidate.explanation).toBe(BASE_INVESTIGATION.summary);
    expect(candidate.investigationId).toBe("inv_test1");
  });
});
