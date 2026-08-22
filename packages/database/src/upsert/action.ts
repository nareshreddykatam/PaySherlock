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

/** APPROVED|FAILED -> EXECUTING. Kept in lock-step with
 * `beginRecommendationExecution` — callers always transition both rows
 * together. */
export async function markActionExecuting(db: Database, id: string): Promise<Action> {
  return db.action.update({ where: { id }, data: { status: "EXECUTING", startedAt: new Date() } });
}

export interface MarkActionSucceededParams {
  id: string;
  providerReference: string;
  providerStatus: string;
}

export async function markActionSucceeded(
  db: Database,
  params: MarkActionSucceededParams,
): Promise<Action> {
  return db.action.update({
    where: { id: params.id },
    data: {
      status: "SUCCEEDED",
      providerReference: params.providerReference,
      providerStatus: params.providerStatus,
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
}

export interface MarkActionFailedParams {
  id: string;
  /** Safe (no stack trace) code/message only — see docs/decisions. */
  errorCode: string;
  errorMessage: string;
  providerStatus?: string | null;
}

export async function markActionFailed(
  db: Database,
  params: MarkActionFailedParams,
): Promise<Action> {
  return db.action.update({
    where: { id: params.id },
    data: {
      status: "FAILED",
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
      providerStatus: params.providerStatus ?? null,
      completedAt: new Date(),
    },
  });
}
