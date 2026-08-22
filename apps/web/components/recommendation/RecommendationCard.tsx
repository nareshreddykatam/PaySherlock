"use client";

import { useState } from "react";
import type { Recommendation, RecommendationStatus, RiskLevel } from "@paysherlock/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/formatters/currency";
import {
  approveRecommendation,
  rejectRecommendation,
  retryRecommendation,
} from "@/lib/api/recommendations";
import { ConfirmRefundDialog } from "./ConfirmRefundDialog";

const RISK_TONE: Record<RiskLevel, BadgeTone> = { LOW: "neutral", MEDIUM: "amber", HIGH: "red" };

const STATUS_LABEL: Record<RecommendationStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXECUTING: "Processing…",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  EXPIRED: "Expired",
};

const STATUS_TONE: Record<RecommendationStatus, BadgeTone> = {
  PENDING_APPROVAL: "amber",
  APPROVED: "amber",
  REJECTED: "neutral",
  EXECUTING: "amber",
  SUCCEEDED: "emerald",
  FAILED: "red",
  EXPIRED: "neutral",
};

function amountLabel(recommendation: Recommendation): string {
  if (recommendation.amountMinorUnits === null) return "";
  if (recommendation.currency === "INR") return formatINR(recommendation.amountMinorUnits);
  return `${(recommendation.amountMinorUnits / 100).toFixed(2)} ${recommendation.currency}`;
}

export interface RecommendationCardProps {
  recommendation: Recommendation;
  onChange?: (updated: Recommendation) => void;
}

/**
 * Visually distinct from the investigation result above it (Phase 5 brief
 * section 31) — this is PaySherlock *proposing* an action, never the
 * action itself. Every number shown (amount, risk) comes straight from the
 * server-persisted recommendation; nothing is computed here.
 */
export function RecommendationCard({ recommendation, onChange }: RecommendationCardProps) {
  const [current, setCurrent] = useState(recommendation);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(updated: Recommendation) {
    setCurrent(updated);
    onChange?.(updated);
  }

  async function withPending(fn: () => Promise<Recommendation>, fallbackMessage: string) {
    setPending(true);
    setError(null);
    try {
      apply(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackMessage);
    } finally {
      setPending(false);
    }
  }

  async function handleConfirmApprove() {
    await withPending(
      () => approveRecommendation(current.id),
      "The approval could not be completed.",
    );
    setConfirmOpen(false);
  }

  const isRefund = current.type === "REFUND_PAYMENT";

  return (
    <div
      className="rounded-lg border border-emerald-strong/25 bg-emerald-soft/40 p-6"
      aria-label="PaySherlock recommendation"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald/80">
          PaySherlock recommends
        </p>
        <Badge tone={STATUS_TONE[current.status]}>{STATUS_LABEL[current.status]}</Badge>
      </div>

      <h3 className="mt-2 text-lg font-semibold text-ink">{current.title}</h3>
      <p className="mt-1 text-sm text-ink-muted">
        <span className="font-medium text-ink">Reason: </span>
        {current.explanation}
      </p>

      {isRefund ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-ink-muted">
            Risk: <Badge tone={RISK_TONE[current.riskLevel]}>{current.riskLevel}</Badge>
          </span>
          {current.targetPaymentId ? (
            <span className="text-ink-muted">
              Payment:{" "}
              <span className="font-medium tabular-nums text-ink">{current.targetPaymentId}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red">
          {error}
        </p>
      ) : null}

      {current.status === "PENDING_APPROVAL" ? (
        <>
          <p className="mt-4 text-sm text-ink-muted">
            This action will send a refund request to Razorpay.
          </p>
          <div className="mt-3 flex gap-3">
            <Button onClick={() => setConfirmOpen(true)} disabled={pending}>
              Approve &amp; Refund
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                withPending(() => rejectRecommendation(current.id), "Could not reject.")
              }
              disabled={pending}
            >
              Reject
            </Button>
          </div>
        </>
      ) : null}

      {current.status === "FAILED" ? (
        <div className="mt-5">
          <p className="text-sm text-ink-muted">
            No successful refund was recorded. Retrying reuses the same refund attempt — it will
            never create a duplicate.
          </p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => withPending(() => retryRecommendation(current.id), "Retry failed.")}
            disabled={pending}
          >
            {pending ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : null}

      {current.status === "SUCCEEDED" && current.action?.providerReference ? (
        <p className="mt-4 text-sm text-ink-muted">
          {amountLabel(current) ? `${amountLabel(current)} refunded. ` : null}Razorpay refund:{" "}
          <span className="font-medium tabular-nums text-ink">
            {current.action.providerReference}
          </span>
        </p>
      ) : null}

      <ConfirmRefundDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        recommendation={current}
        onConfirm={handleConfirmApprove}
        pending={pending}
      />
    </div>
  );
}
