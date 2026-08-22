import type { Action, Database, Recommendation } from "../client.js";
import { clampLimit, toPage, type CursorPageParams, type Page } from "./pagination.js";

export type RecommendationWithAction = Recommendation & { action: Action | null };

export interface ListRecommendationsParams extends CursorPageParams {
  merchantId: string;
}

export async function listRecommendations(
  db: Database,
  params: ListRecommendationsParams,
): Promise<Page<RecommendationWithAction>> {
  const limit = clampLimit(params.limit);
  const rows = await db.recommendation.findMany({
    where: { merchantId: params.merchantId },
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
