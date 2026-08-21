import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { recordPaymentEvent } from "../upsert/paymentEvent.js";
import { createMockDb } from "./fixtures.js";

const baseInput = {
  externalEventId: "evt_dedup_test",
  eventType: "payment.captured",
  resourceType: "payment",
  resourceId: "pay_test123",
  occurredAt: new Date("2026-01-01T10:00:00Z"),
  payload: { entity: "event" },
};

describe("recordPaymentEvent", () => {
  it("creates a new event and reports it as not a duplicate", async () => {
    const db = createMockDb();
    db.paymentEvent.create.mockResolvedValue({ id: "pe1", ...baseInput });

    const result = await recordPaymentEvent(db, baseInput);

    expect(result.isDuplicate).toBe(false);
    expect(db.paymentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalEventId: "evt_dedup_test" }),
    });
  });

  it("treats a unique-constraint violation on externalEventId as a duplicate delivery", async () => {
    const db = createMockDb();
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.1.0",
      meta: { target: ["externalEventId"] },
    });
    db.paymentEvent.create.mockRejectedValue(uniqueViolation);
    db.paymentEvent.findUniqueOrThrow.mockResolvedValue({ id: "pe1", ...baseInput });

    const result = await recordPaymentEvent(db, baseInput);

    expect(result.isDuplicate).toBe(true);
    expect(db.paymentEvent.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { externalEventId: "evt_dedup_test" },
    });
  });

  it("rethrows non-duplicate database errors", async () => {
    const db = createMockDb();
    db.paymentEvent.create.mockRejectedValue(new Error("connection reset"));

    await expect(recordPaymentEvent(db, baseInput)).rejects.toThrow("connection reset");
  });
});
