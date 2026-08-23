import type { Action, Database, Recommendation } from "../client.js";
import { clampLimit, toPage, type CursorPageParams, type Page } from "./pagination.js";

export type RecommendationWithAction = Recommendation & { action: Action | null };

export interface ListRecommendationsParams extends CursorPageParams {
  merchantId: string;
  /** Phase 8: filter to recommendations grouped under one triggering issue
   * (e.g. all recommendations a recovery batch created) — optional, never
   * a substitute for merchantId scoping. */
  issueId?: string;
}

export async function listRecommendations(
  db: Database,
  params: ListRecommendationsParams,
): Promise<Page<RecommendationWithAction>> {
  const limit = clampLimit(params.limit);
  const rows = await db.recommendation.findMany({
    where: { merchantId: params.merchantId, issueId: params.issueId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: { action: true },
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  return toPage(rows, limit);
}

export interface GetRecommendationByIdParams {
  id: string;
  /** Always required — never a bare `findUnique({id})` (see Issue's
   * equivalent query for the same merchant-isolation rationale). */
  merchantId: string;
}

export async function getRecommendationById(
  db: Database,
  params: GetRecommendationByIdParams,
): Promise<RecommendationWithAction | null> {
  return db.recommendation.findFirst({
    where: { id: params.id, merchantId: params.merchantId },
    include: { action: true },
  });
}

export interface FindRecommendedPaymentIdsParams {
  merchantId: string;
  paymentIds: string[];
}

/** Phase 8 (Track 03 revenue recovery): duplicate-candidate prevention — a
 * payment that already has ANY recommendation (regardless of status) is
 * never offered again as a fresh recovery candidate, so a batch can never
 * create two REFUND_PAYMENT recommendations for the same payment. */
export async function findRecommendedPaymentIds(
  db: Database,
  params: FindRecommendedPaymentIdsParams,
): Promise<Set<string>> {
  if (params.paymentIds.length === 0) return new Set();
  const rows = await db.recommendation.findMany({
    where: { merchantId: params.merchantId, targetPaymentId: { in: params.paymentIds } },
    select: { targetPaymentId: true },
  });
  return new Set(rows.map((row) => row.targetPaymentId).filter((id): id is string => id !== null));
}
