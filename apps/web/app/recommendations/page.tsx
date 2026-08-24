"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import type { Recommendation, RecommendationStatus } from "@paysherlock/types";
import { useApiQuery } from "@/lib/api/useApiQuery";
import { getRecommendations } from "@/lib/api/recommendations";
import { RecommendationCard } from "@/components/recommendation/RecommendationCard";
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

/** Track 03 (AI Revenue Recovery): a computed, on-demand summary over the
 * batch's own already-fetched recommendations — never a separately-stored
 * fact, so it can never drift from what's actually persisted. */
function RecoveryBatchSummary({ recommendations }: { recommendations: Recommendation[] }) {
  const attempted = recommendations.filter(
    (r) => r.status !== "PENDING_APPROVAL" && r.status !== "REJECTED",
  ).length;
  const succeeded = recommendations.filter((r) => r.status === "SUCCEEDED").length;
  const failed = recommendations.filter((r) => r.status === "FAILED").length;
  const amountRecovered = recommendations
    .filter((r) => r.status === "SUCCEEDED")
    .reduce((sum, r) => sum + (r.amountMinorUnits ?? 0), 0);
  const recoveryRate = attempted > 0 ? (succeeded / attempted) * 100 : null;

  return (
    <div className="rounded-lg border border-emerald-strong/25 bg-emerald-soft/40 p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald/80">
        Recovery Batch
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Candidates
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {recommendations.length}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Attempted
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{attempted}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Recovered
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{succeeded}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Failed</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{failed}</dd>
        </div>
      </dl>
      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-emerald-strong/20 pt-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            ₹ recovered
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {formatCompactINR(amountRecovered)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Recovery rate
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {recoveryRate === null ? "—" : `${recoveryRate.toFixed(0)}%`}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export default function RecommendationsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-16" />}>
      <RecommendationsPageContent />
    </Suspense>
  );
}

function RecommendationsPageContent() {
  const issueId = useSearchParams().get("issueId") ?? undefined;
  // Requests the API's maximum page size — the server's default (20) would
  // otherwise push the oldest recommendations (createdAt desc ordering),
  // including the original single-payment demo recommendation, off this
  // page with no pagination control to reach them.
  const { data, error, loading, reload } = useApiQuery(
    () => getRecommendations({ issueId, limit: 100 }),
    [issueId],
  );

  // Local-only overrides so approving/rejecting a card (via the same
  // RecommendationCard used everywhere else) moves it from "Awaiting your
  // decision" into history without a full refetch. Derived at render time,
  // never synced from `data` via an effect — `data` stays the single source
  // of truth, this just shadows individual rows the user has just acted on.
  const [overrides, setOverrides] = useState<Record<string, Recommendation>>({});

  function handleChange(updated: Recommendation) {
    setOverrides((prev) => ({ ...prev, [updated.id]: updated }));
  }

  const items = (data?.data ?? []).map((r) => overrides[r.id] ?? r);
  const pending = items.filter((r) => r.status === "PENDING_APPROVAL");
  const history = items.filter((r) => r.status !== "PENDING_APPROVAL");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Recommendations</h1>
        <p className="mt-1 text-ink-muted">
          {issueId
            ? "The recovery batch generated for this issue — real, persisted history, never fabricated."
            : "Every action PaySherlock has recommended, and what the merchant decided — real, persisted history, never fabricated."}
        </p>
      </header>

      {issueId && items.length > 0 ? <RecoveryBatchSummary recommendations={items} /> : null}

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
      ) : data && items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title="No recommendations yet."
          description="Run an investigation on a specific payment to see PaySherlock's recommended actions here."
        />
      ) : data ? (
        <>
          {pending.length > 0 ? (
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-medium text-ink">
                Awaiting your decision ({pending.length})
              </h2>
              <p className="text-sm text-ink-muted">
                No financial action has been executed for any of these. Each requires its own
                explicit approval — approving one never approves another.
              </p>
              {pending.map((recommendation) => (
                <RecommendationCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  onChange={handleChange}
                />
              ))}
            </section>
          ) : null}

          {history.length > 0 ? (
            <section className="flex flex-col gap-3">
              {pending.length > 0 ? (
                <h2 className="text-lg font-medium text-ink">History ({history.length})</h2>
              ) : null}
              <div className="overflow-hidden rounded-lg border border-border">
                {history.map((recommendation) => (
                  <RecommendationRow key={recommendation.id} recommendation={recommendation} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
