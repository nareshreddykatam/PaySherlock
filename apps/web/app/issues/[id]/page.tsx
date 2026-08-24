"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useApiQuery } from "@/lib/api/useApiQuery";
import {
  getIssue,
  generateRecoveryBatch,
  isNotEligibleForRecovery,
  type RecoveryBatch,
} from "@/lib/api/issues";
import { getTrack03Evaluation } from "@/lib/api/evaluation";
import { ResultView } from "@/components/investigation/ResultView";
import { RecommendationCard } from "@/components/recommendation/RecommendationCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCompactINR } from "@/lib/formatters/currency";
import { formatDateTime, formatRelativeToNow } from "@/lib/formatters/date";
import { humanizeMetric } from "@/components/investigation/humanizeMetric";
import {
  ANOMALY_TYPE_LABELS,
  SEVERITY_TONE,
  STATUS_LABELS,
  STATUS_TONE,
} from "@/lib/formatters/issue";

const STOP_REASON_LABEL: Record<string, string> = {
  max_candidates_reached: "Maximum candidate count reached",
  max_amount_reached: "Maximum total recovery amount reached",
};

function isRateMetric(metric: string): boolean {
  return metric.includes("rate");
}

function formatMetricValue(metric: string, value: number): string {
  if (isRateMetric(metric)) return `${(value * 100).toFixed(1)}%`;
  return value.toLocaleString("en-IN");
}

function formatChange(issue: {
  relativeChange: number | null;
  absoluteChange: number;
  metric: string;
}): string {
  if (issue.relativeChange !== null) {
    const pct = (issue.relativeChange * 100).toFixed(1);
    return `${issue.relativeChange >= 0 ? "+" : ""}${pct}%`;
  }
  const pp = (issue.absoluteChange * 100).toFixed(1);
  return `${issue.absoluteChange >= 0 ? "+" : ""}${pp}pp`;
}

/** Turns the batch's real rejectedCandidates into an honest one-line
 * explanation for the zero-eligible case — never a generic "no results"
 * message that hides why. */
function summarizeNoEligibleCandidates(batch: RecoveryBatch): string {
  if (batch.candidatesScanned === 0) {
    return "No captured payments were found in this degradation window.";
  }
  const reasons = new Set(batch.rejectedCandidates.map((c) => c.reason));
  if (reasons.size === 1) {
    const [reason] = reasons;
    return `All ${batch.candidatesScanned} payment${batch.candidatesScanned === 1 ? "" : "s"} scanned in this window were rejected for the same reason: "${reason}". No financial action was proposed.`;
  }
  return `All ${batch.candidatesScanned} payments scanned in this window were rejected for varying reasons (see below). No financial action was proposed.`;
}

/**
 * Track 03 (AI Revenue Recovery): a separately-labeled panel for the
 * offline evaluation harness's result — fetched live from
 * GET /eval/track03 (the same runTrack03Evaluation() function
 * `pnpm eval:track03` runs) rather than a constant duplicated here, so it
 * can never silently drift from the real evaluation. Deliberately visually
 * distinct from the live Revenue Recovery panel above: this describes a
 * mocked Razorpay client run against synthetic payment rows, never this
 * merchant's real data, and never creates a Payment record.
 */
