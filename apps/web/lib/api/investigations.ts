import { InvestigationResponseSchema, type InvestigationResponse } from "@paysherlock/types";
import { apiFetch } from "./client";

/**
 * Calls the real Phase 2 investigation engine — POST /investigations —
 * and validates the response against the shared contract before handing
 * it to the UI. Never fabricates a result locally. The response now also
 * carries the Phase 5 recommendation the server generated for this
 * investigation (REFUND_PAYMENT pending approval, or an already-terminal
 * NO_ACTION) — never computed or altered on the frontend.
 */
export async function postInvestigation(
  question: string,
  targetPaymentId?: string,
): Promise<InvestigationResponse> {
  const raw = await apiFetch<unknown>("/investigations", {
    method: "POST",
    body: JSON.stringify({ question, targetPaymentId }),
  });

  const parsed = InvestigationResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The investigation service returned an unexpected response shape.");
  }
  return parsed.data;
}
