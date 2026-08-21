import type { AnomalyType } from "@paysherlock/types";
import { dayBucket } from "../baseline/window.js";

export interface FingerprintParams {
  type: AnomalyType;
  /** e.g. a payment method name for PAYMENT_METHOD_DEGRADATION — omit for
   * merchant-wide detectors. */
  dimension?: string;
  at: Date;
}

/** Deterministic dedup key: anomaly type + dimension + day bucket. Merchant
 * is deliberately NOT part of the string — callers always scope the lookup
 * by merchantId separately (see packages/database's
 * findActiveIssueByFingerprint), matching how every other merchant-scoped
 * query in this codebase works (merchantId as a separate, trusted
 * parameter, never folded into an opaque key). */
export function computeFingerprint(params: FingerprintParams): string {
  return [params.type, params.dimension ?? "_", dayBucket(params.at)].join(":");
}
