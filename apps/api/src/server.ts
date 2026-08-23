import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { resolveMerchant, type Database, type Merchant } from "@paysherlock/database";
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
  /**
   * Phase 7: resolves which Merchant every route acts as. Optional and
   * defaulting to today's exact behavior (`resolveMerchant(db, {})`,
   * i.e. the single default merchant) when omitted — existing tests that
   * mock `db.merchant.*` directly keep working unchanged. `index.ts` (the
   * real entrypoint) is the only place that ever overrides this, and only
   * when `NODE_ENV !== "production" && DEMO_MODE === true`, to resolve the
   * dedicated demo merchant instead. Never derived from a request — no
   * route reads a merchant id from a query/body/header, and this function
   * takes no request-derived arguments, so there is no way for a client to
   * influence which merchant it resolves to.
   */
  resolveMerchantContext?: () => Promise<Merchant>;
}

/** What every route registrar actually receives: `resolveMerchantContext`
 * resolved to its default when the caller of `buildServer` didn't supply
 * one — routes never need to know whether it was overridden. */
export type ResolvedServerDeps = ServerDeps & {
  resolveMerchantContext: () => Promise<Merchant>;
};

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

  const resolvedDeps: ResolvedServerDeps = {
    ...deps,
    resolveMerchantContext: deps.resolveMerchantContext ?? (() => resolveMerchant(deps.db, {})),
  };

  registerHealthRoute(app);
  // Webhook processing resolves its merchant from the verified Razorpay
  // payload (webhookProcessor.ts), never from resolvedDeps — deliberately
  // still given the raw `deps`, not `resolvedDeps`, so it can never be
  // pointed at the demo merchant.
  registerWebhookRoutes(app, deps);
  registerPaymentRoutes(app, resolvedDeps);
  registerInvestigationRoutes(app, resolvedDeps);
  registerOverviewRoutes(app, resolvedDeps);
  registerIssueRoutes(app, resolvedDeps);
  registerRecommendationRoutes(app, resolvedDeps);
  registerActionRoutes(app, resolvedDeps);

  return app;
}
