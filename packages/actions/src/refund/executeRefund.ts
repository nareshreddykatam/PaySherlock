import {
  RazorpayApiError,
  RazorpayMalformedResponseError,
  type RazorpayClient,
} from "@paysherlock/razorpay";
import { validateRefundEligibility } from "../validation/refundEligibility.js";

// The only place in this codebase that ever constructs a real refund
// request. Receives trusted, already-validated input — never a raw model
// response (see packages/actions' README-equivalent in docs/decisions).
// Re-validates against Razorpay's *live* payment state immediately before
// sending the request (Phase 5 brief section 29 — never trust a cached
// frontend value or a stale local read for money movement), and re-fetches
// the created refund afterward to verify it before ever reporting success
// (section 24 — never assume a 2xx response means correctly persisted
// state).

export interface ExecuteRefundParams {
  razorpayClient: RazorpayClient;
  razorpayPaymentId: string;
  amountMinorUnits: number;
  currency: string;
  reason?: string;
  /** Caller-supplied, deterministic — see registry/actionTypes.ts. This
   * function never generates or mutates it. */
  idempotencyKey: string;
}

export type ExecuteRefundResult =
  | { success: true; providerReference: string; providerStatus: string }
  | { success: false; errorCode: string; errorMessage: string; providerReference?: string };

function toFailure(
  error: unknown,
  fallbackCode: string,
  providerReference?: string,
): ExecuteRefundResult {
  if (error instanceof RazorpayApiError) {
    return {
      success: false,
      errorCode: `PROVIDER_HTTP_${error.status ?? "UNKNOWN"}`,
      errorMessage: "Razorpay rejected the refund request",
      providerReference,
    };
  }
  if (error instanceof RazorpayMalformedResponseError) {
    return {
      success: false,
      errorCode: "MALFORMED_RESPONSE",
      errorMessage: "Razorpay returned an unexpected response shape",
      providerReference,
    };
  }
  return {
    success: false,
    errorCode: fallbackCode,
    errorMessage: "An unexpected error occurred while contacting Razorpay",
    providerReference,
  };
}

export async function executeRefund(params: ExecuteRefundParams): Promise<ExecuteRefundResult> {
  let livePayment;
  try {
    livePayment = await params.razorpayClient.payments.fetch(params.razorpayPaymentId);
  } catch (error) {
    return toFailure(error, "PAYMENT_FETCH_FAILED");
  }

  // Stale-state protection: re-check eligibility against Razorpay's live
  // state, not the value the frontend displayed or our own possibly-stale
  // local Payment row.
  const eligibility = validateRefundEligibility({
    captured: livePayment.captured,
    totalAmountMinorUnits: livePayment.amount,
    alreadyRefundedMinorUnits: livePayment.amount_refunded ?? 0,
    requestedAmountMinorUnits: params.amountMinorUnits,
    requestedCurrency: params.currency,
    paymentCurrency: livePayment.currency,
  });
  if (!eligibility.eligible) {
    return { success: false, errorCode: "NOT_ELIGIBLE", errorMessage: eligibility.reason };
  }

  let refund;
  try {
    refund = await params.razorpayClient.refunds.create(
      params.razorpayPaymentId,
      {
        amountMinorUnits: params.amountMinorUnits,
        notes: params.reason ? { reason: params.reason } : undefined,
      },
      params.idempotencyKey,
    );
  } catch (error) {
    return toFailure(error, "PROVIDER_REQUEST_FAILED");
  }

  if (refund.status === "failed") {
    return {
      success: false,
      errorCode: "PROVIDER_REFUND_FAILED",
      errorMessage: "Razorpay reported the refund as failed",
      providerReference: refund.id,
    };
  }

  // Verification: never take the create response alone as proof of
  // success — re-fetch the resource and check again.
  try {
    const verified = await params.razorpayClient.refunds.fetch(refund.id);
    if (verified.status === "failed") {
      return {
        success: false,
        errorCode: "PROVIDER_REFUND_FAILED",
        errorMessage: "Razorpay reported the refund as failed on verification",
        providerReference: verified.id,
      };
    }
    return { success: true, providerReference: verified.id, providerStatus: verified.status };
  } catch (error) {
    // The refund may genuinely have been created (we have its id) but its
    // state could not be confirmed — an ambiguous result. Never claim
    // success here; the refund id is preserved so an operator can look it
    // up manually.
    return toFailure(error, "VERIFICATION_FAILED", refund.id);
  }
}
