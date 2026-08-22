import {
  approveRecommendation,
  beginRecommendationExecution,
  completeRecommendationFailure,
  completeRecommendationSuccess,
  createAction,
  createRecommendation,
  getActionByRecommendationId,
  getPaymentById,
  getRecommendationById,
  markActionExecuting,
  markActionFailed,
  markActionSucceeded,
  recordAuditEvent,
  rejectRecommendation,
  type Action,
  type Database,
  type Recommendation,
} from "@paysherlock/database";
import {
  buildRefundIdempotencyKey,
  determineRiskLevel,
  executeRefund,
  generateNoActionCandidate,
  generateRefundRecommendationCandidate,
  validateRecommendationCandidate,
} from "@paysherlock/actions";
import type { RazorpayClient } from "@paysherlock/razorpay";
import { AgentError, NotFoundError, type InvestigationResult } from "@paysherlock/types";

const REFUND_RECOMMENDATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface RecommendationServiceDeps {
  db: Database;
  razorpayClient: RazorpayClient;
}

// --- Response DTO -------------------------------------------------------------

export function toActionResponse(action: Action) {
  return {
    id: action.id,
    merchantId: action.merchantId,
    recommendationId: action.recommendationId,
    type: action.type,
    status: action.status,
    paymentId: action.paymentId,
    amountMinorUnits: action.amountMinorUnits,
    currency: action.currency,
    idempotencyKey: action.idempotencyKey,
    providerReference: action.providerReference,
    providerStatus: action.providerStatus,
    errorCode: action.errorCode,
    errorMessage: action.errorMessage,
    createdAt: action.createdAt.toISOString(),
    approvedAt: action.approvedAt?.toISOString() ?? null,
    startedAt: action.startedAt?.toISOString() ?? null,
    completedAt: action.completedAt?.toISOString() ?? null,
    updatedAt: action.updatedAt.toISOString(),
  };
}

export function toRecommendationResponse(
  recommendation: Recommendation,
  action: Action | null = null,
) {
  return {
    id: recommendation.id,
    merchantId: recommendation.merchantId,
    issueId: recommendation.issueId,
    investigationId: recommendation.investigationId,
    type: recommendation.type,
    title: recommendation.title,
    explanation: recommendation.explanation,
    riskLevel: recommendation.riskLevel,
    status: recommendation.status,
    targetPaymentId: recommendation.targetPaymentId,
    amountMinorUnits: recommendation.amountMinorUnits,
    currency: recommendation.currency,
    action: action ? toActionResponse(action) : null,
    createdAt: recommendation.createdAt.toISOString(),
    approvedAt: recommendation.approvedAt?.toISOString() ?? null,
    rejectedAt: recommendation.rejectedAt?.toISOString() ?? null,
    expiresAt: recommendation.expiresAt?.toISOString() ?? null,
    updatedAt: recommendation.updatedAt.toISOString(),
  };
}

// --- Generation (Phase 5 brief section 9) -------------------------------------

export interface GenerateRecommendationParams {
  merchantId: string;
  investigation: Pick<InvestigationResult, "rootCause" | "summary" | "meta">;
  /** Our internal Payment.id — only present when the merchant investigated
   * a specific payment (see InvestigationRequest.targetPaymentId). */
  targetPaymentId?: string | undefined;
}

/**
 * Always produces exactly one persisted Recommendation for a completed
 * investigation: REFUND_PAYMENT (PENDING_APPROVAL) when the investigation
 * found a root cause for a specific, still-refundable payment, or
 * NO_ACTION (already SUCCEEDED — nothing to approve) otherwise. The
 * candidate is still run through the full validation pipeline even though
 * it was code-generated here, not model-generated — see docs/decisions on
 * why "AI output is untrusted input" applies to this bridge too.
 */
