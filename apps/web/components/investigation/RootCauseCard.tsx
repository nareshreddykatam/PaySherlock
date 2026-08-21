import type { InvestigationResult } from "@paysherlock/types";
import { Badge } from "@/components/ui/Badge";

const CONFIDENCE_LABEL: Record<NonNullable<InvestigationResult["confidence"]>, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

const CONFIDENCE_TONE: Record<
  NonNullable<InvestigationResult["confidence"]>,
  "emerald" | "amber"
> = {
  high: "emerald",
  medium: "amber",
  low: "amber",
};

export interface RootCauseCardProps {
  result: InvestigationResult;
}

export function RootCauseCard({ result }: RootCauseCardProps) {
  const evidenceCount = result.evidence.length;
  const rejectedCount = result.rejectedHypotheses.length;

  if (!result.rootCause) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Result</p>
        <p className="mt-2 text-lg font-medium text-ink">No significant anomaly detected</p>
        <p className="mt-1 text-sm text-ink-muted">{result.summary}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-strong/25 bg-emerald-soft p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald/80">
        Likely root cause
      </p>
      <p className="mt-2 text-xl font-semibold text-ink">{result.rootCause}</p>
      {result.confidence ? (
        <Badge tone={CONFIDENCE_TONE[result.confidence]} className="mt-3">
          {CONFIDENCE_LABEL[result.confidence]}
        </Badge>
      ) : null}
      <p className="mt-4 text-sm text-ink-muted">
        Based on{" "}
        <span className="font-medium text-ink">
          {evidenceCount} supporting evidence point{evidenceCount === 1 ? "" : "s"}
        </span>{" "}
        and{" "}
        <span className="font-medium text-ink">
          {rejectedCount} rejected hypothes{rejectedCount === 1 ? "is" : "es"}
        </span>
        .
      </p>
    </div>
  );
}
