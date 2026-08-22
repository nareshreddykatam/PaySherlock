import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDetectionScheduler } from "../index.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A controllable "detection run" — resolves only when the test calls
 * `resolve()`, so overlap timing can be driven deterministically instead
 * of racing real async scheduling. */
function deferredRun() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  const runOnce = vi.fn(() => promise);
  return { runOnce, resolve };
}

describe("startDetectionScheduler", () => {
  it("runs immediately on start, then again after each interval", async () => {
    const runOnce = vi.fn().mockResolvedValue(undefined);
    const scheduler = startDetectionScheduler({ intervalMs: 1000, runOnce });

    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(3);

    await scheduler.stop();
  });

  it("never starts a second run while the previous one is still in flight — no overlap", async () => {
    const { runOnce, resolve } = deferredRun();
    const onSkippedOverlap = vi.fn();
    const scheduler = startDetectionScheduler({ intervalMs: 1000, runOnce, onSkippedOverlap });

    expect(runOnce).toHaveBeenCalledTimes(1);

    // Two more ticks fire while the first run is still unresolved.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(runOnce).toHaveBeenCalledTimes(1); // still just the one in-flight run
    expect(onSkippedOverlap).toHaveBeenCalledTimes(2);

    resolve();
    await scheduler.stop();
  });

  it("resumes ticking once the in-flight run finishes", async () => {
    const { runOnce, resolve } = deferredRun();
    const scheduler = startDetectionScheduler({ intervalMs: 1000, runOnce });

    await vi.advanceTimersByTimeAsync(1000); // skipped — still in flight
    expect(runOnce).toHaveBeenCalledTimes(1);

    resolve();
    await vi.advanceTimersByTimeAsync(0); // let the .finally() clear the running flag
    runOnce.mockResolvedValue(undefined); // subsequent calls resolve immediately

    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });

  it("stop() waits for an in-flight run to finish before resolving — never yanks state mid-run", async () => {
    const { runOnce, resolve } = deferredRun();
    const scheduler = startDetectionScheduler({ intervalMs: 1000, runOnce });

    let stopped = false;
    const stopPromise = scheduler.stop().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false); // the first run hasn't finished yet

    resolve();
    await stopPromise;
    expect(stopped).toBe(true);
  });

  it("logs and continues (never throws) when a run rejects", async () => {
    const runOnce = vi.fn().mockRejectedValue(new Error("detection run failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const scheduler = startDetectionScheduler({ intervalMs: 1000, runOnce });
    await vi.advanceTimersByTimeAsync(0);
    expect(errorSpy).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2); // a failed run doesn't stop future ticks

    await scheduler.stop();
    errorSpy.mockRestore();
  });
});
