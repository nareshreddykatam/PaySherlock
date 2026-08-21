import type { FastifyInstance } from "fastify";
import { resolveMerchant } from "@paysherlock/database";
import type { ServerDeps } from "../server.js";

export function registerOverviewRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get("/overview", async () => {
    // Same trusted, server-derived merchant scoping as every other route —
    // see docs/decisions.
    const merchant = await resolveMerchant(deps.db, {});
    return deps.getOverview(merchant.id);
  });
}
