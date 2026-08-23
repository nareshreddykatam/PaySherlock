import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listRecommendations } from "@paysherlock/database";
import { NotFoundError, ValidationError } from "@paysherlock/types";
import type { ResolvedServerDeps } from "../server.js";
import {
  getRecommendationResponseById,
  toRecommendationResponse,
} from "../services/recommendationService.js";

const ListRecommendationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});

/** Same `{error: {code, message}}` shape as the global error handler
 * (errorHandler.ts) — used here directly (rather than an AppError
 * subclass) because these responses also carry the recommendation's
 * current state, which a client should refresh its view from rather than
 * just seeing a bare error. */
function conflictBody(code: string, message: string, recommendation: unknown) {
  return { error: { code, message }, recommendation };
}

/**
 * Every recommendation endpoint derives its merchant server-side
 * (`resolveMerchant`), the same trusted pattern as every other route —
 * never from client input. A client cannot change which merchant, payment,
 * amount, or risk level is acted on: those all come from the persisted
 * Recommendation row the server already validated, not from the request
 * body (approve/reject/retry accept no body at all). See docs/decisions.
 */
export function registerRecommendationRoutes(app: FastifyInstance, deps: ResolvedServerDeps): void {
  app.get("/recommendations", async (request) => {
    const query = ListRecommendationsQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new ValidationError(
        query.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }

    const merchant = await deps.resolveMerchantContext();
    const page = await listRecommendations(deps.db, {
      merchantId: merchant.id,
      limit: query.data.limit,
      cursor: query.data.cursor,
    });

    return {
      data: page.items.map((item) => toRecommendationResponse(item, item.action)),
      nextCursor: page.nextCursor,
    };
  });

  app.get<{ Params: { id: string } }>("/recommendations/:id", async (request) => {
    const merchant = await deps.resolveMerchantContext();
    const recommendation = await getRecommendationResponseById(deps, {
      id: request.params.id,
      merchantId: merchant.id,
    });
    if (!recommendation) {
      throw new NotFoundError(`Recommendation "${request.params.id}" was not found`);
    }
    return recommendation;
  });

  app.post<{ Params: { id: string } }>("/recommendations/:id/approve", async (request, reply) => {
    const merchant = await deps.resolveMerchantContext();
    const outcome = await deps.approveRecommendation({
      id: request.params.id,
      merchantId: merchant.id,
    });

    if (outcome.kind === "not_found") {
      throw new NotFoundError(`Recommendation "${request.params.id}" was not found`);
    }
    if (outcome.kind === "expired") {
      void reply.status(409);
      return conflictBody(
        "RECOMMENDATION_EXPIRED",
        "This recommendation has expired and can no longer be approved.",
        outcome.recommendation,
      );
    }
    if (outcome.kind === "conflict") {
      void reply.status(409);
      return conflictBody(
        "ALREADY_PROCESSED",
        "This recommendation has already been processed.",
        outcome.recommendation,
      );
    }
    return outcome.recommendation;
  });

  app.post<{ Params: { id: string } }>("/recommendations/:id/reject", async (request, reply) => {
    const merchant = await deps.resolveMerchantContext();
    const outcome = await deps.rejectRecommendation({
      id: request.params.id,
      merchantId: merchant.id,
    });

    if (outcome.kind === "not_found") {
      throw new NotFoundError(`Recommendation "${request.params.id}" was not found`);
    }
    if (outcome.kind === "conflict") {
      void reply.status(409);
      return conflictBody(
        "ALREADY_PROCESSED",
        "This recommendation has already been processed.",
        outcome.recommendation,
      );
    }
    return outcome.recommendation;
  });

  app.post<{ Params: { id: string } }>("/recommendations/:id/retry", async (request, reply) => {
    const merchant = await deps.resolveMerchantContext();
    const outcome = await deps.retryRecommendation({
      id: request.params.id,
      merchantId: merchant.id,
    });

    if (outcome.kind === "not_found") {
      throw new NotFoundError(`Recommendation "${request.params.id}" was not found`);
    }
    if (outcome.kind === "conflict" || outcome.kind === "expired") {
      void reply.status(409);
      return conflictBody(
        "NOT_RETRYABLE",
        "This recommendation is not in a state that can be retried.",
        outcome.recommendation,
      );
    }
    return outcome.recommendation;
  });
}
