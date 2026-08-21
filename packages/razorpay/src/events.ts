// The MVP webhook event surface. Smallest set that covers payment
// success/failure, order completion, and both refund outcomes — enough for
// the future agent to investigate revenue and failure questions. See
// docs/decisions for the full rationale and what's deliberately excluded
// (e.g. subscriptions, disputes, settlements).
export const SUPPORTED_WEBHOOK_EVENTS = [
  "payment.captured",
  "payment.failed",
  "order.paid",
  "refund.processed",
  "refund.failed",
] as const;

export type SupportedWebhookEvent = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

export function isSupportedWebhookEvent(event: string): event is SupportedWebhookEvent {
  return (SUPPORTED_WEBHOOK_EVENTS as readonly string[]).includes(event);
}
