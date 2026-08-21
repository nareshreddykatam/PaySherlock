import type { Database, Issue } from "@paysherlock/database";
import {
  completeIssueInvestigation,
  createIssue,
  failIssueInvestigation,
  findActiveIssueByFingerprint,
  resolveStaleIssues,
  setIssueInvestigating,
  updateIssueMetrics,
} from "@paysherlock/database";
import type {
  AnomalyType,
  DetectionResult,
  DetectionSeverity,
  InvestigationRequest,
  InvestigationResult,
} from "@paysherlock/types";
import { computeFingerprint } from "../fingerprint/fingerprint.js";
import { createDetectorRegistry, runDetectors } from "./registry.js";
import type { DetectionContext } from "./types.js";

// Wires this package's deterministic "is this anomalous?" detectors to the
// existing Phase 2 investigation engine (LLM-narrated "why is this probably
// happening?") through the persisted Issue model — the core Phase 4 flow.
// This file owns every decision about *when* to create/update/dismiss an
// issue and *when* to trigger an investigation; it never re-implements
// detection math or investigation logic itself. Both apps/api (the manual/
// on-demand path) and workers/investigator (the scheduled path) call this
// same function — see docs/decisions.

export interface DetectionRunDeps {
  db: Database;
  /** Reuses whatever investigation runner the caller already has (apps/api
   * and workers/investigator each build one via
   * `@paysherlock/agent`'s `createInvestigationRunner`) — no second agent,
   * no second planner. Deliberately just a plain function so this package
   * never needs to depend on `@paysherlock/agent` itself. */
  runInvestigation: (request: InvestigationRequest) => Promise<InvestigationResult>;
}

export interface DetectionRunSummary {
  detectorResultCount: number;
  issuesCreated: number;
  issuesUpdated: number;
  investigationsTriggered: number;
  investigationsFailed: number;
  issuesResolved: number;
  detectorErrors: { type: string; message: string }[];
}

const TITLES: Record<AnomalyType, string> = {
  PAYMENT_FAILURE_SPIKE: "Payment failure spike",
  PAYMENT_METHOD_DEGRADATION: "payment degradation", // prefixed with the method name below
  REFUND_SPIKE: "Refund spike",
  TRANSACTION_VOLUME_DECLINE: "Transaction volume decline",
  HIGH_VALUE_TRANSACTION_DECLINE: "High-value transaction decline",
};

const METHOD_LABELS: Record<string, string> = {
  UPI: "UPI",
  CARD: "Card",
  NETBANKING: "Netbanking",
  WALLET: "Wallet",
  EMI: "EMI",
  OTHER: "Other-method",
};

function titleFor(type: AnomalyType, dimension?: string): string {
  if (type === "PAYMENT_METHOD_DEGRADATION" && dimension) {
    return `${METHOD_LABELS[dimension] ?? dimension} ${TITLES[type]}`;
  }
  return TITLES[type];
}

const SEVERITY_RANK: Record<DetectionSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

function maxSeverity(a: DetectionSeverity, b: DetectionSeverity): DetectionSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** A brand-new issue is never persisted as CRITICAL on its very first
 * detection — only a *persistent* anomaly (reconfirmed on a later
 * detection run, see the update path below, which never caps) earns
 * CRITICAL. This is the concrete mechanism behind the Phase 4 brief's
 * "one-window transient spike -> no critical issue" scenario, without
 * tracking a full metric history. See docs/decisions. */
function capFirstOccurrenceSeverity(severity: DetectionSeverity): DetectionSeverity {
  return severity === "CRITICAL" ? "WARNING" : severity;
}

function formatChange(result: DetectionResult): string {
  if (result.relativeChange !== null) {
    const pct = (result.relativeChange * 100).toFixed(1);
    return `${result.relativeChange >= 0 ? "+" : ""}${pct}%`;
  }
  const pp = (result.absoluteChange * 100).toFixed(1);
  return `${result.absoluteChange >= 0 ? "+" : ""}${pp} percentage points`;
}

/** A short, natural-language question for the triggered investigation —
 * the model investigates the anomaly the detector already found, rather
 * than being asked to rediscover it from a generic prompt (Phase 4 brief
 * section 21). */
function questionFor(result: DetectionResult): string {
  switch (result.type) {
    case "PAYMENT_FAILURE_SPIKE":
      return "Why did the payment failure rate increase?";
    case "PAYMENT_METHOD_DEGRADATION":
      return `Why did the ${result.dimension ?? "payment method"} failure rate increase?`;
    case "REFUND_SPIKE":
      return "Why did refunds increase?";
    case "TRANSACTION_VOLUME_DECLINE":
      return "Why did transaction volume decline?";
    case "HIGH_VALUE_TRANSACTION_DECLINE":
      return "Why did high-value transactions decline?";
  }
}

/** Deterministic context handed to the investigation alongside the
 * question — the numbers the detector already computed, so the agent
 * investigates the anomaly rather than blindly re-deriving it. Capped well
 * under InvestigationRequestSchema's 2000-char limit. */
function contextFor(result: DetectionResult): string {
  const parts = [
    `Automated detection found a ${result.type} anomaly.`,
    result.dimension ? `Dimension: ${result.dimension}.` : undefined,
    `Metric: ${result.metric}. Current: ${result.currentValue}. Baseline (avg of ${
      result.comparisonWindows ?? 0
    } comparable windows): ${result.baselineValue}. Change: ${formatChange(result)}.`,
    `Window: ${result.windowStart} to ${result.windowEnd}.`,
    "Investigate this anomaly and identify the likely root cause.",
  ].filter((part): part is string => Boolean(part));
  return parts.join(" ").slice(0, 2000);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The investigation failed unexpectedly.";
}

