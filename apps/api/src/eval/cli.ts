// Manual evaluation runner: `pnpm --filter @paysherlock/api run eval:phase4`
// Uses the DeterministicProvider exclusively — fully offline, no
// credentials or live database required. Mirrors
// packages/agent/src/eval/cli.ts's shape/conventions.
import { runPhase4Evaluation } from "./runPhase4Evaluation.js";

async function main() {
  const report = await runPhase4Evaluation();

  for (const result of report.results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`[${status}] ${result.scenario}`);
    console.log(
      `  issuesCreated=${result.issuesCreated} investigationsTriggered=${result.investigationsTriggeredTotal}`,
    );
    for (const issue of result.finalIssues) {
      console.log(
        `    issue: type=${issue.type} dimension=${issue.dimension ?? "-"} severity=${issue.severity} ` +
          `status=${issue.status} rootCause=${issue.rootCause ?? "(none)"}`,
      );
    }
    for (const note of result.notes) console.log(`  note: ${note}`);
  }

  console.log("\nMetrics:");
  for (const [key, value] of Object.entries(report.metrics)) {
    console.log(`  ${key}: ${typeof value === "number" ? value.toFixed(3) : value}`);
  }

  const allPassed = report.results.every((r) => r.passed);
  if (!allPassed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Phase 4 evaluation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