export async function generateRecommendationForInvestigation(
  deps: Pick<RecommendationServiceDeps, "db">,
  params: GenerateRecommendationParams,
): Promise<ReturnType<typeof toRecommendationResponse>> {
  let candidate = null;

  if (params.targetPaymentId) {
    const payment = await getPaymentById(deps.db, params.targetPaymentId);
    if (payment && payment.merchantId === params.merchantId) {
      candidate = generateRefundRecommendationCandidate(params.investigation, { payment });
    }
  }

  candidate ??= generateNoActionCandidate(params.investigation);

  let targetPayment = null;
  if (candidate.targetPaymentId) {
    const payment = await getPaymentById(deps.db, candidate.targetPaymentId);
    targetPayment = payment ? { ...payment } : null;
  }

  const validation = validateRecommendationCandidate(candidate, {
    merchantId: params.merchantId,
    targetPayment,
  });

  // Defense in depth: if a REFUND_PAYMENT candidate somehow fails
  // re-validation here (it was already checked when generated), fall back
  // to NO_ACTION rather than ever persisting an unvalidated recommendation.
  const finalCandidate = validation.valid
    ? candidate
    : generateNoActionCandidate(params.investigation);
  const finalAmount = validation.valid ? validation.amountMinorUnits : null;
  const finalCurrency = validation.valid ? validation.currency : null;

  const riskLevel = determineRiskLevel({
    type: finalCandidate.type,
    amountMinorUnits: finalAmount,
  });
  const isRefund = finalCandidate.type === "REFUND_PAYMENT";

  const recommendation = await createRecommendation(deps.db, {
    merchantId: params.merchantId,
    issueId: finalCandidate.issueId ?? null,
    investigationId: finalCandidate.investigationId ?? null,
    type: finalCandidate.type,
    title: finalCandidate.title,
    explanation: finalCandidate.explanation,
    riskLevel,
    targetPaymentId: isRefund ? finalCandidate.targetPaymentId : null,
    amountMinorUnits: finalAmount,
    currency: finalCurrency,
    expiresAt: isRefund ? new Date(Date.now() + REFUND_RECOMMENDATION_TTL_MS) : null,
    initialStatus: isRefund ? "PENDING_APPROVAL" : "SUCCEEDED",
  });

  await recordAuditEvent(deps.db, {
    merchantId: params.merchantId,
    eventType: "RECOMMENDATION_CREATED",
    recommendationId: recommendation.id,
    metadata: { type: recommendation.type, riskLevel: recommendation.riskLevel },
  });

  return toRecommendationResponse(recommendation);
}

// --- Approval / rejection / retry --------------------------------------------

export type RecommendationActionOutcome =
  | { kind: "ok"; recommendation: ReturnType<typeof toRecommendationResponse> }
  | { kind: "not_found" }
  | { kind: "conflict"; recommendation: ReturnType<typeof toRecommendationResponse> }
  | { kind: "expired"; recommendation: ReturnType<typeof toRecommendationResponse> };

export interface RecommendationScopeParams {
  id: string;
  merchantId: string;
}

/**
 * The one and only path from PENDING_APPROVAL to a Razorpay call. Approval
 * and execution happen in the same request — there is no separate
 * "execute" endpoint a client could call independently, so there is no
 * code path that reaches Razorpay without a persisted APPROVED transition
 * immediately preceding it. See docs/decisions for the full trace.
 */
export async function approveRecommendationAndExecute(
  deps: RecommendationServiceDeps,
  params: RecommendationScopeParams,
): Promise<RecommendationActionOutcome> {
  const approval = await approveRecommendation(deps.db, params);
  if (approval.outcome === "not_found") return { kind: "not_found" };
  if (approval.outcome === "expired") {
    return { kind: "expired", recommendation: toRecommendationResponse(approval.recommendation) };
  }
  if (approval.outcome === "conflict") {
    const action = await getActionByRecommendationId(deps.db, params.id);
    return {
      kind: "conflict",
      recommendation: toRecommendationResponse(approval.recommendation, action),
    };
  }

  const recommendation = approval.recommendation;
  await recordAuditEvent(deps.db, {
    merchantId: params.merchantId,
    eventType: "RECOMMENDATION_APPROVED",
    recommendationId: recommendation.id,
  });

  // NO_ACTION recommendations are created SUCCEEDED and never reach
  // PENDING_APPROVAL, so a successful approval here always means a real
  // financial action (REFUND_PAYMENT today).
  const idempotencyKey = buildRefundIdempotencyKey(recommendation.id);
  const action = await createAction(deps.db, {
    merchantId: params.merchantId,
    recommendationId: recommendation.id,
    type: recommendation.type,
    paymentId: recommendation.targetPaymentId,
    amountMinorUnits: recommendation.amountMinorUnits,
    currency: recommendation.currency,
    idempotencyKey,
    approvedAt: recommendation.approvedAt ?? new Date(),
  });

  const finalRecommendation = await runExecution(deps, { recommendation, action });
  return { kind: "ok", recommendation: finalRecommendation };
}

export async function rejectRecommendationById(
  deps: Pick<RecommendationServiceDeps, "db">,
  params: RecommendationScopeParams,
): Promise<RecommendationActionOutcome> {
  const result = await rejectRecommendation(deps.db, params);
  if (result.outcome === "not_found") return { kind: "not_found" };
  if (result.outcome === "conflict") {
    return { kind: "conflict", recommendation: toRecommendationResponse(result.recommendation) };
  }

  await recordAuditEvent(deps.db, {
    merchantId: params.merchantId,
    eventType: "RECOMMENDATION_REJECTED",
    recommendationId: result.recommendation.id,
  });
  // No Razorpay action occurs — rejection is a pure state transition.
  return { kind: "ok", recommendation: toRecommendationResponse(result.recommendation) };
}

