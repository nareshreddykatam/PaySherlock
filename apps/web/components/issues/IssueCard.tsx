import Link from "next/link";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { OverviewIssue } from "@paysherlock/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { formatCompactINR } from "@/lib/formatters/currency";
import { cn } from "@/lib/utils/cn";

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircle,
    tone: "red" as BadgeTone,
    label: "Critical",
    iconClass: "text-red",
  },
  warning: {
    icon: AlertTriangle,
    tone: "amber" as BadgeTone,
    label: "Warning",
    iconClass: "text-amber",
  },
  normal: {
    icon: CheckCircle2,
    tone: "emerald" as BadgeTone,
    label: "Normal",
    iconClass: "text-emerald",
  },
} as const;

export interface IssueCardProps {
  issue: OverviewIssue;
  /** Compact mode drops the evidence bullets — used in the Overview's
   * summary strip. */
  compact?: boolean;
  className?: string;
}

export function IssueCard({ issue, compact = false, className }: IssueCardProps) {
  const config = SEVERITY_CONFIG[issue.severity];
  const Icon = config.icon;

  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", config.iconClass)} aria-hidden="true" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-ink">{issue.statement}</p>
              <Badge tone={config.tone}>{config.label}</Badge>
            </div>
            {issue.estimatedImpactMinorUnits !== undefined &&
            issue.estimatedImpactMinorUnits > 0 ? (
              <p className="mt-1 text-sm text-ink-muted">
                Estimated impact{" "}
                <span className="font-medium tabular-nums text-ink">
                  {formatCompactINR(issue.estimatedImpactMinorUnits)}
                </span>
              </p>
            ) : null}
          </div>
        </div>
        <Link
          href={`/investigate?q=${encodeURIComponent(`Investigate: ${issue.statement}`)}`}
          className="shrink-0 whitespace-nowrap text-sm font-medium text-emerald hover:text-emerald-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong rounded-sm"
        >
          Investigate →
        </Link>
      </div>

      {!compact && issue.evidenceSummary.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          {issue.evidenceSummary.map((line, index) => (
            <li key={index} className="text-sm text-ink-muted">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
