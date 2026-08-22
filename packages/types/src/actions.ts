import { z } from "zod";
import { InvestigationResultSchema } from "./agent.js";

// Contracts for Phase 5's guarded recommendation/approval/action system.
// Hard rule this entire file exists to support: the LLM never executes a
// financial action. It may only ever produce explanatory text; everything
// else here — type, risk level, amount, eligibility — is computed
// deterministically and re-validated server-side before anything reaches
// Razorpay. See docs/decisions/0005-guarded-actions.md.

/** Deliberately tiny and closed — see docs/decisions on why the initial
 * action catalog is exactly one real action (REFUND_PAYMENT) plus the
 * non-financial NO_ACTION outcome. Never add a type here without also
 * adding a full validation/policy/executor path in packages/actions. */
export const RecommendationTypeSchema = z.enum(["REFUND_PAYMENT", "NO_ACTION"]);
export type RecommendationType = z.infer<typeof RecommendationTypeSchema>;

/** How serious the *financial exposure* of taking this action is — a
 * deterministic policy output (packages/actions/src/policy), never an LLM
 * judgment. Distinct from an investigation's `confidence`, which measures
 * how strongly the evidence supports the underlying root cause. */
export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const RecommendationStatusSchema = z.enum([
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
]);
export type RecommendationStatus = z.infer<typeof RecommendationStatusSchema>;

/** The execution-mechanical subset of the lifecycle — an Action row only
 * ever exists once a recommendation has been approved, so it never needs
 * PENDING_APPROVAL/REJECTED/EXPIRED states of its own (see docs/decisions
 * for why this is a separate, narrower state machine rather than
 * duplicating RecommendationStatus). */
export const ActionStatusSchema = z.enum(["APPROVED", "EXECUTING", "SUCCEEDED", "FAILED"]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ActionSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  recommendationId: z.string(),
  type: RecommendationTypeSchema,
  status: ActionStatusSchema,
  paymentId: z.string().nullable(),
  amountMinorUnits: z.number().int().nullable(),
  currency: z.string().nullable(),
  idempotencyKey: z.string(),
  /** Razorpay's own id for the created resource, e.g. `rfnd_xxx`. */
  providerReference: z.string().nullable(),
  /** Razorpay's own status string for that resource at last check, e.g.
   * "processed" — kept separate from our `status` so a look at raw
   * provider state is always possible without reinterpreting our enum. */
  providerStatus: z.string().nullable(),
  /** Safe (no stack trace, no request/response body) error metadata only. */
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type Action = z.infer<typeof ActionSchema>;

export const RecommendationSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  issueId: z.string().nullable(),
  investigationId: z.string().nullable(),
  type: RecommendationTypeSchema,
  title: z.string(),
  /** LLM-influenced explanatory text is fine here — this field is never
   * used to decide anything, only to display why PaySherlock is
   * suggesting the action. */
  explanation: z.string(),
  riskLevel: RiskLevelSchema,
  status: RecommendationStatusSchema,
  targetPaymentId: z.string().nullable(),
  amountMinorUnits: z.number().int().nullable(),
  currency: z.string().nullable(),
  /** Present once an Action exists (i.e. once approved) — a read
   * convenience so the frontend doesn't need a second round trip; the
   * Action row itself remains the single source of truth for execution
   * state (see docs/decisions). */
  action: ActionSchema.nullable(),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const RecommendationListResponseSchema = z.object({
  data: z.array(RecommendationSchema),
  nextCursor: z.string().nullable(),
});
export type RecommendationListResponse = z.infer<typeof RecommendationListResponseSchema>;

// --- Untrusted candidate input ------------------------------------------------

/** The shape a recommendation *candidate* must satisfy before it's allowed
 * anywhere near persistence — whether it originated from a deterministic
 * bridge off an investigation result (this phase's only source) or, in
 * principle, a future free-form model output. Deliberately does NOT
 * include `riskLevel` or `status` — those are never caller-supplied, only
 * ever computed by packages/actions' policy and the state machine. See
 * docs/decisions section on why AI output is untrusted input. */
export const RecommendationCandidateSchema = z.object({
  type: RecommendationTypeSchema,
  title: z.string().min(1).max(200),
  explanation: z.string().min(1).max(2000),
  investigationId: z.string().nullable().optional(),
  issueId: z.string().nullable().optional(),
  targetPaymentId: z.string().nullable().optional(),
  amountMinorUnits: z.number().int().positive().nullable().optional(),
  currency: z.string().nullable().optional(),
});
export type RecommendationCandidate = z.infer<typeof RecommendationCandidateSchema>;

// --- POST /investigations response --------------------------------------------

/** `POST /investigations`'s actual HTTP response shape: the unmodified
 * Phase 2 `InvestigationResult` plus, only when one was generated, the
 * Phase 5 recommendation for that specific investigation. This composite
 * lives here (not on `InvestigationResultSchema` itself in agent.ts)
 * because packages/agent has no concept of recommendations at all — the
 * recommendation is generated by apps/api, strictly after
 * `runInvestigation` returns, from packages/actions. See docs/decisions. */
export const InvestigationResponseSchema = InvestigationResultSchema.extend({
  recommendation: RecommendationSchema.nullable(),
});
export type InvestigationResponse = z.infer<typeof InvestigationResponseSchema>;
