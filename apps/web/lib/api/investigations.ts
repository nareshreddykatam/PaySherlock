import { InvestigationResultSchema, type InvestigationResult } from "@paysherlock/types";
import { apiFetch } from "./client";

/**
 * Calls the real Phase 2 investigation engine — POST /investigations —
 * and validates the response against the shared InvestigationResult
 * contract before handing it to the UI. Never fabricates a result locally.
 */
export async function postInvestigation(question: string): Promise<InvestigationResult> {
  const raw = await apiFetch<unknown>("/investigations", {
    method: "POST",
    body: JSON.stringify({ question }),
  });

  const parsed = InvestigationResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The investigation service returned an unexpected response shape.");
  }
  return parsed.data;
}
