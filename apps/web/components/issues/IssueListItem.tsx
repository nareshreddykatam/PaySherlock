import Link from "next/link";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { Issue } from "@paysherlock/types";
import { Badge } from "@/components/ui/Badge";
import { formatCompactINR } from "@/lib/formatters/currency";
import { formatRelativeToNow } from "@/lib/formatters/date";
import {
  ANOMALY_TYPE_LABELS,
  SEVERITY_TONE,
  STATUS_LABELS,
  STATUS_TONE,
} from "@/lib/formatters/issue";
import { cn } from "@/lib/utils/cn";

const SEVERITY_ICON = { CRITICAL: AlertCircle, WARNING: AlertTriangle, INFO: Info } as const;

export interface IssueListItemProps {
  issue: Issue;
  className?: string;
}

/** One row on the real, persisted Issues list — distinct from the
 * ephemeral hypothesis-derived `IssueCard` the Overview page uses. See
 * docs/decisions for why these are two different components/data sources. */
export function IssueListItem({ issue, className }: IssueListItemProps) {
  const Icon = SEVERITY_ICON[issue.severity];
  const iconClass =
    issue.severity === "CRITICAL"
      ? "text-red"
      : issue.severity === "WARNING"
        ? "text-amber"
        : "text-ink-faint";

  return (
    <Link
      href={`/issues/${issue.id}`}
      className={cn(
        "block rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconClass)} aria-hidden="true" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-ink">{issue.title}</p>
              <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
              <Badge tone={STATUS_TONE[issue.status]}>{STATUS_LABELS[issue.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {ANOMALY_TYPE_LABELS[issue.type]}
              {issue.dimension ? ` · ${issue.dimension}` : ""} · Detected{" "}
              {formatRelativeToNow(issue.detectedAt)}
            </p>
            {issue.rootCause ? (
              <p className="mt-2 text-sm text-ink">
                Likely cause: <span className="font-medium">{issue.rootCause}</span>
              </p>
            ) : null}
          </div>
        </div>
        {issue.estimatedImpactMinorUnits !== null && issue.estimatedImpactMinorUnits > 0 ? (
          <span className="shrink-0 whitespace-nowrap text-sm font-medium tabular-nums text-ink">
            {formatCompactINR(issue.estimatedImpactMinorUnits)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
