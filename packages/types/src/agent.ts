import { z } from "zod";

// Shared contracts for the AI investigation engine (packages/agent,
// packages/tools, apps/api). Defined with zod so both construction and
// external/model-influenced data can be runtime-validated, not just
// type-checked. See docs/decisions for the full design rationale.
//
// Money fields are integer minor units (see money.ts) — never floats.

// --- Investigation request/plan --------------------------------------------

export const TimeRangeSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const InvestigationRequestSchema = z.object({
  question: z.string().min(1).max(500),
  /** Always supplied by the trusted server-side context — never taken from
   * request input the model or client could influence. */
  merchantId: z.string().min(1),
  timeRange: TimeRangeSchema.optional(),
  context: z.string().max(2000).optional(),
  /** Phase 5: when a merchant investigates a specific payment (e.g. from
   * the Payments page), this carries that payment's internal id through so
   * apps/api can — only after the investigation completes, and only via
   * packages/actions' deterministic validation — offer a REFUND_PAYMENT
   * recommendation for that exact payment. `runInvestigation` itself never
   * reads this field; it exists purely to be threaded through to the
   * recommendation-generation step. Never used to scope tool queries. */
  targetPaymentId: z.string().min(1).optional(),
});
export type InvestigationRequest = z.infer<typeof InvestigationRequestSchema>;

export const InvestigationStepSchema = z.object({
  tool: z.string().min(1),
  /** Model-proposed arguments — never includes merchantId; the executor
   * injects the trusted merchantId itself. */
  input: z.record(z.string(), z.unknown()).default({}),
  rationale: z.string().max(300).optional(),
});
export type InvestigationStep = z.infer<typeof InvestigationStepSchema>;

export const CandidateHypothesisSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1).max(300),
});
export type CandidateHypothesis = z.infer<typeof CandidateHypothesisSchema>;

export const InvestigationPlanSchema = z.object({
  objective: z.string().min(1).max(300),
  steps: z.array(InvestigationStepSchema).min(1),
  candidateHypotheses: z.array(CandidateHypothesisSchema).min(1),
});
export type InvestigationPlan = z.infer<typeof InvestigationPlanSchema>;

// --- Tool calls/results ------------------------------------------------------

export const ToolCallSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  success: z.boolean(),
  /** Structured, already-aggregated data — never a raw row dump. Absent on
   * failure. */
  output: z.unknown().optional(),
  error: z.string().max(500).optional(),
  durationMs: z.number().nonnegative(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

// --- Hypotheses & evidence ----------------------------------------------------

export const HypothesisStatus = {
  PENDING: "PENDING",
  SUPPORTED: "SUPPORTED",
  REJECTED: "REJECTED",
  INCONCLUSIVE: "INCONCLUSIVE",
} as const;
export const HypothesisStatusSchema = z.enum(["PENDING", "SUPPORTED", "REJECTED", "INCONCLUSIVE"]);
export type HypothesisStatusType = z.infer<typeof HypothesisStatusSchema>;

export const HypothesisSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1).max(300),
  status: HypothesisStatusSchema,
  evidenceIds: z.array(z.string()).default([]),
  /** Deterministically computed — see evidence/scorer.ts. Never an
   * LLM-supplied number. */
  confidence: z.number().min(0).max(1).optional(),
  /** Deterministically computed composite ranking score, present once
   * evidence has been scored. */
  score: z.number().optional(),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  /** The tool result this evidence was derived from — every Evidence must
   * trace back to a real ToolResult, never an invented claim. */
  source: z.string().min(1),
  metric: z.string().min(1),
  observedValue: z.number(),
  baselineValue: z.number().optional(),
  /** Human-readable comparison, e.g. "+63% vs. baseline". Derived, not
   * free-typed by the model. */
  comparison: z.string().max(200).optional(),
  significance: z.enum(["low", "medium", "high"]).optional(),
  supportsHypothesisIds: z.array(z.string()).default([]),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// --- Result -------------------------------------------------------------------

export const BusinessImpactSchema = z.object({
  estimatedImpactMinorUnits: z.number().int(),
  currency: z.string().min(1),
  basis: z.string().min(1),
});
export type BusinessImpact = z.infer<typeof BusinessImpactSchema>;

export const InvestigationResultSchema = z.object({
  question: z.string(),
  summary: z.string().min(1),
  rootCause: z.string().optional(),
  /** Deterministic — see evidence/scorer.ts. Absent when no hypothesis is
   * supported (no significant anomaly). */
  confidence: z.enum(["low", "medium", "high"]).optional(),
  businessImpact: BusinessImpactSchema.optional(),
  evidence: z.array(EvidenceSchema),
  rejectedHypotheses: z.array(z.string()),
  /** The full, verified hypothesis set (every candidate, whatever its final
   * status) — added for Phase 3's hypothesis visualization. `.default([])`
   * keeps this additive/backward-compatible with any InvestigationResult
   * constructed before this field existed. `rejectedHypotheses` is kept
   * alongside it rather than removed, to avoid a breaking change to
   * existing consumers/tests. */
  hypotheses: z.array(HypothesisSchema).default([]),
  recommendations: z.array(z.string()),
  /** Observability metadata — see runtime/context.ts. Safe to log/display;
   * never contains secrets or hidden chain-of-thought. */
  meta: z.object({
    investigationId: z.string(),
    stepsExecuted: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    provider: z.string(),
  }),
});
export type InvestigationResult = z.infer<typeof InvestigationResultSchema>;
