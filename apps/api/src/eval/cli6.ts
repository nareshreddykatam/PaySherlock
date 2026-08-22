// Manual evaluation runner: `pnpm --filter @paysherlock/api run eval:phase6`
// Writes docs/evaluation/phase6-report.json (machine-readable) and
// docs/evaluation/phase6-report.md (human-readable). Fully offline — the
// DeterministicProvider and a mocked RazorpayClient only, no credentials
// or live database required. Mirrors cli.ts's (Phase 4's) shape.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase6Evaluation, type Phase6EvaluationReport } from "./runPhase6Evaluation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/eval -> repo root is four levels up.
const REPO_ROOT = resolve(__dirname, "../../../..");
const OUTPUT_DIR = resolve(REPO_ROOT, "docs/evaluation");

function renderMarkdown(report: Phase6EvaluationReport): string {
  const lines: string[] = [];
  lines.push("# Phase 6 — End-to-End Evaluation Report");
  lines.push("");
  lines.push(
    "> **Synthetic evaluation.** Every scenario below runs against synthetic, non-real data " +
      "and a mocked Razorpay client — never live credentials, never a live database. These " +
      "results describe this harness's controlled scenarios, not real-world production accuracy.",
  );
  lines.push("");
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push(`- **Git commit:** \`${report.gitCommit}\``);
  lines.push(`- **Node:** ${report.environment.nodeVersion}`);
  lines.push(
    `- **Environment:** AI provider = ${report.environment.aiProvider}, Razorpay = ${report.environment.razorpay}, database = ${report.environment.database}`,
  );
  lines.push("");

  lines.push("## Scenario results");
  lines.push("");
  lines.push("| ID | Scenario | Category | Result |");
  lines.push("| -- | -------- | -------- | ------ |");
  for (const s of report.scenarios) {
    lines.push(`| ${s.id} | ${s.name} | ${s.category} | ${s.passed ? "✅ PASS" : "❌ FAIL"} |`);
  }
  lines.push("");

  for (const s of report.scenarios) {
    lines.push(`### ${s.id} — ${s.name}`);
    lines.push("");
    lines.push(`**Result:** ${s.passed ? "PASS" : "FAIL"}`);
    if (s.notes.length > 0) {
      lines.push("");
      for (const note of s.notes) lines.push(`- ${note}`);
    }
    lines.push("");
  }

  lines.push("## Metrics");
  lines.push("");
  lines.push("### Detection");
  lines.push(`- Recall: ${report.metrics.detection.recall.toFixed(2)}`);
  lines.push(`- False-positive rate: ${report.metrics.detection.falsePositiveRate.toFixed(2)}`);
  lines.push(`- Duplicate issue rate: ${report.metrics.detection.duplicateIssueRate}`);
  lines.push("");
  lines.push("### Investigation");
  lines.push(
    `- Trigger success rate: ${report.metrics.investigation.triggerSuccessRate.toFixed(2)}`,
  );
  lines.push(`- Root-cause accuracy: ${report.metrics.investigation.rootCauseAccuracy.toFixed(2)}`);
  lines.push(`- Evidence accuracy: ${report.metrics.investigation.evidenceAccuracy}`);
  lines.push("");
  lines.push("### Actions");
  lines.push(`- Approval success rate: ${report.metrics.actions.approvalSuccessRate.toFixed(2)}`);
  lines.push(
    `- Duplicate execution rate: ${report.metrics.actions.duplicateExecutionRate.toFixed(2)}`,
  );
  lines.push(
    `- Stale-state rejection rate: ${report.metrics.actions.staleStateRejectionRate.toFixed(2)}`,
  );
  lines.push(`- Action success rate: ${report.metrics.actions.actionSuccessRate.toFixed(2)}`);
  lines.push(`- False-success rate: ${report.metrics.actions.falseSuccessRate.toFixed(2)}`);
  lines.push("");
  lines.push("### Reliability");
  lines.push(`- Unhandled exceptions: ${report.metrics.reliability.unhandledExceptions}`);
  lines.push(`- Failed requests: ${report.metrics.reliability.failedRequests}`);
  lines.push(`- Retry correctness: ${report.metrics.reliability.retryCorrectness}`);
  lines.push("");
  lines.push("### Security");
  lines.push(
    `- Cross-merchant access failures blocked: ${report.metrics.security.crossMerchantAccessFailuresBlocked}`,
  );
  lines.push(
    `- Approval bypass attempts blocked: ${report.metrics.security.approvalBypassAttemptsBlocked}`,
  );
  lines.push("");

  lines.push("## Limitations");
  lines.push("");
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const report = await runPhase6Evaluation();

  for (const result of report.scenarios) {
    console.log(`[${result.passed ? "PASS" : "FAIL"}] ${result.id} — ${result.name}`);
    for (const note of result.notes) console.log(`  note: ${note}`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(
    resolve(OUTPUT_DIR, "phase6-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await writeFile(resolve(OUTPUT_DIR, "phase6-report.md"), renderMarkdown(report), "utf8");
  console.log(`\nWrote ${resolve(OUTPUT_DIR, "phase6-report.json")}`);
  console.log(`Wrote ${resolve(OUTPUT_DIR, "phase6-report.md")}`);

  const allPassed = report.scenarios.every((s) => s.passed);
  if (!allPassed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Phase 6 evaluation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
