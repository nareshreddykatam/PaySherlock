import type { Database, Issue, IssueLifecycleStatus } from "../client.js";
import { clampLimit, toPage, type CursorPageParams, type Page } from "./pagination.js";

export interface ListIssuesParams extends CursorPageParams {
  merchantId: string;
  status?: IssueLifecycleStatus;
}

/** Newest-first, merchant-scoped issue listing — backs `GET /issues`. */
export async function listIssues(db: Database, params: ListIssuesParams): Promise<Page<Issue>> {
  const limit = clampLimit(params.limit);
  const rows = await db.issue.findMany({
    where: { merchantId: params.merchantId, status: params.status },
    orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  return toPage(rows, limit);
}

export interface GetIssueByIdParams {
  id: string;
  /** Always required — an issue lookup is never allowed to cross merchant
   * boundaries, even by a guessed/leaked id. */
  merchantId: string;
}

export async function getIssueById(
  db: Database,
  params: GetIssueByIdParams,
): Promise<Issue | null> {
  return db.issue.findFirst({ where: { id: params.id, merchantId: params.merchantId } });
}
