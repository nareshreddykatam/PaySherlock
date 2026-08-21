"use client";

import { ShieldCheck } from "lucide-react";
import { useApiQuery } from "@/lib/api/useApiQuery";
import { getOverview } from "@/lib/api/overview";
import { IssueCard } from "@/components/issues/IssueCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import type { IssueSeverity, OverviewIssue } from "@paysherlock/types";

const SECTIONS: { severity: IssueSeverity; label: string }[] = [
  { severity: "critical", label: "Critical" },
  { severity: "warning", label: "Warning" },
  { severity: "normal", label: "Normal" },
];

export default function IssuesPage() {
  const { data: overview, error, loading, reload } = useApiQuery(() => getOverview(), []);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Issues</h1>
        <p className="mt-1 text-ink-muted">
          Derived from the same deterministic analysis the investigation engine uses — run on the
          current payment data, not from a background monitor.
        </p>
      </header>

      {error ? (
        <ErrorState title="We couldn't load issues." description={error.message} onRetry={reload} />
      ) : loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : overview && !overview.hasData ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title="Nothing to show yet."
          description="Issues appear here once there's payment data to analyze."
        />
      ) : overview ? (
        <div className="flex flex-col gap-6">
          {SECTIONS.map(({ severity, label }) => {
            const items = overview.issues.filter((issue) => issue.severity === severity);
            if (items.length === 0) return null;
            return (
              <section key={severity} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
                  {label}
                </h2>
                <div className="flex flex-col gap-3">
                  {items.map((issue: OverviewIssue) => (
                    <IssueCard key={issue.id} issue={issue} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
