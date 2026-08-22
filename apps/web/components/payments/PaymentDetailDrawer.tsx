import Link from "next/link";
import type { ReactNode } from "react";
import type { Payment } from "@/lib/api/payments";
import { Drawer } from "@/components/ui/Drawer";
import { PaymentStatusBadge } from "./StatusBadge";
import { formatINR } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import { formatPaymentMethod } from "@/lib/formatters/payment";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-none">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-medium tabular-nums text-ink text-right">{value}</span>
    </div>
  );
}

export interface PaymentDetailDrawerProps {
  payment: Payment | null;
  onClose: () => void;
}

export function PaymentDetailDrawer({ payment, onClose }: PaymentDetailDrawerProps) {
  return (
    <Drawer
      open={payment !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Payment details"
      description={payment?.razorpayPaymentId}
    >
      {payment ? (
        <div className="flex flex-col">
          <DetailRow label="Amount" value={formatINR(payment.amount)} />
          <DetailRow label="Status" value={<PaymentStatusBadge status={payment.status} />} />
          <DetailRow label="Method" value={formatPaymentMethod(payment.method)} />
          <DetailRow label="Created" value={formatDateTime(payment.createdAt)} />
          <DetailRow label="Order" value={payment.orderId ?? "—"} />
          {payment.amountRefunded > 0 ? (
            <DetailRow label="Refunded" value={formatINR(payment.amountRefunded)} />
          ) : null}
          {payment.errorCode ? <DetailRow label="Error code" value={payment.errorCode} /> : null}
          {payment.errorDescription ? (
            <DetailRow label="Failure reason" value={payment.errorDescription} />
          ) : null}

          <div className="mt-6">
            <Link
              href={`/investigate?q=${encodeURIComponent(
                `Investigate payment ${payment.razorpayPaymentId}`,
              )}&paymentId=${encodeURIComponent(payment.id)}`}
              className="text-sm font-medium text-emerald hover:text-emerald-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong rounded-sm"
            >
              Investigate this payment →
            </Link>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
