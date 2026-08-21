import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { Payment } from "@/lib/api/payments";

const STATUS_CONFIG: Record<Payment["status"], { label: string; tone: BadgeTone }> = {
  CAPTURED: { label: "Captured", tone: "emerald" },
  FAILED: { label: "Failed", tone: "red" },
  REFUNDED: { label: "Refunded", tone: "amber" },
  AUTHORIZED: { label: "Authorized", tone: "neutral" },
  CREATED: { label: "Created", tone: "neutral" },
};

export function PaymentStatusBadge({ status }: { status: Payment["status"] }) {
  const config = STATUS_CONFIG[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}
