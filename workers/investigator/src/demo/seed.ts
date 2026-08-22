// pnpm --filter @paysherlock/investigator-worker run demo:seed
//
// Seeds the deterministic "UPI degradation" Buildathon demo scenario
// (brief section 25/26) against ONE dedicated demo merchant — never
// touches any other merchant's data. Requires a real (even local/
// throwaway) Postgres via DATABASE_URL; there is no live one in this
// sandbox, so this has been verified by inspection and by the equivalent
// synthetic-data logic already proven correct in
// apps/api/src/eval/scenarios.ts, not by an actual run here — see
// docs/buildathon/DEMO.md for the documented limitation.
import { getPrismaClient, resolveMerchant, disconnectPrismaClient } from "@paysherlock/database";
import { DEMO_MERCHANT_MARKER, DEMO_MERCHANT_NAME, seedUpiDegradationScenario } from "./data.js";

async function main() {
  const db = getPrismaClient();
  const merchant = await resolveMerchant(db, {
    razorpayAccountId: DEMO_MERCHANT_MARKER,
    defaultName: DEMO_MERCHANT_NAME,
  });

  const { targetPaymentRazorpayId } = await seedUpiDegradationScenario(db, merchant.id);

  console.log(
    JSON.stringify(
      {
        msg: "Demo data seeded",
        merchantId: merchant.id,
        merchantName: merchant.name,
        scenario: "upi-degradation",
        targetPaymentRazorpayId,
      },
      null,
      2,
    ),
  );
  console.log(
    "\nNext: pnpm --filter @paysherlock/investigator-worker run demo:run  (detect the anomaly now)",
  );

  await disconnectPrismaClient();
}

main().catch((error: unknown) => {
  console.error("Demo seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
