import { z } from "zod";
import { InvestigationResultSchema } from "./agent.js";

// Contracts for Phase 4's proactive detection/issue system
// (packages/detection, apps/api's issue routes/service, workers/investigator).
// See docs/decisions for the detection-vs-investigation architecture split:
// code decides "is this anomalous", the existing Phase 2 agent decides
// "why is it probably happening" — this file only ever describes the
// former plus the persisted Issue that bridges the two.

export const AnomalyTypeSchema = z.enum([
  "PAYMENT_FAILURE_SPIKE",
  "PAYMENT_METHOD_DEGRADATION",
  "REFUND_SPIKE",
  "TRANSACTION_VOLUME_DECLINE",
  "HIGH_VALUE_TRANSACTION_DECLINE",
]);
export type AnomalyType = z.infer<typeof AnomalyTypeSchema>;

/** Anomaly severity — how serious the detected change is. Deliberately
 * distinct from an investigation's `confidence` (how strongly the evidence
 * supports a root cause): a CRITICAL anomaly with only MEDIUM root-cause
 * confidence is a valid, expected combination. Computed only from
 * magnitude/sample size/impact — never an LLM output. */
export const DetectionSeveritySchema = z.enum(["INFO", "WARNING", "CRITICAL"]);
export type DetectionSeverity = z.infer<typeof DetectionSeveritySchema>;

/** A detector either finds a real anomaly, or reports that it couldn't
 * reach a conclusion because the sample was too small — it never guesses.
 * The absence of a result at all (an empty array from `detect()`) is the
 * third, most common case: enough data, nothing anomalous. */
export const DetectionStatusSchema = z.enum(["ANOMALY", "INSUFFICIENT_DATA"]);
export type DetectionStatus = z.infer<typeof DetectionStatusSchema>;

export const DetectionResultSchema = z.object({
  type: AnomalyTypeSchema,
  status: DetectionStatusSchema,
  /** Set when the anomaly is specific to one dimension value, e.g. a
   * payment method name for PAYMENT_METHOD_DEGRADATION. Absent for
   * merchant-wide detectors. */
  dimension: z.string().optional(),
  metric: z.string().min(1),
  currentValue: z.number(),
  baselineValue: z.number(),
  absoluteChange: z.number(),
  relativeChange: z.number().nullable(),
  sampleSize: z.number().int().nonnegative(),
  minSampleSize: z.number().int().nonnegative(),
  baselineMin: z.number().optional(),
  baselineMax: z.number().optional(),
  comparisonWindows: z.number().int().nonnegative().optional(),
  /** Absent when status is INSUFFICIENT_DATA — there's nothing to grade. */
  severity: DetectionSeveritySchema.optional(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type DetectionResult = z.infer<typeof DetectionResultSchema>;

// --- Issue (persisted) -------------------------------------------------------

export const IssueStatusSchema = z.enum([
  "DETECTED",
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
  "DISMISSED",
  /** The automatic investigation call failed (provider/tool error) — the
   * issue is kept, never deleted; a later detection run may retry it. */
  "INVESTIGATION_FAILED",
]);
export type IssueStatus = z.infer<typeof IssueStatusSchema>;

export const IssueSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  type: AnomalyTypeSchema,
  title: z.string(),
  severity: DetectionSeveritySchema,
  status: IssueStatusSchema,
  detectedAt: z.string().datetime(),
  metric: z.string(),
  currentValue: z.number(),
  baselineValue: z.number(),
  absoluteChange: z.number(),
  relativeChange: z.number().nullable(),
  sampleSize: z.number().int(),
  dimension: z.string().nullable(),
  fingerprint: z.string(),
  occurrenceCount: z.number().int(),
  investigationId: z.string().nullable(),
  rootCause: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  estimatedImpactMinorUnits: z.number().int().nullable(),
  /** The full result of the triggered investigation, cached at the point
   * it completed — lets the issue-detail view render evidence/hypotheses
   * without a second investigation persistence layer. Never re-derived or
   * altered by the frontend. */
  investigation: InvestigationResultSchema.nullable(),
  /** Safe (no stack trace) message when status is INVESTIGATION_FAILED. */
  investigationError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const IssueListResponseSchema = z.object({
  data: z.array(IssueSchema),
  nextCursor: z.string().nullable(),
});
export type IssueListResponse = z.infer<typeof IssueListResponseSchema>;
