import { useState } from "react";
import type { InvestigationResult, Recommendation } from "@paysherlock/types";
import { RootCauseCard } from "./RootCauseCard";
import { BusinessImpactCard } from "./BusinessImpactCard";
import { EvidenceList } from "./EvidenceList";
import { HypothesisList } from "./HypothesisList";
import { QuestionForm } from "./QuestionForm";
import { RecommendationCard } from "@/components/recommendation/RecommendationCard";

export interface ResultViewProps {
  result: InvestigationResult;
  /** Present whenever the API returned one alongside the investigation
   * (Phase 5) — absent for read-only views that only ever show a past
   * InvestigationResult without its own recommendation lifecycle (e.g. the
   * History drawer). Never fabricated on the frontend. */
  recommendation?: Recommendation | null;
  onFollowUp: (question: string) => void;
  followUpDisabled?: boolean;
}

export function ResultView({
  result,
  recommendation,
  onFollowUp,
  followUpDisabled,
}: ResultViewProps) {
  const [currentRecommendation, setCurrentRecommendation] = useState(recommendation ?? null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Investigation complete
        </p>
        <h2 className="mt-1 text-lg font-medium text-ink">{result.question}</h2>
        <p className="mt-2 text-sm text-ink-muted">{result.summary}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RootCauseCard result={result} />
        {result.businessImpact ? <BusinessImpactCard impact={result.businessImpact} /> : null}
      </div>

      {currentRecommendation && currentRecommendation.type === "REFUND_PAYMENT" ? (
        <RecommendationCard
          recommendation={currentRecommendation}
          onChange={setCurrentRecommendation}
        />
      ) : null}

      <EvidenceList evidence={result.evidence} />
      <HypothesisList hypotheses={result.hypotheses} />

      {result.recommendations.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-ink">Recommendations</h2>
          <ul className="flex flex-col gap-2">
            {result.recommendations.map((recommendation, index) => (
              <li
                key={index}
                className="rounded-md border border-border bg-surface p-3.5 text-sm text-ink"
              >
                {recommendation}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <QuestionForm label="Ask a follow-up" onSubmit={onFollowUp} disabled={followUpDisabled} />
      </section>
    </div>
  );
}
