import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "@paysherlock/database";
import type { InvestigationRequest, InvestigationResult } from "@paysherlock/types";
import { registerErrorHandler } from "./errorHandler.js";
import { registerRawBodyCapture } from "./plugins/rawBody.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerPaymentRoutes } from "./routes/payments.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerInvestigationRoutes } from "./routes/investigations.js";

export interface ServerDeps {
  db: Database;
  webhookSecret: string;
  /** Runs one investigation. Bundles the LLM provider, tool registry, and
   * step limit — route handlers never see any of those, only this
   * function, which keeps route tests independent of provider/tooling
   * setup. See @paysherlock/agent's createInvestigationRunner. */
  runInvestigation: (request: InvestigationRequest) => Promise<InvestigationResult>;
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

  registerRawBodyCapture(app);
  registerErrorHandler(app);

  registerHealthRoute(app);
  registerPaymentRoutes(app, deps);
  registerWebhookRoutes(app, deps);
  registerInvestigationRoutes(app, deps);

  return app;
}
