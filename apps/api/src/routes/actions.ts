import type { FastifyInstance } from "fastify";
import { getActionById } from "@paysherlock/database";
import { NotFoundError } from "@paysherlock/types";
import type { ResolvedServerDeps } from "../server.js";
import { toActionResponse } from "../services/recommendationService.js";

export function registerActionRoutes(app: FastifyInstance, deps: ResolvedServerDeps): void {
  app.get<{ Params: { id: string } }>("/actions/:id", async (request) => {
    const merchant = await deps.resolveMerchantContext();
    const action = await getActionById(deps.db, { id: request.params.id, merchantId: merchant.id });
    if (!action) {
      throw new NotFoundError(`Action "${request.params.id}" was not found`);
    }
    return toActionResponse(action);
  });
}
