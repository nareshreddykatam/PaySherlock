// Manual evaluation runner: `pnpm --filter @paysherlock/agent run eval`
// Uses the DeterministicProvider by default — fully offline, no
// credentials required. To evaluate against a real model instead, swap in
// AnthropicProvider (see provider/factory.ts) and re-run manually; this
// script intentionally does not do that automatically (Phase 2 brief,
// section 25: live model calls stay optional/manual, never part of the
// default test/eval path).
import { runEvaluation } from "./runEvaluation.js";

async function main() {
  const report = await runEvaluation();

  for (const result of report.results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`[${status}] ${result.scenario}`);
    console.log(`  expected root cause: ${result.expectedRootCause ?? "(none)"}`);
    console.log(`  actual root cause:   ${result.actualRootCause ?? "(none)"}`);
    console.log(
      `  steps=${result.stepsExecuted} toolCalls=${result.toolCalls} ` +
        `toolSuccesses=${result.toolCallSuccesses} evidence=${result.evidenceCount}`,
    );
  }

  console.log("\nMetrics:");
  for (const [key, value] of Object.entries(report.metrics)) {
    console.log(`  ${key}: ${typeof value === "number" ? value.toFixed(3) : value}`);
  }

  const allPassed = report.results.every((r) => r.passed);
  if (!allPassed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Evaluation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
