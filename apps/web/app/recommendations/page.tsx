"use client";

import { ShieldCheck } from "lucide-react";
import type { Recommendation, RecommendationStatus } from "@paysherlock/types";
import { useApiQuery } from "@/lib/api/useApiQuery";
import { getRecommendations } from "@/lib/api/recommendations";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCompactINR } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";

const STATUS_LABEL: Record<RecommendationStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXECUTING: "Processing",
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

function RecommendationRow({ recommendation }: { recommendation: Recommendation }) {
  const isNoAction = recommendation.type === "NO_ACTION";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 last:border-none">
      <div>
        <p className="text-sm font-medium text-ink">{recommendation.title}</p>
        {!isNoAction && recommendation.amountMinorUnits !== null ? (
          <p className="mt-0.5 text-xs text-ink-muted">
            {formatCompactINR(recommendation.amountMinorUnits)} · Risk {recommendation.riskLevel}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <Badge tone={STATUS_TONE[recommendation.status]}>
          {STATUS_LABEL[recommendation.status]}
        </Badge>
        <span className="whitespace-nowrap text-xs text-ink-faint">
          {formatDateTime(recommendation.createdAt)}
        </span>
      </div>
    </div>
  );
}

export default function RecommendationsPage() {
  const { data, error, loading, reload } = useApiQuery(() => getRecommendations(), []);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Recommendations</h1>
        <p className="mt-1 text-ink-muted">
          Every action PaySherlock has recommended, and what the merchant decided — real, persisted
          history, never fabricated.
        </p>
      </header>

      {error ? (
        <ErrorState
          title="We couldn't load recommendations."
          description={error.message}
          onRetry={reload}
        />
      ) : loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : data && data.data.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title="No recommendations yet."
          description="Run an investigation on a specific payment to see PaySherlock's recommended actions here."
        />
      ) : data ? (
        <div className="overflow-hidden rounded-lg border border-border">
          {data.data.map((recommendation) => (
            <RecommendationRow key={recommendation.id} recommendation={recommendation} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
