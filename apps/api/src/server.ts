import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Database } from "@paysherlock/database";
import type {
  InvestigationRequest,
  InvestigationResult,
  OverviewResponse,
} from "@paysherlock/types";
import type {
  RecommendationActionOutcome,
  RecommendationScopeParams,
} from "./services/recommendationService.js";
import { registerErrorHandler } from "./errorHandler.js";
import { registerRawBodyCapture } from "./plugins/rawBody.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerPaymentRoutes } from "./routes/payments.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerInvestigationRoutes } from "./routes/investigations.js";
import { registerOverviewRoutes } from "./routes/overview.js";
import { registerIssueRoutes } from "./routes/issues.js";
import { registerRecommendationRoutes } from "./routes/recommendations.js";
import { registerActionRoutes } from "./routes/actions.js";

export interface ServerDeps {
  db: Database;
  webhookSecret: string;
  /** Runs one investigation. Bundles the LLM provider, tool registry, and
   * step limit — route handlers never see any of those, only this
   * function, which keeps route tests independent of provider/tooling
   * setup. See @paysherlock/agent's createInvestigationRunner. */
  runInvestigation: (request: InvestigationRequest) => Promise<InvestigationResult>;
  /** Builds the Overview/Issues snapshot for a trusted merchant id — see
   * services/overviewService.ts. */
  getOverview: (merchantId: string) => Promise<OverviewResponse>;
  /** Phase 5: the ONLY path that ever transitions a recommendation to
   * APPROVED and, in the same call, executes it — see
   * services/recommendationService.ts. Injected (rather than called
   * directly from the route, unlike the read-only Issue/Recommendation
   * queries) because it needs a configured RazorpayClient, matching how
   * `runInvestigation` is injected for needing a provider/tool registry. */
  approveRecommendation: (
    params: RecommendationScopeParams,
  ) => Promise<RecommendationActionOutcome>;
  rejectRecommendation: (params: RecommendationScopeParams) => Promise<RecommendationActionOutcome>;
  /** A controlled retry of a FAILED recommendation — reuses the same
   * Action/idempotency key, never creates a new logical action. */
  retryRecommendation: (params: RecommendationScopeParams) => Promise<RecommendationActionOutcome>;
  /** Origin allowed to call this API from a browser (apps/web). */
  corsOrigin?: string;
}

/**
 * Builds (but does not start listening on) the Fastify app. Takes its
 * dependencies as plain constructor args rather than reaching for globals,
 * so tests can inject a mock `db` and never need a live Postgres or
 * Razorpay credentials.
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      redact: {
        // Never log credentials, signatures, or auth headers.
        paths: ["req.headers.authorization", 'req.headers["x-razorpay-signature"]'],
        censor: "[redacted]",
      },
    },
  });

  void app.register(cors, { origin: deps.corsOrigin ?? "http://localhost:3000" });

  registerRawBodyCapture(app);
  registerErrorHandler(app);

  registerHealthRoute(app);
  registerPaymentRoutes(app, deps);
  registerWebhookRoutes(app, deps);
  registerInvestigationRoutes(app, deps);
  registerOverviewRoutes(app, deps);
  registerIssueRoutes(app, deps);
  registerRecommendationRoutes(app, deps);
  registerActionRoutes(app, deps);

  return app;
}
