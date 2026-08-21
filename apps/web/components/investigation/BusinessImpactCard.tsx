import type { BusinessImpact } from "@paysherlock/types";
import { formatINR } from "@/lib/formatters/currency";

export interface BusinessImpactCardProps {
  impact: BusinessImpact;
}

const BASIS_DESCRIPTIONS: Record<string, string> = {
  revenue_delta_vs_scaled_baseline:
    "Based on successful-payment revenue compared with the selected baseline period.",
};

export function BusinessImpactCard({ impact }: BusinessImpactCardProps) {
  const isLoss = impact.estimatedImpactMinorUnits > 0;
  const description =
    BASIS_DESCRIPTIONS[impact.basis] ??
    "Based on payment performance compared with the selected baseline.";

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Estimated business impact
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
        {formatINR(Math.abs(impact.estimatedImpactMinorUnits))}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {isLoss ? "Potential revenue affected" : "Revenue above baseline"}
      </p>
      <p className="mt-3 text-sm text-ink-muted">{description}</p>
    </div>
  );
}
