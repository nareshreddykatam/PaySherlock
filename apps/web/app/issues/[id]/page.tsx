"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useApiQuery } from "@/lib/api/useApiQuery";
import { getIssue } from "@/lib/api/issues";
import { ResultView } from "@/components/investigation/ResultView";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCompactINR } from "@/lib/formatters/currency";
import { formatDateTime, formatRelativeToNow } from "@/lib/formatters/date";
import { humanizeMetric } from "@/components/investigation/humanizeMetric";
import {
  ANOMALY_TYPE_LABELS,
  SEVERITY_TONE,
  STATUS_LABELS,
  STATUS_TONE,
} from "@/lib/formatters/issue";

function isRateMetric(metric: string): boolean {
  return metric.includes("rate");
}

function formatMetricValue(metric: string, value: number): string {
  if (isRateMetric(metric)) return `${(value * 100).toFixed(1)}%`;
  return value.toLocaleString("en-IN");
}

function formatChange(issue: {
  relativeChange: number | null;
  absoluteChange: number;
  metric: string;
}): string {
  if (issue.relativeChange !== null) {
    const pct = (issue.relativeChange * 100).toFixed(1);
    return `${issue.relativeChange >= 0 ? "+" : ""}${pct}%`;
  }
  const pp = (issue.absoluteChange * 100).toFixed(1);
  return `${issue.absoluteChange >= 0 ? "+" : ""}${pp}pp`;
}

export default function IssueDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const {
    data: issue,
    error,
    loading,
    reload,
  } = useApiQuery(() => getIssue(params.id), [params.id]);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/issues"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong rounded-sm"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Issues
      </Link>

      {error ? (
        <ErrorState
          title="We couldn't load this issue."
          description={error.message}
          onRetry={reload}
        />
      ) : loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : issue ? (
        <div className="flex flex-col gap-6">
          <header className="rounded-lg border border-border bg-surface p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-ink">{issue.title}</h1>
              <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
              <Badge tone={STATUS_TONE[issue.status]}>{STATUS_LABELS[issue.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {ANOMALY_TYPE_LABELS[issue.type]}
              {issue.dimension ? ` · ${issue.dimension}` : ""} · Detected{" "}
              {formatRelativeToNow(issue.detectedAt)} ({formatDateTime(issue.detectedAt)})
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  {humanizeMetric(issue.metric)}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {formatMetricValue(issue.metric, issue.currentValue)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Baseline
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {formatMetricValue(issue.metric, issue.baselineValue)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Change
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {formatChange(issue)}
                </dd>
              </div>
              {issue.estimatedImpactMinorUnits !== null && issue.estimatedImpactMinorUnits > 0 ? (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    Estimated impact
                  </dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                    {formatCompactINR(issue.estimatedImpactMinorUnits)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </header>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium text-ink">AI Investigation</h2>

            {issue.investigation ? (
              <ResultView
                result={issue.investigation}
                onFollowUp={(question) =>
                  router.push(`/investigate?q=${encodeURIComponent(question)}`)
                }
              />
            ) : issue.status === "INVESTIGATION_FAILED" ? (
              <ErrorState
                title="We couldn't complete the investigation."
                description="The automatic investigation failed. A later detection run may retry it."
                detail={issue.investigationError ?? undefined}
              />
            ) : issue.status === "INVESTIGATING" ? (
              <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
                Investigation in progress…
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
                This anomaly hasn&apos;t been investigated yet.
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
