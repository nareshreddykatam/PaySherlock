import type { Database, Action, RecommendationType } from "../client.js";

export interface CreateActionParams {
  merchantId: string;
  recommendationId: string;
  type: RecommendationType;
  paymentId?: string | null;
  amountMinorUnits?: number | null;
  currency?: string | null;
  /** Deterministic — see docs/decisions. Unique-constrained at the DB
   * level as a second guarantee alongside the application-level reuse
   * (the same recommendationId always maps to the same Action row, so
   * this key is only ever generated once, at creation). */
  idempotencyKey: string;
  approvedAt: Date;
}

/** Created exactly once, at approval time (Recommendation.recommendationId
 * is unique-constrained, so a second attempt to create one for the same
 * recommendation fails loudly rather than silently duplicating). */
export async function createAction(db: Database, params: CreateActionParams): Promise<Action> {
  return db.action.create({
    data: {
      merchantId: params.merchantId,
      recommendationId: params.recommendationId,
      type: params.type,
      status: "APPROVED",
      paymentId: params.paymentId ?? null,
      amountMinorUnits: params.amountMinorUnits ?? null,
      currency: params.currency ?? null,
      idempotencyKey: params.idempotencyKey,
      approvedAt: params.approvedAt,
    },
  });
}

export async function getActionByRecommendationId(
  db: Database,
  recommendationId: string,
): Promise<Action | null> {
  return db.action.findUnique({ where: { recommendationId } });
}

const EXECUTABLE_FROM: Action["status"][] = ["APPROVED", "FAILED"];

/** APPROVED|FAILED -> EXECUTING. Kept in lock-step with
 * `beginRecommendationExecution` — callers always transition both rows
 * together. Guarded by the same conditional-`updateMany` pattern as the
 * Issue/Recommendation state machines (SUCCEEDED -> EXECUTING, for
 * example, must never succeed) even though the Recommendation-level
 * atomic guard in `beginRecommendationExecution` is what actually
 * prevents concurrent callers from racing to this point — this is
 * defense in depth, not the primary guard. Returns null if the action is
 * not currently in an executable state. */
export async function markActionExecuting(db: Database, id: string): Promise<Action | null> {
  const result = await db.action.updateMany({
    where: { id, status: { in: EXECUTABLE_FROM } },
    data: { status: "EXECUTING", startedAt: new Date() },
  });
  if (result.count === 0) return null;
  return db.action.findUnique({ where: { id } });
}

export interface MarkActionSucceededParams {
  id: string;
  providerReference: string;
  providerStatus: string;
}

/** EXECUTING -> SUCCEEDED only. A completed action (SUCCEEDED or FAILED)
 * can never be re-marked successful — returns null rather than throwing,
 * matching the Issue/Recommendation guard pattern. */
export async function markActionSucceeded(
  db: Database,
  params: MarkActionSucceededParams,
): Promise<Action | null> {
  const result = await db.action.updateMany({
    where: { id: params.id, status: "EXECUTING" },
    data: {
      status: "SUCCEEDED",
      providerReference: params.providerReference,
      providerStatus: params.providerStatus,
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  if (result.count === 0) return null;
  return db.action.findUnique({ where: { id: params.id } });
}

export interface MarkActionFailedParams {
  id: string;
  /** Safe (no stack trace) code/message only — see docs/decisions. */
  errorCode: string;
  errorMessage: string;
  providerStatus?: string | null;
}

/** EXECUTING -> FAILED only. A SUCCEEDED action can never be overwritten
 * to FAILED (a provider success is final), matching the Issue/
 * Recommendation guard pattern. */
export async function markActionFailed(
  db: Database,
  params: MarkActionFailedParams,
): Promise<Action | null> {
  const result = await db.action.updateMany({
    where: { id: params.id, status: "EXECUTING" },
    data: {
      status: "FAILED",
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
      providerStatus: params.providerStatus ?? null,
      completedAt: new Date(),
    },
  });
  if (result.count === 0) return null;
  return db.action.findUnique({ where: { id: params.id } });
}
