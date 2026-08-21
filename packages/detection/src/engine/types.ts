import type { Database } from "@paysherlock/database";
import type { AnomalyType, DetectionResult } from "@paysherlock/types";

/** Per-detector tunables — every threshold in this package is configurable
 * and documented (Phase 4 brief section 8/9), never hard-coded where a
 * merchant/operator might reasonably need a different value. Detectors
 * fall back to their own DEFAULT_CONFIG when a field is omitted. */
export interface DetectorRuntimeConfig {
  /** Length of the "current" window each detector evaluates. */
  windowDurationMs?: number;
  /** How many preceding comparable-time-of-day windows form the baseline. */
  lookbackPeriods?: number;
  /** Minimum current-window sample size below which a detector reports
   * INSUFFICIENT_DATA instead of guessing at an anomaly. */
  minSampleSize?: number;
  /** Minimum *combined* baseline sample size — protects against a
   * confident-looking change computed from an almost-empty baseline. */
  minBaselineSampleSize?: number;
}

export interface DetectionContext {
  merchantId: string;
  db: Database;
  now: Date;
  config?: DetectorRuntimeConfig;
}

export interface Detector {
  type: AnomalyType;
  /** Deterministic, merchant-scoped, safe to call repeatedly — see the
   * Phase 4 ADR for what "independently testable" and "explainable" mean
   * for this interface. Never throws for "no anomaly"; only for a genuine
   * unexpected failure (a database error), which the caller (the engine,
   * then the detection service) is responsible for handling safely. */
  detect(ctx: DetectionContext): Promise<DetectionResult[]>;
}
