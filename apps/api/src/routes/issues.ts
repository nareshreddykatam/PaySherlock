import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getIssueById, listIssues, type Issue } from "@paysherlock/database";
import { NotFoundError, ValidationError, type InvestigationResult } from "@paysherlock/types";
import type { ResolvedServerDeps } from "../server.js";

const ListIssuesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});

/** Maps our internal Issue row to the API's response shape — never the
 * frontend's job to re-derive any of this from something else. Dates
 * become ISO strings and the cached investigation JSON is passed through
 * as-is (it was already a validated InvestigationResult when stored). */
function toIssueResponse(issue: Issue) {
  return {
    id: issue.id,
    merchantId: issue.merchantId,
    type: issue.type,
    title: issue.title,
    severity: issue.severity,
    status: issue.status,
    detectedAt: issue.detectedAt.toISOString(),
    metric: issue.metric,
    currentValue: issue.currentValue,
    baselineValue: issue.baselineValue,
    absoluteChange: issue.absoluteChange,
    relativeChange: issue.relativeChange,
    sampleSize: issue.sampleSize,
    dimension: issue.dimension,
    fingerprint: issue.fingerprint,
    occurrenceCount: issue.occurrenceCount,
    investigationId: issue.investigationId,
    rootCause: issue.rootCause,
    confidence: issue.confidence,
    estimatedImpactMinorUnits: issue.estimatedImpactMinorUnits,
    investigation: (issue.investigationResult as InvestigationResult | null) ?? null,
    investigationError: issue.investigationError,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}

export function registerIssueRoutes(app: FastifyInstance, deps: ResolvedServerDeps): void {
  app.get("/issues", async (request) => {
    const query = ListIssuesQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new ValidationError(
        query.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }

    // Merchant scoping is derived server-side, never from client input —
    // same trusted pattern as every other route. See docs/decisions.
    const merchant = await deps.resolveMerchantContext();
    const page = await listIssues(deps.db, {
      merchantId: merchant.id,
      limit: query.data.limit,
      cursor: query.data.cursor,
    });

    return { data: page.items.map(toIssueResponse), nextCursor: page.nextCursor };
  });

  app.get<{ Params: { id: string } }>("/issues/:id", async (request) => {
    const merchant = await deps.resolveMerchantContext();
    const issue = await getIssueById(deps.db, { id: request.params.id, merchantId: merchant.id });
    if (!issue) {
      throw new NotFoundError(`Issue "${request.params.id}" was not found`);
    }
    return toIssueResponse(issue);
  });
}
