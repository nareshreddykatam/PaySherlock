"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useApiQuery } from "@/lib/api/useApiQuery";
import { getOverview } from "@/lib/api/overview";
import { getGreeting } from "@/lib/utils/greeting";
import { formatCompactINR, formatPercent, formatSignedPercent } from "@/lib/formatters/currency";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { IssueCard } from "@/components/issues/IssueCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";

export default function OverviewPage() {
  const { data: overview, error, loading, reload } = useApiQuery(() => getOverview(), []);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{getGreeting()}</h1>
        <p className="mt-1 text-ink-muted">Payment intelligence at a glance.</p>
      </header>

      {error ? (
        <ErrorState
          title="We couldn't load your payment overview."
          description={error.message}
          onRetry={reload}
        />
      ) : loading ? (
        <OverviewSkeleton />
      ) : overview && !overview.hasData ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="Your payment intelligence starts here."
          description="Connect Razorpay Test Mode and run your first investigation to see payment health, issues, and evidence-backed root causes here."
          action={<LinkButton href="/investigate">Start investigation</LinkButton>}
        />
      ) : overview ? (
        <>
          <section
            aria-label="Key metrics"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <MetricCard
              label="Revenue"
              value={formatCompactINR(overview.revenue.currentMinorUnits)}
              change={
                overview.revenue.changePercent !== null
                  ? {
                      value: overview.revenue.changePercent,
                      label: formatSignedPercent(overview.revenue.changePercent),
                      sentiment: "positive",
                    }
                  : undefined
              }
              footnote={overview.revenue.changePercent === null ? "No baseline yet" : undefined}
            />
            <MetricCard
              label="Success Rate"
              value={formatPercent(overview.successRate.current)}
              change={
                overview.successRate.changePercentagePoints !== null
                  ? {
                      value: overview.successRate.changePercentagePoints,
                      label: `${overview.successRate.changePercentagePoints >= 0 ? "+" : ""}${(
                        overview.successRate.changePercentagePoints * 100
                      ).toFixed(1)}pp`,
                      sentiment: "positive",
                    }
                  : undefined
              }
            />
            <MetricCard
              label="Failed Payments"
              value={formatPercent(overview.failureRate.current)}
              change={
                overview.failureRate.changePercentagePoints !== null
                  ? {
                      value: overview.failureRate.changePercentagePoints,
                      label: `${overview.failureRate.changePercentagePoints >= 0 ? "+" : ""}${(
                        overview.failureRate.changePercentagePoints * 100
                      ).toFixed(1)}pp`,
                      sentiment: "negative",
                    }
                  : undefined
              }
            />
            <MetricCard
              label="Revenue At Risk"
              value={
                overview.revenueAtRisk
                  ? formatCompactINR(overview.revenueAtRisk.estimatedImpactMinorUnits)
                  : "—"
              }
              footnote={
                overview.revenueAtRisk
                  ? `${overview.revenueAtRisk.issueCount} issue${overview.revenueAtRisk.issueCount === 1 ? "" : "s"}`
                  : "No significant risk detected"
              }
            />
          </section>

          <section aria-label="Detected issues" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  AI Detected
                </p>
                <h2 className="text-lg font-medium text-ink">
                  {overview.issues.filter((i) => i.severity !== "normal").length} thing
                  {overview.issues.filter((i) => i.severity !== "normal").length === 1
                    ? ""
                    : "s"}{" "}
                  deserve your attention
                </h2>
              </div>
              <Link
                href="/issues"
                className="text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong rounded-sm"
              >
                View all
              </Link>
            </div>
            <div className="flex flex-col gap-3">
              {overview.issues
                .slice()
                .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
                .slice(0, 3)
                .map((issue) => (
                  <IssueCard key={issue.id} issue={issue} compact />
                ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function severityRank(severity: "critical" | "warning" | "normal"): number {
  return severity === "critical" ? 0 : severity === "warning" ? 1 : 2;
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}
