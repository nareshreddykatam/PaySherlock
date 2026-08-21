import { describe, expect, it } from "vitest";
import {
  comparableBaselineWindows,
  currentWindow,
  dayBucket,
  windowDurationMs,
} from "../baseline/window.js";

describe("currentWindow", () => {
  it("returns a window of the given duration ending at `now`", () => {
    const now = new Date("2026-08-21T11:00:00.000Z");
    const window = currentWindow(now, 60 * 60 * 1000);
    expect(window.end).toEqual(now);
    expect(window.start).toEqual(new Date("2026-08-21T10:00:00.000Z"));
    expect(windowDurationMs(window)).toBe(60 * 60 * 1000);
  });
});

describe("comparableBaselineWindows", () => {
  it("builds N windows of the same duration, each one whole day further back", () => {
    const current = currentWindow(new Date("2026-08-21T11:00:00.000Z"), 60 * 60 * 1000);
    const baselines = comparableBaselineWindows(current, 3);

    expect(baselines).toHaveLength(3);
    expect(baselines[0]).toEqual({
      start: new Date("2026-08-20T10:00:00.000Z"),
      end: new Date("2026-08-20T11:00:00.000Z"),
    });
    expect(baselines[1]).toEqual({
      start: new Date("2026-08-19T10:00:00.000Z"),
      end: new Date("2026-08-19T11:00:00.000Z"),
    });
    expect(baselines[2]).toEqual({
      start: new Date("2026-08-18T10:00:00.000Z"),
      end: new Date("2026-08-18T11:00:00.000Z"),
    });
    for (const window of baselines) {
      expect(windowDurationMs(window)).toBe(windowDurationMs(current));
    }
  });

  it("returns an empty array when asked for zero comparison windows", () => {
    const current = currentWindow(new Date("2026-08-21T11:00:00.000Z"), 60 * 60 * 1000);
    expect(comparableBaselineWindows(current, 0)).toEqual([]);
  });
});

describe("dayBucket", () => {
  it("is stable across times within the same UTC day", () => {
    expect(dayBucket(new Date("2026-08-21T00:00:01.000Z"))).toBe(
      dayBucket(new Date("2026-08-21T23:59:59.000Z")),
    );
  });

  it("differs across a UTC day boundary", () => {
    expect(dayBucket(new Date("2026-08-21T23:59:59.000Z"))).not.toBe(
      dayBucket(new Date("2026-08-22T00:00:01.000Z")),
    );
  });
});
