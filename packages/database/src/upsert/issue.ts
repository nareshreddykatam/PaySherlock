import type {
  Database,
  Issue,
  IssueAnomalyType,
  IssueLifecycleStatus,
  IssueSeverityLevel,
} from "../client.js";

// Statuses that count as "still open" for dedup purposes — a resolved or
// dismissed issue never blocks a fresh one from being created later under
// the same fingerprint (see docs/decisions on why uniqueness is enforced
// here, in application code, rather than a DB constraint).
const ACTIVE_STATUSES: IssueLifecycleStatus[] = [
  "DETECTED",
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "INVESTIGATION_FAILED",
];

export interface FindActiveIssueParams {
  merchantId: string;
  fingerprint: string;
}

/** The lookup that prevents duplicate active issues: at most one row per
 * (merchantId, fingerprint) among the non-terminal statuses. */
export async function findActiveIssueByFingerprint(
  db: Database,
  params: FindActiveIssueParams,
): Promise<Issue | null> {
  return db.issue.findFirst({
    where: {
      merchantId: params.merchantId,
      fingerprint: params.fingerprint,
      status: { in: ACTIVE_STATUSES },
    },
  });
}

export interface CreateIssueParams {
  merchantId: string;
  type: IssueAnomalyType;
  title: string;
  severity: IssueSeverityLevel;
  detectedAt: Date;
  metric: string;
  currentValue: number;
  baselineValue: number;
  absoluteChange: number;
  relativeChange: number | null;
  sampleSize: number;
  dimension: string | null;
  fingerprint: string;
}

export async function createIssue(db: Database, params: CreateIssueParams): Promise<Issue> {
  return db.issue.create({
    data: {
      merchantId: params.merchantId,
      type: params.type,
      title: params.title,
      severity: params.severity,
      status: "DETECTED",
      detectedAt: params.detectedAt,
      metric: params.metric,
      currentValue: params.currentValue,
      baselineValue: params.baselineValue,
      absoluteChange: params.absoluteChange,
      relativeChange: params.relativeChange,
      sampleSize: params.sampleSize,
      dimension: params.dimension,
      fingerprint: params.fingerprint,
    },
  });
}

export interface UpdateIssueMetricsParams {
  id: string;
  severity: IssueSeverityLevel;
  currentValue: number;
  baselineValue: number;
  absoluteChange: number;
  relativeChange: number | null;
  sampleSize: number;
  occurrenceCount: number;
}

/** Re-confirms an existing active issue with a fresh detection reading —
 * updates the metrics/severity/occurrence count, never creates a second
 * row. This is the "update it, don't create another" path. */
export async function updateIssueMetrics(
  db: Database,
  params: UpdateIssueMetricsParams,
): Promise<Issue> {
  return db.issue.update({
    where: { id: params.id },
    data: {
      severity: params.severity,
      currentValue: params.currentValue,
      baselineValue: params.baselineValue,
      absoluteChange: params.absoluteChange,
      relativeChange: params.relativeChange,
      sampleSize: params.sampleSize,
      occurrenceCount: params.occurrenceCount,
    },
  });
}

export interface SetIssueInvestigatingParams {
  id: string;
}

/** Marks an issue as having an investigation in flight — set *before*
 * calling the agent so a concurrent/subsequent detection run never
 * triggers a second one for the same issue (storm prevention). */
export async function setIssueInvestigating(
  db: Database,
  params: SetIssueInvestigatingParams,
): Promise<Issue> {
  return db.issue.update({ where: { id: params.id }, data: { status: "INVESTIGATING" } });
}

export interface CompleteIssueInvestigationParams {
  id: string;
  investigationId: string;
  status: Extract<IssueLifecycleStatus, "IDENTIFIED" | "MONITORING">;
  rootCause: string | null;
  confidence: string | null;
  estimatedImpactMinorUnits: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  investigationResult: any;
}

export async function completeIssueInvestigation(
  db: Database,
  params: CompleteIssueInvestigationParams,
): Promise<Issue> {
  return db.issue.update({
    where: { id: params.id },
    data: {
      status: params.status,
      investigationId: params.investigationId,
      rootCause: params.rootCause,
      confidence: params.confidence,
      estimatedImpactMinorUnits: params.estimatedImpactMinorUnits,
      investigationResult: params.investigationResult,
      investigationError: null,
    },
  });
}

export interface FailIssueInvestigationParams {
  id: string;
  /** Safe, sanitized message only — never a raw stack trace or internal
   * detail (see docs/decisions). */
  error: string;
}

/** The issue is kept — never deleted — and the failure is recorded so a
 * later detection run can retry it. */
export async function failIssueInvestigation(
  db: Database,
  params: FailIssueInvestigationParams,
): Promise<Issue> {
  return db.issue.update({
    where: { id: params.id },
    data: { status: "INVESTIGATION_FAILED", investigationError: params.error },
  });
}

export interface SetIssueStatusParams {
  id: string;
  status: IssueLifecycleStatus;
}

export async function setIssueStatus(db: Database, params: SetIssueStatusParams): Promise<Issue> {
  return db.issue.update({ where: { id: params.id }, data: { status: params.status } });
}

export interface ResolveStaleIssuesParams {
  merchantId: string;
  /** Any active issue not reconfirmed since before this cutoff is
   * considered no longer anomalous and is auto-resolved. A practical
   * MVP resolution policy (see docs/decisions) — not trend analysis. */
  staleBefore: Date;
}

/** Auto-resolves active issues that no detection run has reconfirmed
 * recently — the practical stand-in for "this anomaly is no longer
 * happening" without tracking a full metric history. Returns the number of
 * issues resolved. */
export async function resolveStaleIssues(
  db: Database,
  params: ResolveStaleIssuesParams,
): Promise<number> {
  const result = await db.issue.updateMany({
    where: {
      merchantId: params.merchantId,
      status: { in: ACTIVE_STATUSES },
      updatedAt: { lt: params.staleBefore },
    },
    data: { status: "RESOLVED" },
  });
  return result.count;
}

export interface DismissIssueParams {
  id: string;
  merchantId: string;
}

export async function dismissIssue(
  db: Database,
  params: DismissIssueParams,
): Promise<Issue | null> {
  const existing = await db.issue.findFirst({
    where: { id: params.id, merchantId: params.merchantId },
  });
  if (!existing) return null;
  return db.issue.update({ where: { id: params.id }, data: { status: "DISMISSED" } });
}
