import type { DetectionSeverity } from "@paysherlock/types";

// Deterministic severity — magnitude + sample-size confidence + (optional)
// estimated impact. Never persistence: a detector call has no memory of
// past runs, so "this has been happening for a while" is deliberately out
// of scope here and handled one layer up, where issue history actually
// lives (apps/api's detection service) — see docs/decisions. Two magnitude
// scales are supported because the detectors measure two different kinds
// of change: a percentage-point shift in a rate (failure/refund rate) vs.
// a relative (%) change in a count/amount (volume/high-value decline).

export type SeverityMagnitudeKind = "rate-points" | "relative";

export interface SeverityInput {
  kind: SeverityMagnitudeKind;
  /** Absolute magnitude of the change — percentage points for "rate-points"
   * (e.g. 0.055 for a 5.5pp rise), or a fraction for "relative" (e.g. 0.235
   * for a 23.5% decline). Always the absolute value; direction is the
   * detector's concern, not severity's. */
  magnitude: number;
  sampleSize: number;
  minSampleSize: number;
  /** A rough, optional estimate in minor units — only used to escalate an
   * already-meaningful anomaly, never to manufacture one out of a tiny
   * change. */
  estimatedImpactMinorUnits?: number;
}

const RATE_THRESHOLDS = { critical: 0.05, warning: 0.02 };
const RELATIVE_THRESHOLDS = { critical: 0.4, warning: 0.2 };

/** Impact large enough (₹1,00,000+) to justify treating an already
 * WARNING-or-above anomaly as CRITICAL regardless of sample-size
 * confidence — documented, not a hidden magic number. */
const HIGH_IMPACT_MINOR_UNITS = 10_000_000;

/** A sample only "strongly" supports a severity if it's comfortably above
 * the minimum, not just barely over the INSUFFICIENT_DATA line — otherwise
 * a borderline sample gets downgraded one level rather than allowed to
 * claim CRITICAL. */
const STRONG_SAMPLE_MULTIPLIER = 3;

export function computeSeverity(input: SeverityInput): DetectionSeverity {
  const thresholds = input.kind === "rate-points" ? RATE_THRESHOLDS : RELATIVE_THRESHOLDS;
  const magnitude = Math.abs(input.magnitude);

  let severity: DetectionSeverity =
    magnitude >= thresholds.critical
      ? "CRITICAL"
      : magnitude >= thresholds.warning
        ? "WARNING"
        : "INFO";

  const hasStrongSample = input.sampleSize >= input.minSampleSize * STRONG_SAMPLE_MULTIPLIER;
  if (!hasStrongSample) {
    severity = downgrade(severity);
  }

  const hasHighImpact =
    input.estimatedImpactMinorUnits !== undefined &&
    Math.abs(input.estimatedImpactMinorUnits) >= HIGH_IMPACT_MINOR_UNITS;
  if (hasHighImpact && severity !== "INFO") {
    severity = "CRITICAL";
  }

  return severity;
}

function downgrade(severity: DetectionSeverity): DetectionSeverity {
  if (severity === "CRITICAL") return "WARNING";
  if (severity === "WARNING") return "INFO";
  return "INFO";
}
