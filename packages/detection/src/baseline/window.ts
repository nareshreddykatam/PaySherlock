// Baseline methodology (documented per the Phase 4 brief's requirement not
// to overclaim statistical sophistication): a detector compares one
// "current" window against N "comparable" windows — the same clock-time
// range on each of the N preceding days (e.g. today's 10:00–11:00 vs.
// 10:00–11:00 on each of the last 7 days), never a same-length-but-lumped
// multi-day baseline. This is a practical, explainable heuristic — a
// same-time-of-day comparison — not a forecasting model, and every window
// it compares has the *same* duration, so unlike packages/tools'
// compare_periods, no duration-scaling arithmetic is needed here at all.

export interface ComparisonWindow {
  start: Date;
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function windowDurationMs(window: ComparisonWindow): number {
  return window.end.getTime() - window.start.getTime();
}

/** The current window: `durationMs` ending at `now`. */
export function currentWindow(now: Date, durationMs: number): ComparisonWindow {
  return { start: new Date(now.getTime() - durationMs), end: now };
}

/** `count` windows of the same duration as `current`, each shifted back by
 * whole days — "the same time of day on each of the preceding N days". */
export function comparableBaselineWindows(
  current: ComparisonWindow,
  count: number,
): ComparisonWindow[] {
  const duration = windowDurationMs(current);
  return Array.from({ length: count }, (_, i) => {
    const shiftMs = (i + 1) * DAY_MS;
    return {
      start: new Date(current.start.getTime() - shiftMs),
      end: new Date(current.start.getTime() - shiftMs + duration),
    };
  });
}

/** Deterministic dedup bucket for an anomaly's fingerprint: the UTC
 * calendar day of `at`. Coarser than a detector's own detection window on
 * purpose — see docs/decisions: a day-level bucket lets one ongoing
 * anomaly keep updating the *same* issue across many detection runs and
 * window boundaries within a day (preventing investigation storms), while
 * still starting a fresh issue if the same anomaly type recurs on a later
 * day after being resolved. */
export function dayBucket(at: Date): string {
  return at.toISOString().slice(0, 10);
}
