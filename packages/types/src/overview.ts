import { z } from "zod";
import { HypothesisStatusSchema, TimeRangeSchema } from "./agent.js";

// Contract for GET /overview (apps/api) — a snapshot view built from the
// same deterministic tool/hypothesis pipeline packages/agent's investigation
// engine uses (see packages/agent/src/runtime/snapshot.ts), just without an
// LLM plan/narration step. This is NOT autonomous monitoring — it's the
// existing deterministic analysis run synchronously on request. See
// docs/decisions for the Phase 3 ADR.

export const OverviewMetricSchema = z.object({
  currentMinorUnits: z.number().int(),
  changePercent: z.number().nullable(),
});
export type OverviewMetric = z.infer<typeof OverviewMetricSchema>;

export const OverviewRateMetricSchema = z.object({
  current: z.number(),
  changePercentagePoints: z.number().nullable(),
});
export type OverviewRateMetric = z.infer<typeof OverviewRateMetricSchema>;

export const IssueSeveritySchema = z.enum(["critical", "warning", "normal"]);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

export const OverviewIssueSchema = z.object({
  id: z.string(),
  statement: z.string(),
  status: HypothesisStatusSchema,
  severity: IssueSeveritySchema,
  /** Short, human-readable evidence highlights — derived from the same
   * Evidence[] the investigation engine produces, never invented. */
  evidenceSummary: z.array(z.string()),
  estimatedImpactMinorUnits: z.number().int().optional(),
});
export type OverviewIssue = z.infer<typeof OverviewIssueSchema>;

export const OverviewResponseSchema = z.object({
  currency: z.string(),
  timeRange: TimeRangeSchema,
  /** False when the merchant has no payments at all in the window — the
   * signal the frontend uses to show an honest empty state instead of a
   * dashboard full of zeros. */
  hasData: z.boolean(),
  revenue: OverviewMetricSchema,
  successRate: OverviewRateMetricSchema,
  failureRate: OverviewRateMetricSchema,
  revenueAtRisk: z
    .object({
      estimatedImpactMinorUnits: z.number().int(),
      issueCount: z.number().int(),
    })
    .nullable(),
  issues: z.array(OverviewIssueSchema),
});
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;
