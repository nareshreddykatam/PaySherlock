import { describe, expect, it } from "vitest";
import { recordAuditEvent } from "../upsert/auditEvent.js";
import { createMockDb } from "./fixtures.js";

describe("recordAuditEvent", () => {
  it("creates a new row for every event — never updates an existing one", async () => {
    const db = createMockDb();
    db.auditEvent.create.mockResolvedValue({ id: "audit-1" });

    await recordAuditEvent(db, {
      merchantId: "merchant-1",
      eventType: "RECOMMENDATION_APPROVED",
      recommendationId: "rec-1",
      metadata: { riskLevel: "MEDIUM" },
    });

    expect(db.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(db.auditEvent.update).toBeUndefined();
    const call = db.auditEvent.create.mock.calls[0][0].data;
    expect(call.eventType).toBe("RECOMMENDATION_APPROVED");
    expect(call.metadata).toEqual({ riskLevel: "MEDIUM" });
  });

  it("never includes anything resembling a secret in metadata passed through", async () => {
    const db = createMockDb();
    db.auditEvent.create.mockResolvedValue({ id: "audit-1" });

    const safeMetadata = { errorCode: "PROVIDER_HTTP_400" };
    await recordAuditEvent(db, {
      merchantId: "merchant-1",
      eventType: "ACTION_FAILED",
      actionId: "action-1",
      metadata: safeMetadata,
    });

    const call = db.auditEvent.create.mock.calls[0][0].data;
    expect(JSON.stringify(call.metadata)).not.toMatch(/authorization|api[_-]?key|secret/i);
  });
});
