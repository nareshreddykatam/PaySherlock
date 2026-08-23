import type { FastifyInstance } from "fastify";
import type { ResolvedServerDeps } from "../server.js";

export function registerOverviewRoutes(app: FastifyInstance, deps: ResolvedServerDeps): void {
  app.get("/overview", async () => {
    // Same trusted, server-derived merchant scoping as every other route —
    // see docs/decisions.
    const merchant = await deps.resolveMerchantContext();
    return deps.getOverview(merchant.id);
  });
}
