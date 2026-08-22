import type { RecommendationType } from "@paysherlock/types";

/** The only recommendation type that ever becomes a real Action — kept as
 * an explicit set (not "everything except NO_ACTION") so adding a future
 * action type requires a deliberate, visible change here, matching the
 * brief's "keep the initial action catalog SMALL" instruction. */
export const EXECUTABLE_ACTION_TYPES: ReadonlySet<RecommendationType> = new Set(["REFUND_PAYMENT"]);

export function isExecutableActionType(type: RecommendationType): boolean {
  return EXECUTABLE_ACTION_TYPES.has(type);
}

/** Deterministic, stable idempotency key derived from the *recommendation's*
 * own id — never a fresh random value per attempt, and never the Action's
 * id (which would require creating the Action before knowing its own key).
 * Since an Action is 1:1 with its Recommendation, the recommendation's id
 * is just as stable an identity for "this logical refund", and using it
 * lets the key be computed *before* the Action row is created. Reused
 * as-is for a retry — see docs/decisions. */
export function buildRefundIdempotencyKey(recommendationId: string): string {
  return `paysherlock-refund-${recommendationId}`;
}