/** Active issues not reconfirmed by a detection run within this window are
 * treated as no longer anomalous and auto-resolved (Phase 4 brief section
 * 17 — a practical MVP resolution policy, not trend analysis; see
 * docs/decisions). Independent of the detection cadence itself. */
export const DEFAULT_STALE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours

async function upsertIssueForResult(
  deps: DetectionRunDeps,
  merchantId: string,
  result: DetectionResult,
  now: Date,
): Promise<{ issue: Issue; isNew: boolean }> {
  const fingerprint = computeFingerprint({
    type: result.type,
    dimension: result.dimension,
    at: now,
  });
  const existing = await findActiveIssueByFingerprint(deps.db, { merchantId, fingerprint });

  if (!existing) {
    const severity = capFirstOccurrenceSeverity(result.severity!);
    const issue = await createIssue(deps.db, {
      merchantId,
      type: result.type,
      title: titleFor(result.type, result.dimension),
      severity,
      detectedAt: now,
      metric: result.metric,
      currentValue: result.currentValue,
      baselineValue: result.baselineValue,
      absoluteChange: result.absoluteChange,
      relativeChange: result.relativeChange,
      sampleSize: result.sampleSize,
      dimension: result.dimension ?? null,
      fingerprint,
    });
    return { issue, isNew: true };
  }

  // Reconfirmed by a second (or later) detection run — persistence is
  // established, so the severity cap no longer applies. Severity only ever
  // escalates here, never silently drops back down from one quieter
  // reading; resolution is what retires an issue, not a lower reading.
  const issue = await updateIssueMetrics(deps.db, {
    id: existing.id,
    severity: maxSeverity(existing.severity, result.severity!),
    currentValue: result.currentValue,
    baselineValue: result.baselineValue,
    absoluteChange: result.absoluteChange,
    relativeChange: result.relativeChange,
    sampleSize: result.sampleSize,
    occurrenceCount: existing.occurrenceCount + 1,
  });
  return { issue, isNew: false };
}

function shouldTriggerInvestigation(issue: Issue, isNew: boolean): boolean {
  if (issue.severity === "INFO") return false; // informational only — no investigation storm for minor blips
  if (isNew) return true;
  // Storm prevention: only (re-)trigger for an issue that has no
  // investigation in flight or completed yet.
  return issue.status === "DETECTED" || issue.status === "INVESTIGATION_FAILED";
}

async function triggerInvestigation(
  deps: DetectionRunDeps,
  merchantId: string,
  issue: Issue,
  result: DetectionResult,
): Promise<"succeeded" | "failed"> {
  await setIssueInvestigating(deps.db, { id: issue.id });
  try {
    const investigationResult = await deps.runInvestigation({
      question: questionFor(result),
      merchantId,
      context: contextFor(result),
      // Investigate the exact window the detector flagged — without this,
      // the investigation would fall back to Phase 2's default "yesterday"
      // window, which may not even overlap with the anomaly.
      timeRange: { startTime: result.windowStart, endTime: result.windowEnd },
    });
    await completeIssueInvestigation(deps.db, {
      id: issue.id,
      investigationId: investigationResult.meta.investigationId,
      status: investigationResult.rootCause ? "IDENTIFIED" : "MONITORING",
      rootCause: investigationResult.rootCause ?? null,
      confidence: investigationResult.confidence ?? null,
      estimatedImpactMinorUnits:
        investigationResult.businessImpact?.estimatedImpactMinorUnits ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      investigationResult: investigationResult as any,
    });
    return "succeeded";
  } catch (error) {
    // The issue is kept — never deleted — and the failure is safe to show
    // (no stack trace, no internal detail). A later detection run may
    // retry it (see shouldTriggerInvestigation's INVESTIGATION_FAILED case).
    await failIssueInvestigation(deps.db, { id: issue.id, error: safeErrorMessage(error) });
    return "failed";
  }
}

/** Runs every detector for one merchant, persists anomalies as issues
 * (deduped by fingerprint), triggers the existing investigation engine for
 * newly-actionable issues, and auto-resolves issues no longer being
 * reconfirmed. This is the entire Phase 4 proactive pipeline for one
 * merchant, one call — see workers/investigator for what calls it on a
 * schedule, and apps/api's eval harness for what calls it on demand. */
export async function runDetectionForMerchant(
  deps: DetectionRunDeps,
  merchantId: string,
  now: Date = new Date(),
): Promise<DetectionRunSummary> {
  const ctx: DetectionContext = { merchantId, db: deps.db, now };
  const { results, errors } = await runDetectors(ctx, createDetectorRegistry());

  let issuesCreated = 0;
  let issuesUpdated = 0;
  let investigationsTriggered = 0;
  let investigationsFailed = 0;

  const anomalies = results.filter((r) => r.status === "ANOMALY" && r.severity !== undefined);
  for (const result of anomalies) {
    const { issue, isNew } = await upsertIssueForResult(deps, merchantId, result, now);
    if (isNew) issuesCreated += 1;
    else issuesUpdated += 1;

    if (shouldTriggerInvestigation(issue, isNew)) {
      const outcome = await triggerInvestigation(deps, merchantId, issue, result);
      if (outcome === "succeeded") investigationsTriggered += 1;
      else investigationsFailed += 1;
    }
  }

  const issuesResolved = await resolveStaleIssues(deps.db, {
    merchantId,
    staleBefore: new Date(now.getTime() - DEFAULT_STALE_AFTER_MS),
  });

  return {
    detectorResultCount: results.length,
    issuesCreated,
    issuesUpdated,
    investigationsTriggered,
    investigationsFailed,
    issuesResolved,
    detectorErrors: errors,
  };
}
