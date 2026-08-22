// pnpm --filter @paysherlock/investigator-worker run demo:reset
//
// Deletes ONLY the dedicated demo merchant's data (scoped by merchantId at
// every step — never a bare `deleteMany({})`), then re-seeds the
// deterministic scenario fresh. Safe to run repeatedly; never touches any
// other merchant's rows. See docs/buildathon/DEMO.md.
import { getPrismaClient, resolveMerchant, disconnectPrismaClient } from "@paysherlock/database";
import { DEMO_MERCHANT_MARKER, DEMO_MERCHANT_NAME, seedUpiDegradationScenario } from "./data.js";

async function main() {
  const db = getPrismaClient();
  const merchant = await resolveMerchant(db, {
    razorpayAccountId: DEMO_MERCHANT_MARKER,
    defaultName: DEMO_MERCHANT_NAME,
  });
  const merchantId = merchant.id;

  // Deletion order respects foreign keys: Action -> Recommendation ->
  // Refund/PaymentEvent -> Issue -> Payment. Every call is scoped to this
  // one merchantId — never a bare deleteMany({}).
  const actionCount = await db.action.deleteMany({ where: { merchantId } });
  const recommendationCount = await db.recommendation.deleteMany({ where: { merchantId } });
  const refundCount = await db.refund.deleteMany({ where: { merchantId } });
  const paymentEventCount = await db.paymentEvent.deleteMany({
    where: { payment: { merchantId } },
  });
  const issueCount = await db.issue.deleteMany({ where: { merchantId } });
  const paymentCount = await db.payment.deleteMany({ where: { merchantId } });

  console.log(
    JSON.stringify(
      {
        msg: "Demo data reset",
        merchantId,
        deleted: {
          actions: actionCount.count,
          recommendations: recommendationCount.count,
          refunds: refundCount.count,
          paymentEvents: paymentEventCount.count,
          issues: issueCount.count,
          payments: paymentCount.count,
        },
      },
      null,
      2,
    ),
  );

  const { targetPaymentRazorpayId } = await seedUpiDegradationScenario(db, merchantId);
  console.log(
    JSON.stringify({
      msg: "Demo data re-seeded",
      scenario: "upi-degradation",
      targetPaymentRazorpayId,
    }),
  );

  await disconnectPrismaClient();
}

main().catch((error: unknown) => {
  console.error("Demo reset failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
