import type { Database, Recommendation, RecommendationType, RiskLevel } from "../client.js";

export interface CreateRecommendationParams {
  merchantId: string;
  issueId?: string | null;
  investigationId?: string | null;
  type: RecommendationType;
  title: string;
  explanation: string;
  riskLevel: RiskLevel;
  targetPaymentId?: string | null;
  amountMinorUnits?: number | null;
  currency?: string | null;
  expiresAt?: Date | null;
  /** NO_ACTION never needs approval — created directly in a terminal
   * SUCCEEDED state. Every financial type starts PENDING_APPROVAL. */
  initialStatus: "PENDING_APPROVAL" | "SUCCEEDED";
}

export async function createRecommendation(
  db: Database,
  params: CreateRecommendationParams,
): Promise<Recommendation> {
  return db.recommendation.create({
    data: {
      merchantId: params.merchantId,
      issueId: params.issueId ?? null,
      investigationId: params.investigationId ?? null,
      type: params.type,
      title: params.title,
      explanation: params.explanation,
      riskLevel: params.riskLevel,
      status: params.initialStatus,
      targetPaymentId: params.targetPaymentId ?? null,
      amountMinorUnits: params.amountMinorUnits ?? null,
      currency: params.currency ?? null,
      expiresAt: params.expiresAt ?? null,
    },
  });
}

export interface RecommendationScopeParams {
  id: string;
  merchantId: string;
}

export type RecommendationTransitionOutcome =
  | { outcome: "not_found" }
  | { outcome: "conflict"; recommendation: Recommendation }
  | { outcome: "expired"; recommendation: Recommendation }
  | { outcome: "ok"; recommendation: Recommendation };

async function findScoped(
  db: Database,
  params: RecommendationScopeParams,
): Promise<Recommendation | null> {
  return db.recommendation.findFirst({ where: { id: params.id, merchantId: params.merchantId } });
}

/**
 * The atomic, concurrency-safe transition PENDING_APPROVAL -> APPROVED.
 * The `updateMany` call is a single atomic `UPDATE ... WHERE` statement, so
 * two simultaneous approval requests can never both succeed — whichever
 * reaches Postgres first flips `status` away from PENDING_APPROVAL, and the
 * second's WHERE clause then matches zero rows. See docs/decisions.
 */
export async function approveRecommendation(
  db: Database,
  params: RecommendationScopeParams,
): Promise<RecommendationTransitionOutcome> {
  const now = new Date();
  const result = await db.recommendation.updateMany({
    where: {
      id: params.id,
      merchantId: params.merchantId,
      status: "PENDING_APPROVAL",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    data: { status: "APPROVED", approvedAt: now },
  });

  if (result.count === 1) {
    const updated = await findScoped(db, params);
    return { outcome: "ok", recommendation: updated! };
  }

  const current = await findScoped(db, params);
  if (!current) return { outcome: "not_found" };
  if (
    current.status === "PENDING_APPROVAL" &&
    current.expiresAt &&
    current.expiresAt.getTime() <= now.getTime()
  ) {
    // Lazily materialize the expiry so it's visible on every subsequent
    // read, not just discovered silently by this failed approval attempt.
    const expired = await db.recommendation.update({
      where: { id: current.id },
      data: { status: "EXPIRED" },
    });
    return { outcome: "expired", recommendation: expired };
  }
  return { outcome: "conflict", recommendation: current };
}

/** Same atomic-conditional-update pattern as approve, for the mirror
 * transition PENDING_APPROVAL -> REJECTED. */
export async function rejectRecommendation(
  db: Database,
  params: RecommendationScopeParams,
): Promise<RecommendationTransitionOutcome> {
  const now = new Date();
  const result = await db.recommendation.updateMany({
    where: { id: params.id, merchantId: params.merchantId, status: "PENDING_APPROVAL" },
    data: { status: "REJECTED", rejectedAt: now },
  });

  if (result.count === 1) {
    const updated = await findScoped(db, params);
    return { outcome: "ok", recommendation: updated! };
  }

  const current = await findScoped(db, params);
  return current ? { outcome: "conflict", recommendation: current } : { outcome: "not_found" };
}

export type BeginExecutionFrom = "APPROVED" | "FAILED";

/** APPROVED -> EXECUTING (first attempt) or FAILED -> EXECUTING (a
 * controlled retry, reusing the same Action row/idempotency key — see
 * docs/decisions). Never allows EXECUTING/SUCCEEDED/REJECTED/etc. to
 * re-enter EXECUTING. */
export async function beginRecommendationExecution(
  db: Database,
  params: RecommendationScopeParams & { from: BeginExecutionFrom },
): Promise<RecommendationTransitionOutcome> {
  const result = await db.recommendation.updateMany({
    where: { id: params.id, merchantId: params.merchantId, status: params.from },
    data: { status: "EXECUTING" },
  });

  if (result.count === 1) {
    const updated = await findScoped(db, params);
    return { outcome: "ok", recommendation: updated! };
  }

  const current = await findScoped(db, params);
  return current ? { outcome: "conflict", recommendation: current } : { outcome: "not_found" };
}

export async function completeRecommendationSuccess(
  db: Database,
  id: string,
): Promise<Recommendation> {
  return db.recommendation.update({ where: { id }, data: { status: "SUCCEEDED" } });
}

export async function completeRecommendationFailure(
  db: Database,
  id: string,
): Promise<Recommendation> {
  return db.recommendation.update({ where: { id }, data: { status: "FAILED" } });
}
