import { getPrismaClient } from "@paysherlock/database";
import { createInvestigationRunner, createProvider } from "@paysherlock/agent";
import { createToolRegistry } from "@paysherlock/tools";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

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

  const app = buildServer({
    db,
    webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
    runInvestigation: (request) => investigationRunner(request, db),
  });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error("Failed to start PaySherlock API:", error instanceof Error ? error.message : error);
  process.exit(1);
});
