import {
  DEMO_MERCHANT_MARKER,
  DEMO_MERCHANT_NAME,
  getPrismaClient,
  resolveMerchant,
} from "@paysherlock/database";
import { createInvestigationRunner, createProvider } from "@paysherlock/agent";
import { createToolRegistry } from "@paysherlock/tools";
import { RazorpayClient } from "@paysherlock/razorpay";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { getOverview } from "./services/overviewService.js";
import {
  approveRecommendationAndExecute,
  rejectRecommendationById,
  retryRecommendationExecution,
} from "./services/recommendationService.js";

async function main() {
  const config = loadConfig();
  const db = getPrismaClient();

  const provider = createProvider({
    aiProvider: config.AI_PROVIDER,
    aiModel: config.AI_MODEL,
    aiApiKey: config.AI_API_KEY,
  });
  const registry = createToolRegistry();
  const investigationRunner = createInvestigationRunner({
    provider,
    registry,
    maxSteps: config.MAX_AGENT_STEPS,
  });

  // Test Mode only — see docs/decisions and README. RAZORPAY_KEY_ID/SECRET
  // must be Test Mode credentials (rzp_test_...); this client has no
  // concept of a "live" vs. "test" mode of its own, so that boundary is an
  // operational/credential discipline, not something the code enforces.
  const razorpayClient = new RazorpayClient({
    keyId: config.RAZORPAY_KEY_ID,
    keySecret: config.RAZORPAY_KEY_SECRET,
  });

  // Phase 7: the ONLY place merchant context is ever decided. DEMO_MODE is
  // a server-side env var (rejected outright at config-load time if
  // NODE_ENV=production — see config.ts) — a client can never request,
  // toggle, or override this. Every route still calls the exact same
  // deps.resolveMerchantContext() either way; only what config.ts allowed
  // it to be constructed as differs.
  const resolveMerchantContext =
    config.NODE_ENV !== "production" && config.DEMO_MODE
      ? () =>
          resolveMerchant(db, {
            razorpayAccountId: DEMO_MERCHANT_MARKER,
            defaultName: DEMO_MERCHANT_NAME,
          })
      : undefined;

  const app = buildServer({
    db,
    webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
    corsOrigin: config.CORS_ORIGIN,
    resolveMerchantContext,
    runInvestigation: (request) => investigationRunner(request, db),
    getOverview: (merchantId) => getOverview(db, merchantId),
    approveRecommendation: (params) =>
      approveRecommendationAndExecute({ db, razorpayClient }, params),
    rejectRecommendation: (params) => rejectRecommendationById({ db }, params),
    retryRecommendation: (params) => retryRecommendationExecution({ db, razorpayClient }, params),
  });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error("Failed to start PaySherlock API:", error instanceof Error ? error.message : error);
  process.exit(1);
});
