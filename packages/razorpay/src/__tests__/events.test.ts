import { describe, expect, it } from "vitest";
import { isSupportedWebhookEvent, SUPPORTED_WEBHOOK_EVENTS } from "../events.js";

describe("isSupportedWebhookEvent", () => {
  it("accepts every event in the supported list", () => {
    for (const event of SUPPORTED_WEBHOOK_EVENTS) {
      expect(isSupportedWebhookEvent(event)).toBe(true);
    }
  });

  it("rejects an event not in the MVP set", () => {
    expect(isSupportedWebhookEvent("payment.authorized")).toBe(false);
    expect(isSupportedWebhookEvent("subscription.activated")).toBe(false);
  });
});
