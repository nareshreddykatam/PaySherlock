import type { DetectionResult } from "@paysherlock/types";
import { failureSpikeDetector } from "../detectors/failureSpike.js";
import { methodDegradationDetector } from "../detectors/methodDegradation.js";
import { refundSpikeDetector } from "../detectors/refundSpike.js";
import { volumeDeclineDetector } from "../detectors/volumeDecline.js";
import { highValueDeclineDetector } from "../detectors/highValueDecline.js";
import type { Detector, DetectionContext } from "./types.js";

/** The five Phase 4 detector categories — deliberately a small, fixed list
 * (see docs/decisions: "do not add a large catalog of detectors in
 * Phase 4"), not a plugin system. */
export function createDetectorRegistry(): Detector[] {
  return [
    failureSpikeDetector,
    methodDegradationDetector,
    refundSpikeDetector,
    volumeDeclineDetector,
    highValueDeclineDetector,
  ];
}

/** Runs every detector for one merchant and flattens the results. Each
 * detector is independent and its own failure is isolated — one detector
 * throwing (e.g. a transient database error) doesn't stop the others from
 * running, and is reported as a per-detector error rather than crashing
 * the whole detection run. */
export interface DetectorRunOutcome {
  results: DetectionResult[];
  errors: { type: string; message: string }[];
}

export async function runDetectors(
  ctx: DetectionContext,
  detectors: Detector[] = createDetectorRegistry(),
): Promise<DetectorRunOutcome> {
  const outcomes = await Promise.all(
    detectors.map(async (detector) => {
      try {
        return { type: detector.type, results: await detector.detect(ctx), error: undefined };
      } catch (error) {
        return {
          type: detector.type,
          results: [] as DetectionResult[],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return {
    results: outcomes.flatMap((o) => o.results),
    errors: outcomes
      .filter((o) => o.error !== undefined)
      .map((o) => ({ type: o.type, message: o.error! })),
  };
}
