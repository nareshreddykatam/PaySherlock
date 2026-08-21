import { getPrismaClient } from "@paysherlock/database";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const db = getPrismaClient();

  const app = buildServer({ db, webhookSecret: config.RAZORPAY_WEBHOOK_SECRET });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error("Failed to start PaySherlock API:", error instanceof Error ? error.message : error);
  process.exit(1);
});