/** A controlled retry of a FAILED recommendation — reuses the existing
 * Action row and its idempotency key (never a fresh one). Only valid from
 * FAILED; every other status is rejected by `beginRecommendationExecution`. */
export async function retryRecommendationExecution(
  deps: RecommendationServiceDeps,
  params: RecommendationScopeParams,
): Promise<RecommendationActionOutcome> {
  const begin = await beginRecommendationExecution(deps.db, { ...params, from: "FAILED" });
  if (begin.outcome === "not_found") return { kind: "not_found" };
  if (begin.outcome === "conflict" || begin.outcome === "expired") {
    const action = await getActionByRecommendationId(deps.db, params.id);
    return {
      kind: "conflict",
      recommendation: toRecommendationResponse(begin.recommendation, action),
    };
  }

  const recommendation = begin.recommendation;
  const action = await getActionByRecommendationId(deps.db, recommendation.id);
  if (!action) {
    throw new AgentError(`Recommendation "${recommendation.id}" has no Action row to retry`);
  }

  const finalRecommendation = await runExecution(deps, { recommendation, action, isRetry: true });
  return { kind: "ok", recommendation: finalRecommendation };
}

/** Shared APPROVED|FAILED -> EXECUTING -> SUCCEEDED|FAILED sequence used by
 * both the first approval and a retry. Never called with a recommendation
 * that isn't already in EXECUTING (the caller's `beginRecommendationExecution`
 * / `approveRecommendation` call is what got it there). */
async function runExecution(
  deps: RecommendationServiceDeps,
  params: { recommendation: Recommendation; action: Action; isRetry?: boolean },
): Promise<ReturnType<typeof toRecommendationResponse>> {
  const { recommendation, action } = params;

  if (!params.isRetry) {
    // The retry path already transitioned the recommendation itself via
    // beginRecommendationExecution; the first-approval path still needs to.
    await beginRecommendationExecution(deps.db, {
      id: recommendation.id,
      merchantId: recommendation.merchantId,
      from: "APPROVED",
    });
  }
  await markActionExecuting(deps.db, action.id);
  await recordAuditEvent(deps.db, {
    merchantId: recommendation.merchantId,
    eventType: "ACTION_STARTED",
    recommendationId: recommendation.id,
    actionId: action.id,
    metadata: { retry: Boolean(params.isRetry) },
  });

  if (recommendation.targetPaymentId === null) {
    throw new AgentError(`Recommendation "${recommendation.id}" has no target payment to refund`);
  }
  const payment = await getPaymentById(deps.db, recommendation.targetPaymentId);
  if (!payment) {
    throw new NotFoundError(`Payment "${recommendation.targetPaymentId}" was not found`);
  }
  if (recommendation.amountMinorUnits === null || recommendation.currency === null) {
    throw new AgentError(`Recommendation "${recommendation.id}" is missing amount/currency`);
  }

  const result = await executeRefund({
    razorpayClient: deps.razorpayClient,
    razorpayPaymentId: payment.razorpayPaymentId,
    amountMinorUnits: recommendation.amountMinorUnits,
    currency: recommendation.currency,
    reason: recommendation.explanation,
    idempotencyKey: action.idempotencyKey,
  });

  if (result.success) {
    const updatedAction = await markActionSucceeded(deps.db, {
      id: action.id,
      providerReference: result.providerReference,
      providerStatus: result.providerStatus,
    });
    const updatedRecommendation = await completeRecommendationSuccess(deps.db, recommendation.id);
    await recordAuditEvent(deps.db, {
      merchantId: recommendation.merchantId,
      eventType: "ACTION_SUCCEEDED",
      recommendationId: recommendation.id,
      actionId: action.id,
      metadata: { providerReference: result.providerReference },
    });
    return toRecommendationResponse(updatedRecommendation, updatedAction);
  }

  const updatedAction = await markActionFailed(deps.db, {
    id: action.id,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    providerStatus: null,
  });
  const updatedRecommendation = await completeRecommendationFailure(deps.db, recommendation.id);
  await recordAuditEvent(deps.db, {
    merchantId: recommendation.merchantId,
    eventType: "ACTION_FAILED",
    recommendationId: recommendation.id,
    actionId: action.id,
    metadata: { errorCode: result.errorCode },
  });
  return toRecommendationResponse(updatedRecommendation, updatedAction);
}

// --- Read paths ----------------------------------------------------------------

export async function getRecommendationResponseById(
  deps: Pick<RecommendationServiceDeps, "db">,
  params: RecommendationScopeParams,
): Promise<ReturnType<typeof toRecommendationResponse> | null> {
  const record = await getRecommendationById(deps.db, params);
  if (!record) return null;
  return toRecommendationResponse(record, record.action);
}
