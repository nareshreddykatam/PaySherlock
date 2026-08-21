import type { TimeRange } from "@paysherlock/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BASELINE_DAYS = 7;

export interface DefaultToolArgs {
  startTime: string;
  endTime: string;
  baselineStartTime: string;
  baselineEndTime: string;
}

/**
 * Resolves the default time window every tool call in a plan is seeded
 * with, so neither a real model nor the deterministic provider has to do
 * date arithmetic: explicit `timeRange` if given, otherwise "yesterday"
 * (UTC) with a baseline of the preceding 7 days — matching the Phase 2
 * brief's compare_periods example. A step's own `input` can still override
 * any of these fields. Also reused by runtime/snapshot.ts (Phase 3's
 * Overview/Issues endpoint), which has no "question" to build a full
 * InvestigationRequest from — hence taking just `{ timeRange? }` rather
 * than the whole request.
 */
export function resolveDefaultToolArgs(
  request: { timeRange?: TimeRange },
  now: Date = new Date(),
): DefaultToolArgs {
  let start: Date;
  let end: Date;

  if (request.timeRange) {
    start = new Date(request.timeRange.startTime);
    end = new Date(request.timeRange.endTime);
  } else {
    const todayUtcMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    end = todayUtcMidnight;
    start = new Date(todayUtcMidnight.getTime() - DAY_MS);
  }

  const baselineEnd = start;
  const baselineStart = new Date(start.getTime() - DEFAULT_BASELINE_DAYS * DAY_MS);

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    baselineStartTime: baselineStart.toISOString(),
    baselineEndTime: baselineEnd.toISOString(),
  };
}

// --- Observability -----------------------------------------------------------

/** Safe-to-log metadata for one tool call within an investigation run.
 * Never includes secrets, credentials, or full tool payloads — just enough
 * to debug/evaluate agent behavior. See docs/decisions. */
export interface ToolCallLogEntry {
  investigationId: string;
  stepNumber: number;
  tool: string;
  /** Compact summary of the input shape, not the full arguments (e.g. for
   * a time-range input: `{"dimension":"method"}` — small objects are fine
   * as-is, this exists mainly to cap accidental large payloads). */
  inputSummary: string;
  success: boolean;
  /** Present only on failure — a short message, never a stack trace. */
  error?: string | undefined;
  durationMs: number;
}

export function summarizeToolInput(input: unknown): string {
  const json = JSON.stringify(input ?? {});
  const MAX_LENGTH = 300;
  return json.length > MAX_LENGTH ? `${json.slice(0, MAX_LENGTH)}…` : json;
}

export function generateInvestigationId(): string {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
