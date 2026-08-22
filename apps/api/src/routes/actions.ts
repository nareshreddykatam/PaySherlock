import type { FastifyInstance } from "fastify";
import { getActionById, resolveMerchant } from "@paysherlock/database";
import { NotFoundError } from "@paysherlock/types";
import type { ServerDeps } from "../server.js";
import { toActionResponse } from "../services/recommendationService.js";

export function registerActionRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{ Params: { id: string } }>("/actions/:id", async (request) => {
    const merchant = await resolveMerchant(deps.db, {});
    const action = await getActionById(deps.db, { id: request.params.id, merchantId: merchant.id });
    if (!action) {
      throw new NotFoundError(`Action "${request.params.id}" was not found`);
    }
    return toActionResponse(action);
  });
}
