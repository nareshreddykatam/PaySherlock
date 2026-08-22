// investigator worker — Phase 4's detection worker. Runs the deterministic
// detection engine (@paysherlock/detection) for the merchant, persisting
// anomalies as issues and triggering the existing Phase 2 investigation
// engine for newly-actionable ones — see
// packages/detection/src/engine/detectionRun.ts for the actual pipeline;
// this file only wires it up and schedules it.
//
// Two invocation modes:
//   pnpm --filter @paysherlock/investigator-worker run detect
//     Runs detection once, immediately, and exits — the manual/demo path
//     (Phase 4 brief section 27): never wait 15 minutes during development.
//   pnpm --filter @paysherlock/investigator-worker run start
//     Runs detection immediately, then repeats every DETECTION_INTERVAL_MS
//     (default 15 minutes, configurable) until stopped. A plain
//     setInterval loop — no BullMQ/Redis/cloud scheduler, consistent with
//     "the Buildathon MVP needs a practical worker" (brief section 26).
import { pathToFileURL } from "node:url";
import { getPrismaClient, resolveMerchant, disconnectPrismaClient } from "@paysherlock/database";
import { createInvestigationRunner, createProvider } from "@paysherlock/agent";
import { createToolRegistry } from "@paysherlock/tools";
import { runDetectionForMerchant } from "@paysherlock/detection";
import { loadConfig, type WorkerConfig } from "./config.js";

function generateDetectionRunId(): string {
  return `det_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Safe-to-log observability record for one detection run (Phase 4 brief
 * section 39) — counts and durations only, never payment data, never
 * secrets/credentials. */
function logRun(record: Record<string, unknown>): void {
  console.log(JSON.stringify(record));
}

async function runOnce(config: WorkerConfig): Promise<void> {
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

  const merchant = await resolveMerchant(db, {});
  const detectionRunId = generateDetectionRunId();
  const startedAt = new Date();
  logRun({
    detectionRunId,
    merchantId: merchant.id,
    startedAt: startedAt.toISOString(),
    status: "started",
  });

  try {
    const summary = await runDetectionForMerchant(
      { db, runInvestigation: (request) => investigationRunner(request, db) },
      merchant.id,
      startedAt,
    );
    const completedAt = new Date();
    logRun({
      detectionRunId,
      merchantId: merchant.id,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      executionTimeMs: completedAt.getTime() - startedAt.getTime(),
      resultCount: summary.detectorResultCount,
      issuesCreated: summary.issuesCreated,
      issuesUpdated: summary.issuesUpdated,
      issuesResolved: summary.issuesResolved,
      investigationsTriggered: summary.investigationsTriggered,
      investigationsFailed: summary.investigationsFailed,
      detectorErrors: summary.detectorErrors,
      status: "completed",
    });
  } catch (error) {
    logRun({
      detectionRunId,
      merchantId: merchant.id,
      status: "failed",
      error: error instanceof Error ? error.message : "Detection run failed unexpectedly.",
    });
    throw error;
  }
}

export interface DetectionScheduler {
  /** Stops the timer and waits for any in-flight run to finish before
   * resolving — a shutdown must never yank the database connection out
   * from under a run that's still writing. */
  stop: () => Promise<void>;
}

export interface StartDetectionSchedulerParams {
  intervalMs: number;
  runOnce: () => Promise<void>;
  /** Called instead of starting a new run when the previous one hasn't
   * finished yet — never left silent, since a hidden overlap would be
   * hard to diagnose later. */
  onSkippedOverlap?: () => void;
}

/**
 * A plain `setInterval` loop (Phase 4/6: no BullMQ/Redis/cloud scheduler
 * needed for a single-merchant MVP worker) that never runs two detection
 * passes concurrently for the same merchant — a tick that fires while the
 * previous run is still in progress is skipped, not queued or run
 * overlapping. Extracted from `main()` so the overlap/shutdown behavior is
 * unit-testable without spawning a real process.
 */
export function startDetectionScheduler(params: StartDetectionSchedulerParams): DetectionScheduler {
  let running = false;
  let currentRun: Promise<void> = Promise.resolve();

  const tick = () => {
    if (running) {
      params.onSkippedOverlap?.();
      return;
    }
    running = true;
    currentRun = params
      .runOnce()
      .catch((error: unknown) => {
        console.error("Detection run failed:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        running = false;
      });
  };

  tick();
  const interval = setInterval(tick, params.intervalMs);

  return {
    stop: async () => {
      clearInterval(interval);
      await currentRun;
    },
  };
}

async function main() {
  const config = loadConfig();
  const watch = process.argv.includes("--watch");

  if (!watch) {
    await runOnce(config);
    await disconnectPrismaClient();
    return;
  }

  console.log(
    JSON.stringify({
      msg: `Detection worker starting — running every ${config.DETECTION_INTERVAL_MS}ms`,
    }),
  );

  const scheduler = startDetectionScheduler({
    intervalMs: config.DETECTION_INTERVAL_MS,
    runOnce: () => runOnce(config),
    onSkippedOverlap: () =>
      console.log(
        JSON.stringify({
          msg: "Skipping detection tick — the previous run is still in progress",
          status: "skipped",
        }),
      ),
  });

  const shutdown = async () => {
    await scheduler.stop();
    await disconnectPrismaClient();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

// Only run the entrypoint's side effects (which read env vars and can
// call process.exit) when this file is executed directly — never on
// import, so `startDetectionScheduler` can be unit-tested from another
// module without accidentally starting the real worker. Compares resolved
// file URLs (not raw path strings) so this works cross-platform, including
// Windows' backslash paths.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(
      "Failed to start PaySherlock detection worker:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
}
