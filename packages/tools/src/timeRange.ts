export interface PeriodWindow {
  start: Date;
  end: Date;
}

export function toPeriodWindow(range: { startTime: string; endTime: string }): PeriodWindow {
  return { start: new Date(range.startTime), end: new Date(range.endTime) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The window of `days` immediately preceding `current` — the default
 * baseline ("previous 7 days") when a tool caller doesn't supply one
 * explicitly. */
export function precedingDaysWindow(current: PeriodWindow, days: number): PeriodWindow {
  return { start: new Date(current.start.getTime() - days * DAY_MS), end: current.start };
}

export function windowDurationMs(window: PeriodWindow): number {
  return Math.max(1, window.end.getTime() - window.start.getTime());
}

/**
 * Resolves the baseline window a tool should compare against: the caller's
 * explicit range if given, otherwise the preceding 7 days.
 */
export function resolveBaselineWindow(
  current: PeriodWindow,
  explicit?: { baselineStartTime?: string; baselineEndTime?: string },
): PeriodWindow {
  if (explicit?.baselineStartTime && explicit.baselineEndTime) {
    return toPeriodWindow({
      startTime: explicit.baselineStartTime,
      endTime: explicit.baselineEndTime,
    });
  }
  return precedingDaysWindow(current, 7);
}

/**
 * Scales a raw total from `from` (e.g. a 7-day baseline) to what it would
 * be over `to`'s duration (e.g. 1 day), so count/amount metrics from
 * differently-sized windows can be compared fairly. Rate metrics (already
 * normalized) should NOT be scaled — only pass count/amount totals here.
 */
export function scaleToWindow(value: number, from: PeriodWindow, to: PeriodWindow): number {
  const factor = windowDurationMs(to) / windowDurationMs(from);
  return value * factor;
}
