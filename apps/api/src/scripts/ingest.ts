// Manual ingestion CLI: `pnpm --filter @paysherlock/api run ingest`
// Fetches recent payments from Razorpay Test Mode and upserts them into
// Postgres. Safe to run repeatedly — see ingestionService.ts.
import { getPrismaClient } from "@paysherlock/database";
import { RazorpayClient } from "@paysherlock/razorpay";
import { loadConfig } from "../config.js";
import { ingestRecentPayments } from "../services/ingestionService.js";

async function main() {
  const config = loadConfig();
  const db = getPrismaClient();
  const razorpay = new RazorpayClient({
    keyId: config.RAZORPAY_KEY_ID,
    keySecret: config.RAZORPAY_KEY_SECRET,
  });

  const results = await ingestRecentPayments({ db, razorpay }, { count: 50 });
  console.log(`Ingested ${results.length} payment(s) from Razorpay Test Mode.`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Ingestion failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
