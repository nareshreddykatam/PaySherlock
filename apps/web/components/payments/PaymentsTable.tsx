"use client";

import { useState } from "react";
import type { Payment } from "@/lib/api/payments";
import { PaymentStatusBadge } from "./StatusBadge";
import { PaymentDetailDrawer } from "./PaymentDetailDrawer";
import { formatINR } from "@/lib/formatters/currency";
import { formatPaymentTimestamp } from "@/lib/formatters/date";
import { formatPaymentMethod } from "@/lib/formatters/payment";

export interface PaymentsTableProps {
  payments: Payment[];
}

export function PaymentsTable({ payments }: PaymentsTableProps) {
  const [selected, setSelected] = useState<Payment | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
            <th scope="col" className="px-4 py-3">
              Status
            </th>
            <th scope="col" className="px-4 py-3">
              Method
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Amount
            </th>
            <th scope="col" className="px-4 py-3">
              Timestamp
            </th>
            <th scope="col" className="px-4 py-3">
              Payment ID
            </th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr
              key={payment.id}
              tabIndex={0}
              role="button"
              aria-label={`View details for payment ${payment.razorpayPaymentId}`}
              onClick={() => setSelected(payment)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(payment);
                }
              }}
              className="cursor-pointer border-b border-border bg-surface transition-colors last:border-none hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-strong"
            >
              <td className="px-4 py-3">
                <PaymentStatusBadge status={payment.status} />
              </td>
              <td className="px-4 py-3 text-ink-muted">{formatPaymentMethod(payment.method)}</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                {formatINR(payment.amount)}
              </td>
              <td className="px-4 py-3 tabular-nums text-ink-muted">
                {formatPaymentTimestamp(payment.createdAt)}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-ink-faint">
                {payment.razorpayPaymentId}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <PaymentDetailDrawer payment={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
