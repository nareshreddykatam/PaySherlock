import { z } from "zod";
import {
  IssueListResponseSchema,
  IssueSchema,
  RecommendationSchema,
  type Issue,
  type IssueListResponse,
} from "@paysherlock/types";
import { apiFetch, ApiError } from "./client";

// Track 03 (AI Revenue Recovery) — no packages/types schema of its own,
// same pattern apps/web already uses for payments (see docs/decisions):
// a frontend-local schema for a response shape that only this page needs.
const RejectedRecoveryCandidateSchema = z.object({
  paymentId: z.string(),
  razorpayPaymentId: z.string(),
  reason: z.string(),
});

export const RecoveryBatchSchema = z.object({
  issueId: z.string(),
  rootCause: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  limits: z.object({
    maxCandidates: z.number(),
    maxTotalAmountMinorUnits: z.number(),
  }),
  candidatesScanned: z.number(),
  eligibleCount: z.number(),
  rejectedCount: z.number(),
  amountEligibleMinorUnits: z.number(),
  stoppedReason: z.enum(["max_candidates_reached", "max_amount_reached"]).nullable(),
  rejectedCandidates: z.array(RejectedRecoveryCandidateSchema),
  recommendations: z.array(RecommendationSchema),
});
export type RecoveryBatch = z.infer<typeof RecoveryBatchSchema>;

export interface GetIssuesParams {
  cursor?: string;
  limit?: number;
}

export async function getIssues(params: GetIssuesParams = {}): Promise<IssueListResponse> {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();

  const raw = await apiFetch<unknown>(`/issues${qs ? `?${qs}` : ""}`);
  const parsed = IssueListResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The issues service returned an unexpected response shape.");
  }
  return parsed.data;
}

export async function getIssue(id: string): Promise<Issue> {
  const raw = await apiFetch<unknown>(`/issues/${encodeURIComponent(id)}`);
  const parsed = IssueSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The issues service returned an unexpected response shape.");
  }
  return parsed.data;
}

/**
 * Track 03 (AI Revenue Recovery): generates a bounded batch of
 * individually-approvable REFUND_PAYMENT recommendations for this issue's
 * affected payments. No body — the server derives the merchant, the
 * candidate window, and the batch limits; nothing here is client-supplied.
 * Never approves or executes anything by itself.
 */
export async function generateRecoveryBatch(issueId: string): Promise<RecoveryBatch> {
  const raw = await apiFetch<unknown>(`/issues/${encodeURIComponent(issueId)}/recovery-batch`, {
    method: "POST",
  });
  const parsed = RecoveryBatchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The recovery batch service returned an unexpected response shape.");
  }
  return parsed.data;
}

export function isNotEligibleForRecovery(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "NOT_ELIGIBLE_FOR_RECOVERY";
}
