import type { Database } from "@paysherlock/database";
import { runDeterministicSnapshot, selectRootCause } from "@paysherlock/agent";
import { comparePeriodsTool, type ToolContext } from "@paysherlock/tools";
import type {
  HypothesisStatusType,
  IssueSeverity,
  OverviewIssue,
  OverviewResponse,
} from "@paysherlock/types";

function severityFor(status: HypothesisStatusType): IssueSeverity {
  if (status === "SUPPORTED") return "critical";
  if (status === "INCONCLUSIVE") return "warning";
  return "normal";
}

/**
 * Builds the GET /overview response. Reuses the exact same deterministic
 * tool + hypothesis pipeline as an investigation (runDeterministicSnapshot)
 * plus one extra `compare_periods` call for the revenue metric specifically
 * (the default step sequence only compares successful-payment *count*, not
 * revenue). No LLM call, no new business logic — just assembly. See
 * docs/decisions for why this endpoint exists and what it deliberately
 * isn't (autonomous monitoring).
 */
export async function getOverview(db: Database, merchantId: string): Promise<OverviewResponse> {
  const snapshot = await runDeterministicSnapshot({ merchantId, db });
  const ctx: ToolContext = { merchantId, db };

  const revenueComparison = await comparePeriodsTool.handler(
    { metric: "revenue", ...snapshot.timeRange },
    ctx,
  );

  const totalAttempts =
    snapshot.findings.failures?.totalAttempts ??
    snapshot.findings.paymentsOverview?.totalCount ??
    0;
  const hasData = totalAttempts > 0;
  const rootCause = selectRootCause(snapshot.hypotheses);

  const issues: OverviewIssue[] = snapshot.hypotheses.map((hypothesis) => {
    const relatedEvidence = snapshot.evidence.filter((item) =>
      hypothesis.evidenceIds.includes(item.id),
    );
    const issue: OverviewIssue = {
      id: hypothesis.id,
      statement: hypothesis.statement,
      status: hypothesis.status,
      severity: severityFor(hypothesis.status),
      evidenceSummary: relatedEvidence.map(
        (item) => item.comparison ?? `${item.metric}: ${item.observedValue}`,
      ),
    };
    if (rootCause && hypothesis.id === rootCause.id && snapshot.findings.revenueImpact) {
      issue.estimatedImpactMinorUnits = snapshot.findings.revenueImpact.estimatedImpactMinorUnits;
    }
    return issue;
  });

  const attentionNeeded = issues.filter((issue) => issue.severity !== "normal");
  const impact = snapshot.findings.revenueImpact?.estimatedImpactMinorUnits;
  const revenueAtRisk =
    rootCause && impact !== undefined && impact > 0
      ? { estimatedImpactMinorUnits: impact, issueCount: attentionNeeded.length }
      : null;

  const failures = snapshot.findings.failures;

  return {
    currency: "INR",
    timeRange: { startTime: snapshot.timeRange.startTime, endTime: snapshot.timeRange.endTime },
    hasData,
    revenue: {
      currentMinorUnits: revenueComparison.currentValue,
      changePercent: revenueComparison.percentageChange,
    },
    successRate: {
      current: failures ? 1 - failures.failureRate : 0,
      changePercentagePoints: failures ? failures.previousFailureRate - failures.failureRate : null,
    },
    failureRate: {
      current: failures?.failureRate ?? 0,
      changePercentagePoints: failures?.failureRateChange ?? null,
    },
    revenueAtRisk,
    issues,
  };
}