function Track03EvaluationPanel() {
  const { data, error, loading } = useApiQuery(() => getTrack03Evaluation(), []);

  if (loading) return <Skeleton className="h-40" />;
  if (error || !data) return null;

  const { metrics } = data;

  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface-2 p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Synthetic Track 03 Evaluation
      </p>
      <p className="mt-1 text-sm font-medium text-ink">
        Mock Razorpay client — no real money recovered.
      </p>
      <p className="mt-1 text-sm text-ink-muted">{data.environment.disclosure}</p>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Attempted
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {formatCompactINR(metrics.amountAttemptedMinorUnits)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Recovered
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {formatCompactINR(metrics.amountRecoveredMinorUnits)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Recovery rate
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {(metrics.recoveryRate * 100).toFixed(0)}%
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Succeeded / Failed
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {metrics.successfulRecoveries} / {metrics.failedRecoveries}
          </dd>
        </div>
      </dl>

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Duplicate executions
          </dt>
          <dd className="mt-1 text-sm tabular-nums text-ink-muted">
            {metrics.duplicateExecutionCount}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            False successes
          </dt>
          <dd className="mt-1 text-sm tabular-nums text-ink-muted">{metrics.falseSuccessCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Scenarios passed
          </dt>
          <dd className="mt-1 text-sm tabular-nums text-ink-muted">
            {data.scenariosPassed} / {data.scenariosTotal}
          </dd>
        </div>
      </dl>

      <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-faint">
        {data.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
    </div>
  );
}

export default function IssueDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const {
    data: issue,
    error,
    loading,
    reload,
  } = useApiQuery(() => getIssue(params.id), [params.id]);

  const [batch, setBatch] = useState<RecoveryBatch | null>(null);
  const [batchPending, setBatchPending] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  async function handleGenerateRecoveryBatch() {
    setBatchPending(true);
    setBatchError(null);
    try {
      setBatch(await generateRecoveryBatch(params.id));
    } catch (err) {
      setBatchError(
        isNotEligibleForRecovery(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not generate a recovery batch.",
      );
    } finally {
      setBatchPending(false);
    }
  }

  const canGenerateRecoveryBatch =
    issue?.type === "PAYMENT_METHOD_DEGRADATION" && issue.status === "IDENTIFIED";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/issues"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong rounded-sm"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Issues
      </Link>

      {error ? (
        <ErrorState
          title="We couldn't load this issue."
          description={error.message}
          onRetry={reload}
        />
      ) : loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : issue ? (
        <div className="flex flex-col gap-6">
          <header className="rounded-lg border border-border bg-surface p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-ink">{issue.title}</h1>
              <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
              <Badge tone={STATUS_TONE[issue.status]}>{STATUS_LABELS[issue.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {ANOMALY_TYPE_LABELS[issue.type]}
              {issue.dimension ? ` · ${issue.dimension}` : ""} · Detected{" "}
              {formatRelativeToNow(issue.detectedAt)} ({formatDateTime(issue.detectedAt)})
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  {humanizeMetric(issue.metric)}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {formatMetricValue(issue.metric, issue.currentValue)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Baseline
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {formatMetricValue(issue.metric, issue.baselineValue)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Change
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {formatChange(issue)}
                </dd>
              </div>
              {issue.estimatedImpactMinorUnits !== null && issue.estimatedImpactMinorUnits > 0 ? (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    Estimated impact
                  </dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                    {formatCompactINR(issue.estimatedImpactMinorUnits)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </header>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium text-ink">AI Investigation</h2>

            {issue.investigation ? (
              <ResultView
                result={issue.investigation}
                onFollowUp={(question) =>
                  router.push(`/investigate?q=${encodeURIComponent(question)}`)
                }
              />
            ) : issue.status === "INVESTIGATION_FAILED" ? (
              <ErrorState
                title="We couldn't complete the investigation."
                description="The automatic investigation failed. A later detection run may retry it."
                detail={issue.investigationError ?? undefined}
              />
            ) : issue.status === "INVESTIGATING" ? (
              <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
                Investigation in progress…
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
                This anomaly hasn&apos;t been investigated yet.
              </div>
            )}
          </section>

          {canGenerateRecoveryBatch ? (
            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-medium text-ink">Revenue Recovery</h2>
                {!batch ? (
                  <Button onClick={handleGenerateRecoveryBatch} disabled={batchPending}>
                    {batchPending ? "Scanning affected payments…" : "Generate Recovery Batch"}
                  </Button>
                ) : null}
              </div>

              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
                <li>
                  No refund is ever sent automatically — every candidate requires its own explicit
                  human approval.
                </li>
                <li>
                  There is no bulk-approve action: approving one recommendation never approves
                  another.
                </li>
                <li>
                  A payment already covered by an earlier recommendation is automatically excluded
                  from every later batch.
                </li>
                <li>
                  Batch size and total amount are bounded server-side and cannot be changed by this
                  page.
                </li>
              </ul>

              {batchError ? (
                <p role="alert" className="text-sm text-red">
                  {batchError}
                </p>
              ) : null}

              {batch ? (
                <>
                  <div className="rounded-lg border border-border bg-surface p-6">
                    <p className="text-sm text-ink-muted">
                      Payments captured during the degradation window (
                      {formatDateTime(batch.windowStart)} – {formatDateTime(batch.windowEnd)}) that
                      remain eligible for a compensating refund, subject to the same deterministic
                      eligibility rules as a single-payment recommendation.
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                          Candidates scanned
                        </dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                          {batch.candidatesScanned}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                          Eligible
                        </dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                          {batch.eligibleCount}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                          Rejected
                        </dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                          {batch.rejectedCount}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                          Proposed recovery
                        </dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                          {formatCompactINR(batch.amountEligibleMinorUnits)}
                        </dd>
                      </div>
                    </dl>
                    <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-3">
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                          Max candidates
                        </dt>
                        <dd className="mt-1 text-sm tabular-nums text-ink-muted">
                          {batch.limits.maxCandidates}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                          Max batch amount
                        </dt>
                        <dd className="mt-1 text-sm tabular-nums text-ink-muted">
                          {formatCompactINR(batch.limits.maxTotalAmountMinorUnits)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                          Stopping rule triggered
                        </dt>
                        <dd className="mt-1 text-sm text-ink-muted">
                          {batch.stoppedReason ? STOP_REASON_LABEL[batch.stoppedReason] : "None"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {batch.recommendations.length > 0 ? (
                    <div className="flex flex-col gap-4">
                      <p className="text-sm text-ink-muted">
                        Each candidate below is its own recommendation and requires its own explicit
                        approval — approving one never approves another.
                      </p>
                      {batch.recommendations.map((recommendation) => (
                        <RecommendationCard
                          key={recommendation.id}
                          recommendation={recommendation}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
                      <p>{summarizeNoEligibleCandidates(batch)}</p>
                      {batch.rejectedCandidates.length > 0 ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-ink">
                            Show rejected candidates ({batch.rejectedCandidates.length})
                          </summary>
                          <ul className="mt-2 space-y-1 text-xs">
                            {batch.rejectedCandidates.map((candidate) => (
                              <li key={candidate.paymentId} className="tabular-nums">
                                {candidate.razorpayPaymentId} — {candidate.reason}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  )}
                </>
              ) : null}

              <Track03EvaluationPanel />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
