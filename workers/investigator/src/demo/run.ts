// pnpm --filter @paysherlock/investigator-worker run demo:run
//
// Runs the REAL detection/investigation pipeline immediately for the demo
// merchant only — no waiting for the 15-minute worker interval (brief
// section 28). Uses the exact same runDetectionForMerchant the scheduled
// worker and apps/api's evaluation harnesses use; nothing here is
// scripted or faked. Reports scenario -> detector -> issue ->
// investigation -> recommendation, matching the brief's required output.
import {
  getPrismaClient,
  resolveMerchant,
  disconnectPrismaClient,
  listIssues,
} from "@paysherlock/database";
import { createInvestigationRunner, createProvider } from "@paysherlock/agent";
import { createToolRegistry } from "@paysherlock/tools";
import { runDetectionForMerchant } from "@paysherlock/detection";
import { loadConfig } from "../config.js";
import { DEMO_MERCHANT_MARKER, DEMO_MERCHANT_NAME } from "./data.js";

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

  const merchant = await resolveMerchant(db, {
    razorpayAccountId: DEMO_MERCHANT_MARKER,
    defaultName: DEMO_MERCHANT_NAME,
  });

  console.log(`Running detection now for "${merchant.name}" (${merchant.id})...\n`);

  const summary = await runDetectionForMerchant(
    { db, runInvestigation: (request) => investigationRunner(request, db) },
    merchant.id,
  );

  console.log(
    JSON.stringify(
      {
        detectorResultCount: summary.detectorResultCount,
        issuesCreated: summary.issuesCreated,
        issuesUpdated: summary.issuesUpdated,
        investigationsTriggered: summary.investigationsTriggered,
        investigationsFailed: summary.investigationsFailed,
        detectorErrors: summary.detectorErrors,
      },
      null,
      2,
    ),
  );

  const { items: issues } = await listIssues(db, { merchantId: merchant.id, limit: 10 });
  console.log(`\n${issues.length} issue(s) for this merchant:`);
  for (const issue of issues) {
    console.log(`\n- ${issue.title} [${issue.severity}] (${issue.status})`);
    console.log(
      `  metric=${issue.metric} current=${issue.currentValue} baseline=${issue.baselineValue}`,
    );
    if (issue.rootCause) {
      console.log(`  root cause: ${issue.rootCause} (confidence: ${issue.confidence ?? "n/a"})`);
    }
    if (issue.estimatedImpactMinorUnits !== null) {
      console.log(`  estimated impact: ${issue.estimatedImpactMinorUnits} minor units`);
    }
  }

  console.log(
    "\nNo financial action was taken automatically — see docs/buildathon/DEMO.md for the " +
      "guarded-refund portion of the demo (recommendation -> explicit approval -> Razorpay Test " +
      "Mode -> verification -> audit), which requires a payment-scoped investigation from the " +
      "Investigation Command Center UI (or the Phase 6 evaluation harness, for a fully offline " +
      "demonstration of the same code path).",
  );

  await disconnectPrismaClient();
}

main().catch((error: unknown) => {
  console.error("Demo run failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
