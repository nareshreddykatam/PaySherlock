// Manual evaluation runner: `pnpm --filter @paysherlock/api run eval:track03`
// Writes docs/evaluation/track03-report.json and .md. Fully offline — a
// mocked RazorpayClient only, no credentials or live database required.
// Mirrors cli6.ts's (Phase 6's) shape.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTrack03Evaluation, type Track03EvaluationReport } from "./runTrack03Evaluation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/eval -> repo root is four levels up.
const REPO_ROOT = resolve(__dirname, "../../../..");
const OUTPUT_DIR = resolve(REPO_ROOT, "docs/evaluation");

function renderMarkdown(report: Track03EvaluationReport): string {
  const lines: string[] = [];
  lines.push("# Track 03 (AI Revenue Recovery) — Evaluation Report");
  lines.push("");
  lines.push(
    `> **${report.environment.mode === "synthetic" ? "Synthetic evaluation." : ""}** ` +
      report.environment.disclosure,
  );
  lines.push("");
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push(`- **Git commit:** \`${report.gitCommit}\``);
  lines.push(`- **Provider:** ${report.environment.provider}`);
  lines.push("");

  lines.push("## Scenario results");
  lines.push("");
  lines.push("| ID | Scenario | Result |");
  lines.push("| -- | -------- | ------ |");
  for (const s of report.scenarios) {
    lines.push(`| ${s.id} | ${s.name} | ${s.passed ? "✅ PASS" : "❌ FAIL"} |`);
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

  const m = report.metrics;
  lines.push("## Measured recovery (full batch run)");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| ------ | ----- |");
  lines.push(`| Batch size | ${m.batchSize} |`);
  lines.push(`| Candidates found | ${m.candidatesFound} |`);
  lines.push(`| Candidates eligible | ${m.candidatesEligible} |`);
  lines.push(`| Candidates rejected | ${m.candidatesRejected} |`);
  lines.push(`| Candidates attempted | ${m.candidatesAttempted} |`);
  lines.push(`| Successful recoveries | ${m.successfulRecoveries} |`);
  lines.push(`| Failed recoveries | ${m.failedRecoveries} |`);
  lines.push(`| Amount eligible (minor units) | ${m.amountEligibleMinorUnits} |`);
  lines.push(`| Amount attempted (minor units) | ${m.amountAttemptedMinorUnits} |`);
  lines.push(`| Amount recovered (minor units) | ${m.amountRecoveredMinorUnits} |`);
  lines.push(`| Recovery rate | ${(m.recoveryRate * 100).toFixed(1)}% |`);
  lines.push(`| Duplicate execution count | ${m.duplicateExecutionCount} |`);
  lines.push(`| False-success count | ${m.falseSuccessCount} |`);
  lines.push(`| Stopping reason | ${m.stoppingReason ?? "batch exhausted"} |`);
  lines.push("");

  lines.push("## Limitations");
  lines.push("");
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const report = await runTrack03Evaluation();

  for (const result of report.scenarios) {
    console.log(`[${result.passed ? "PASS" : "FAIL"}] ${result.id} — ${result.name}`);
    for (const note of result.notes) console.log(`  note: ${note}`);
  }
  console.log("\nMeasured recovery:");
  console.log(JSON.stringify(report.metrics, null, 2));

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(
    resolve(OUTPUT_DIR, "track03-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await writeFile(resolve(OUTPUT_DIR, "track03-report.md"), renderMarkdown(report), "utf8");
  console.log(`\nWrote ${resolve(OUTPUT_DIR, "track03-report.json")}`);
  console.log(`Wrote ${resolve(OUTPUT_DIR, "track03-report.md")}`);

  const allPassed = report.scenarios.every((s) => s.passed);
  if (!allPassed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Track 03 evaluation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
