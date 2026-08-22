import { describe, expect, it, vi } from "vitest";
import { RazorpayApiError, type RazorpayClient } from "@paysherlock/razorpay";
import { executeRefund } from "../refund/executeRefund.js";

const IDEMPOTENCY_KEY = "paysherlock-refund-action1";

function fakeClient(overrides: {
  payment?: Partial<{
    captured: boolean;
    amount: number;
    amount_refunded: number;
    currency: string;
  }>;
  createRefund?: () => Promise<unknown>;
  fetchRefund?: () => Promise<unknown>;
}): RazorpayClient {
  return {
    payments: {
      fetch: vi.fn().mockResolvedValue({
        id: "pay_test1",
        captured: true,
        amount: 240_000,
        amount_refunded: 0,
        currency: "INR",
        ...overrides.payment,
      }),
    },
    refunds: {
      create:
        overrides.createRefund ??
        vi.fn().mockResolvedValue({
          id: "rfnd_test1",
          status: "processed",
          amount: 240_000,
          currency: "INR",
          payment_id: "pay_test1",
        }),
      fetch:
        overrides.fetchRefund ??
        vi.fn().mockResolvedValue({
          id: "rfnd_test1",
          status: "processed",
          amount: 240_000,
          currency: "INR",
          payment_id: "pay_test1",
        }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("executeRefund", () => {
  it("succeeds for an eligible, correctly-verified refund", async () => {
    const client = fakeClient({});
    const result = await executeRefund({
      razorpayClient: client,
      razorpayPaymentId: "pay_test1",
      amountMinorUnits: 240_000,
      currency: "INR",
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerReference).toBe("rfnd_test1");
      expect(result.providerStatus).toBe("processed");
    }
  });

  it("blocks execution — no provider refund call — when the live state shows it's already fully refunded", async () => {
    const createRefund = vi.fn();
    const client = fakeClient({ payment: { amount_refunded: 240_000 }, createRefund });

    const result = await executeRefund({
      razorpayClient: client,
      razorpayPaymentId: "pay_test1",
      amountMinorUnits: 240_000,
      currency: "INR",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe("NOT_ELIGIBLE");
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("blocks execution when the requested amount exceeds the live refundable amount", async () => {
    const createRefund = vi.fn();
    const client = fakeClient({ payment: { amount_refunded: 100_000 }, createRefund });

    const result = await executeRefund({
      razorpayClient: client,
      razorpayPaymentId: "pay_test1",
      amountMinorUnits: 200_000, // only 140,000 remains refundable live
      currency: "INR",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(false);
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("reports a safe failure (never throws) when Razorpay rejects the refund request", async () => {
    const client = fakeClient({
      createRefund: vi.fn().mockRejectedValue(new RazorpayApiError("failed", { status: 400 })),
    });

    const result = await executeRefund({
      razorpayClient: client,
      razorpayPaymentId: "pay_test1",
      amountMinorUnits: 240_000,
      currency: "INR",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("PROVIDER_HTTP_400");
      expect(result.errorMessage).not.toContain("stack");
    }
  });

  it("does not claim success when Razorpay's create response itself reports failed", async () => {
    const client = fakeClient({
      createRefund: vi.fn().mockResolvedValue({
        id: "rfnd_test1",
        status: "failed",
        amount: 240_000,
        currency: "INR",
        payment_id: "pay_test1",
      }),
    });

    const result = await executeRefund({
      razorpayClient: client,
      razorpayPaymentId: "pay_test1",
      amountMinorUnits: 240_000,
      currency: "INR",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe("PROVIDER_REFUND_FAILED");
  });

  it("does not claim success when the created refund cannot be verified (ambiguous result)", async () => {
    const client = fakeClient({
      fetchRefund: vi.fn().mockRejectedValue(new RazorpayApiError("network blip", { status: 502 })),
    });

    const result = await executeRefund({
      razorpayClient: client,
      razorpayPaymentId: "pay_test1",
      amountMinorUnits: 240_000,
      currency: "INR",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      // The refund id is preserved even though we couldn't confirm success.
      expect(result.providerReference).toBe("rfnd_test1");
    }
  });
});
