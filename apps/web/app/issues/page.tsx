"use client";

import { ShieldCheck } from "lucide-react";
import { useApiQuery } from "@/lib/api/useApiQuery";
import { getIssues } from "@/lib/api/issues";
import { IssueListItem } from "@/components/issues/IssueListItem";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";

export default function IssuesPage() {
  const { data, error, loading, reload } = useApiQuery(() => getIssues({ limit: 50 }), []);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Issues</h1>
        <p className="mt-1 text-ink-muted">
          Anomalies the detection engine found and persisted, each investigated automatically by the
          same engine behind Investigate — not a live re-analysis of the current moment.
        </p>
      </header>

      {error ? (
        <ErrorState title="We couldn't load issues." description={error.message} onRetry={reload} />
      ) : loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : data && data.data.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title="No issues detected yet."
          description="PaySherlock's detection engine watches payment data for unusual patterns. Issues appear here as soon as it finds one."
        />
      ) : data ? (
        <div className="flex flex-col gap-3">
          {data.data.map((issue) => (
            <IssueListItem key={issue.id} issue={issue} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
