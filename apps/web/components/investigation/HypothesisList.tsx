import { Check, HelpCircle } from "lucide-react";
import type { Hypothesis } from "@paysherlock/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";

const STATUS_CONFIG: Record<Hypothesis["status"], { tone: BadgeTone; iconClass: string }> = {
  SUPPORTED: { tone: "emerald", iconClass: "text-emerald" },
  REJECTED: { tone: "neutral", iconClass: "text-ink-faint" },
  INCONCLUSIVE: { tone: "amber", iconClass: "text-amber" },
  PENDING: { tone: "neutral", iconClass: "text-ink-faint" },
};

function describeHypothesis(hypothesis: Hypothesis): string | null {
  if (hypothesis.status === "SUPPORTED") {
    if (hypothesis.confidence !== undefined && hypothesis.confidence >= 0.75)
      return "High evidence strength";
    if (hypothesis.confidence !== undefined && hypothesis.confidence >= 0.6)
      return "Moderate evidence strength";
    return "Some supporting evidence";
  }
  if (hypothesis.status === "REJECTED") return "Evidence remained within normal range";
  if (hypothesis.status === "INCONCLUSIVE") return "Not enough evidence to confirm or rule out";
  return null;
}

export interface HypothesisListProps {
  hypotheses: Hypothesis[];
}

export function HypothesisList({ hypotheses }: HypothesisListProps) {
  if (hypotheses.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-ink">Hypotheses tested</h2>
      <ul className="flex flex-col gap-2">
        {hypotheses.map((hypothesis) => {
          const config = STATUS_CONFIG[hypothesis.status];
          const description = describeHypothesis(hypothesis);
          const Icon = hypothesis.status === "INCONCLUSIVE" ? HelpCircle : Check;

          return (
            <li
              key={hypothesis.id}
              className="flex items-start gap-3 rounded-md border border-border bg-surface p-3.5"
            >
              <Icon
                className={cn("mt-0.5 h-4 w-4 shrink-0", config.iconClass)}
                aria-hidden="true"
              />
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink">{hypothesis.statement}</p>
                  <Badge tone={config.tone}>{hypothesis.status}</Badge>
                </div>
                {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
