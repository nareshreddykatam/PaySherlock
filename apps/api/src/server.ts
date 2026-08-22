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

// Request correlation (Phase 6 observability): every request gets an id —
// the caller's own `X-Request-Id` if it looks safe to reuse, otherwise a
// freshly generated one — logged with every line for that request and
// echoed back in the response so a client (or a Buildathon judge poking at
// the API) can correlate their request with server logs. Never trusted for
// anything beyond correlation: it never gates auth, scoping, or any
// decision, so a forged value can't cause harm beyond a confusing log line.
const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveRequestId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const supplied = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(supplied) ? supplied[0] : supplied;
  return value !== undefined && REQUEST_ID_PATTERN.test(value) ? value : generateRequestId();
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
    genReqId: resolveRequestId,
  });

  app.addHook("onRequest", async (request, reply) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
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
