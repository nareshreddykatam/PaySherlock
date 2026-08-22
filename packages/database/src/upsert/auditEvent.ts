import type { Database, AuditEvent, AuditEventType } from "../client.js";
import { toNullableJsonInput } from "../json.js";

export interface RecordAuditEventParams {
  merchantId: string;
  eventType: AuditEventType;
  recommendationId?: string | null;
  actionId?: string | null;
  /** Small, safe, structured metadata only (e.g. `{"riskLevel":"MEDIUM"}`)
   * — never secrets, credentials, authorization headers, or raw provider
   * request/response bodies. Callers are responsible for keeping this
   * safe; see docs/decisions. */
  metadata?: Record<string, unknown> | null;
}

/** Audit rows are append-only — this package deliberately exposes no
 * update/delete function for AuditEvent. A changed situation always means
 * recording a *new* event, never editing an old one. */
export async function recordAuditEvent(
  db: Database,
  params: RecordAuditEventParams,
): Promise<AuditEvent> {
  return db.auditEvent.create({
    data: {
      merchantId: params.merchantId,
      eventType: params.eventType,
      recommendationId: params.recommendationId ?? null,
      actionId: params.actionId ?? null,
      metadata: toNullableJsonInput(params.metadata),
    },
  });
}
