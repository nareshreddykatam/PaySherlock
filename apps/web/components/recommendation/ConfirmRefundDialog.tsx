"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { Recommendation } from "@paysherlock/types";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/formatters/currency";
import { cn } from "@/lib/utils/cn";

export interface ConfirmRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recommendation: Recommendation;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * The explicit approval-confirmation step (Phase 5 brief section 32) — a
 * second, deliberate click naming the exact action, never an ambiguous
 * "Continue"/"OK". Nothing here is editable: the amount and payment are
 * exactly what the server-side recommendation already specifies.
 */
export function ConfirmRefundDialog({
  open,
  onOpenChange,
  recommendation,
  onConfirm,
  pending,
}: ConfirmRefundDialogProps) {
  const amountLabel =
    recommendation.amountMinorUnits !== null && recommendation.currency === "INR"
      ? formatINR(recommendation.amountMinorUnits)
      : recommendation.amountMinorUnits !== null
        ? `${(recommendation.amountMinorUnits / 100).toFixed(2)} ${recommendation.currency}`
        : "—";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-border bg-surface p-6 shadow-2xl outline-none",
          )}
        >
          <Dialog.Title className="text-lg font-semibold text-ink">Confirm refund</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-ink-muted">
            You are about to refund:
          </Dialog.Description>

          <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">{amountLabel}</p>
          {recommendation.targetPaymentId ? (
            <p className="mt-1 text-sm text-ink-muted">
              Payment:{" "}
              <span className="tabular-nums text-ink">{recommendation.targetPaymentId}</span>
            </p>
          ) : null}

          <p className="mt-4 rounded-md bg-surface-2 p-3 text-sm text-ink-muted">
            This will send a refund request to Razorpay. This action cannot be automatically undone.
          </p>

          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={pending}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button variant="danger" onClick={onConfirm} disabled={pending}>
              {pending ? "Refunding…" : "Confirm Refund"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
